import type { StockHolding } from "./holdings.ts";
import { analyzeKlineConclusion, calculateIndicators, type Candle } from "./market.ts";
import { marketOf, stockStorageKey, type StockMarket } from "./security.ts";

export type HoldingRiskLine = {
  kind: "cost" | "take-profit" | "stop-loss";
  label: string;
  price: number;
};

export type HoldingRiskPlan = {
  code: string;
  market: StockMarket;
  cost: number;
  shares: number;
  asOf: string;
  priceBasis: string;
  chartAdjustmentFactor: number | null;
  state: "ready" | "unavailable";
  reason: string;
  atr: number | null;
  support: number | null;
  resistance: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  riskRewardRatio: number | null;
  lines: HoldingRiskLine[];
};

/** Recalculate only from completed daily bars; live prices never move an exit level. */
export function buildHoldingRiskPlan({
  holding,
  code,
  market,
  candles,
  priceBasis = "",
  provisionalDate,
  chartAdjustmentFactor,
  now = new Date(),
}: {
  holding: StockHolding | null;
  code: string;
  market: StockMarket;
  candles: Candle[];
  priceBasis?: string;
  provisionalDate?: string;
  chartAdjustmentFactor?: number;
  now?: Date;
}): HoldingRiskPlan | null {
  if (!holding || stockStorageKey(holding) !== stockStorageKey({ code, market })
    || marketOf(holding) !== market
    || !Number.isInteger(holding.shares) || holding.shares <= 0
    || !Number.isFinite(holding.cost) || holding.cost <= 0) return null;

  const timezone = market === "US" ? "America/New_York" : "Asia/Shanghai";
  const today = now.toLocaleDateString("sv-SE", { timeZone: timezone });
  const localTime = now.toLocaleTimeString("sv-SE", { timeZone: timezone, hour12: false, hourCycle: "h23" });
  const beforeClose = localTime < (market === "US" ? "16:00:00" : "15:00:00");
  const completed = candles.filter((candle) => candle.date <= today
    && (!beforeClose || candle.date < today)
    && (!provisionalDate || candle.date < provisionalDate));
  const base: HoldingRiskPlan = {
    code, market, cost: holding.cost, shares: holding.shares,
    asOf: completed.at(-1)?.date ?? "", priceBasis, chartAdjustmentFactor: null,
    state: "unavailable", reason: "", atr: null, support: null, resistance: null,
    stopLoss: null, takeProfit: null, stopLossPct: null, takeProfitPct: null,
    riskRewardRatio: null, lines: [],
  };
  // The provider's forward-adjusted series can retain a non-unit latest factor.
  // Convert the technical distances back to raw price using that same factor.
  const compatibleBasis = /前复权|不复权|未复权|原始价|新浪美股日K/.test(priceBasis) && !/后复权/.test(priceBasis);
  if (!compatibleBasis) return { ...base, reason: "当前行情价格口径无法与持仓成本直接比较，暂不生成参考线。" };
  const factor = /前复权/.test(priceBasis) ? chartAdjustmentFactor : 1;
  if (factor == null || !Number.isFinite(factor) || factor <= 0) return { ...base, reason: "缺少有效的最新复权因子，暂不生成持仓参考线。" };
  base.chartAdjustmentFactor = factor;
  base.lines = [{ kind: "cost", label: "持仓成本", price: holding.cost / factor }];
  if (completed.length < 20) return { ...base, reason: `需要至少 20 根完整日 K 线，当前 ${completed.length} 根。` };
  const recent = completed.slice(-20);
  if (recent.some((candle) => ![candle.open, candle.high, candle.low, candle.close].every((price) => Number.isFinite(price) && price > 0)
    || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)
    || candle.high < candle.low)) {
    return { ...base, reason: "近期日线价格数据不完整，暂不生成止盈止损位。" };
  }
  // The existing technical model supplies the same ATR14 and 20-day support and
  // resistance that appear in the K-line analysis, with no extra prediction model.
  const indicators = calculateIndicators(recent);
  const technical = analyzeKlineConclusion(recent, indicators, recent.length - 1);
  const atr = technical?.atr == null ? null : technical.atr * factor;
  if (!technical || atr == null || !Number.isFinite(atr) || atr <= 0 || holding.cost - 2 * atr <= 0) {
    return { ...base, reason: "近期波动数据不足或相对持仓成本过大，暂不生成止盈止损位。" };
  }
  const support = technical.support * factor;
  const resistance = technical.resistance * factor;
  const stopLoss = Math.max(holding.cost - 2 * atr, Math.min(support - 0.5 * atr, holding.cost - 0.5 * atr));
  const takeProfit = resistance >= holding.cost + atr
    ? Math.min(holding.cost + 3 * atr, resistance)
    : holding.cost + 3 * atr;
  const risk = holding.cost - stopLoss;
  return {
    ...base,
    state: "ready",
    reason: "成本 − 2×ATR14 为基础止损，支撑位 − 0.5×ATR 可收紧止损；成本 + 3×ATR14 为基础止盈，压力位可提前止盈。",
    atr,
    support,
    resistance,
    stopLoss,
    takeProfit,
    stopLossPct: (stopLoss / holding.cost - 1) * 100,
    takeProfitPct: (takeProfit / holding.cost - 1) * 100,
    riskRewardRatio: (takeProfit - holding.cost) / risk,
    lines: [
      { kind: "cost", label: "持仓成本", price: holding.cost / factor },
      { kind: "take-profit", label: "建议止盈", price: takeProfit / factor },
      { kind: "stop-loss", label: "建议止损", price: stopLoss / factor },
    ],
  };
}

export function holdingRiskStatus(plan: HoldingRiskPlan, currentPrice: number | null): { label: string; tone: "neutral" | "profit" | "risk" } {
  if (plan.state !== "ready") return { label: "待补充行情", tone: "neutral" };
  if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) return { label: "等待有效现价", tone: "neutral" };
  if (plan.stopLoss != null && currentPrice <= plan.stopLoss) return { label: "已触及止损参考位", tone: "risk" };
  if (plan.takeProfit != null && currentPrice >= plan.takeProfit) return { label: "已触及止盈参考位", tone: "profit" };
  return { label: "现价位于参考区间内", tone: "neutral" };
}
