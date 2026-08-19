import { calculateHoldingMetrics, type StockHoldings } from "./holdings.ts";
import { compactNumber } from "./market.ts";
import { currencyOf, stockStorageKey, type StockCurrency } from "./security.ts";
import type { StockScoreReport } from "./stockScore.ts";
import type { WatchlistStock } from "./watchlist.ts";

export type PortfolioSortKey = "custom" | "signal" | "capital" | "change" | "profit";

export type PortfolioPresentationQuote = {
  status: "idle" | "loading" | "ready" | "error";
  price: number | null;
  changePct: number | null;
  date: string;
  time: string;
  score: StockScoreReport | null;
  intent: {
    activeNetAmount: number;
    activeNetRatio: number;
  } | null;
};

export type CurrencyExposure = {
  currency: StockCurrency;
  positioned: number;
  priced: number;
  marketValue: number;
  topStockName: string;
  topWeightPct: number | null;
};

export type PortfolioPerformanceLead = {
  stockName: string;
  valuePct: number;
};

export type PortfolioInsightSummary = {
  tracked: number;
  ready: number;
  failed: number;
  completionPct: number;
  latestUpdate: string;
  positioned: number;
  exposures: CurrencyExposure[];
  highestConcentration: (CurrencyExposure & { topWeightPct: number }) | null;
  strongestMove: PortfolioPerformanceLead | null;
  bestHolding: PortfolioPerformanceLead | null;
  weakestHolding: PortfolioPerformanceLead | null;
  nextAction: string;
};

export function sortPortfolioWatchlist(
  watchlist: WatchlistStock[],
  holdings: StockHoldings,
  quotes: Record<string, PortfolioPresentationQuote | undefined>,
  sortBy: PortfolioSortKey,
): WatchlistStock[] {
  if (sortBy === "custom") return watchlist;
  return [...watchlist].sort((left, right) => {
    const leftKey = stockStorageKey(left);
    const rightKey = stockStorageKey(right);
    if (sortBy === "signal") {
      return descendingNullable(signalPriority(quotes[leftKey]?.score), signalPriority(quotes[rightKey]?.score));
    }
    if (sortBy === "capital") {
      // A ratio is comparable across currencies; nominal CNY and USD amounts are not.
      return descendingNullable(quotes[leftKey]?.intent?.activeNetRatio, quotes[rightKey]?.intent?.activeNetRatio);
    }
    if (sortBy === "change") {
      return descendingNullable(quotes[leftKey]?.changePct, quotes[rightKey]?.changePct);
    }
    const leftHolding = holdings[leftKey];
    const rightHolding = holdings[rightKey];
    const leftProfitPct = leftHolding
      ? calculateHoldingMetrics(leftHolding.shares, leftHolding.cost, quotes[leftKey]?.price)?.profitPct
      : null;
    const rightProfitPct = rightHolding
      ? calculateHoldingMetrics(rightHolding.shares, rightHolding.cost, quotes[rightKey]?.price)?.profitPct
      : null;
    // Return percentage keeps cross-currency sorting meaningful without an implicit FX rate.
    return descendingNullable(leftProfitPct, rightProfitPct);
  });
}

export function buildPortfolioInsights(
  watchlist: WatchlistStock[],
  holdings: StockHoldings,
  quotes: Record<string, PortfolioPresentationQuote | undefined>,
): PortfolioInsightSummary {
  const ready = watchlist.filter((stock) => quotes[stockStorageKey(stock)]?.status === "ready").length;
  const failed = watchlist.filter((stock) => quotes[stockStorageKey(stock)]?.status === "error").length;
  const latestUpdate = watchlist
    .map((stock) => quotes[stockStorageKey(stock)])
    .filter((quote): quote is PortfolioPresentationQuote => Boolean(quote?.date))
    .map((quote) => `${quote.date}${quote.time ? ` ${quote.time}` : ""}`)
    .sort()
    .at(-1) ?? "";
  const currencyPositions: Record<StockCurrency, Array<{ stockName: string; marketValue: number; profitPct: number }>> = {
    CNY: [],
    USD: [],
  };
  const positionedByCurrency: Record<StockCurrency, number> = { CNY: 0, USD: 0 };

  for (const stock of watchlist) {
    const key = stockStorageKey(stock);
    const holding = holdings[key];
    if (!holding) continue;
    const currency = currencyOf(stock);
    positionedByCurrency[currency] += 1;
    const metrics = calculateHoldingMetrics(holding.shares, holding.cost, quotes[key]?.price);
    if (!metrics) continue;
    currencyPositions[currency].push({
      stockName: stock.name,
      marketValue: metrics.marketValue,
      profitPct: metrics.profitPct,
    });
  }

  const exposures = (["CNY", "USD"] as StockCurrency[])
    .filter((currency) => positionedByCurrency[currency] > 0)
    .map((currency): CurrencyExposure => {
      const positions = currencyPositions[currency];
      const marketValue = positions.reduce((sum, position) => sum + position.marketValue, 0);
      const top = [...positions].sort((left, right) => right.marketValue - left.marketValue)[0];
      return {
        currency,
        positioned: positionedByCurrency[currency],
        priced: positions.length,
        marketValue,
        topStockName: top?.stockName ?? "",
        topWeightPct: top && marketValue > 0 ? (top.marketValue / marketValue) * 100 : null,
      };
    });
  const highestConcentration = exposures
    .filter((exposure): exposure is CurrencyExposure & { topWeightPct: number } => exposure.topWeightPct != null)
    .sort((left, right) => right.topWeightPct - left.topWeightPct)[0] ?? null;
  const movers = watchlist.flatMap((stock) => {
    const changePct = quotes[stockStorageKey(stock)]?.changePct;
    return changePct != null && Number.isFinite(changePct) ? [{ stockName: stock.name, valuePct: changePct }] : [];
  });
  const strongestMove = [...movers].sort((left, right) => Math.abs(right.valuePct) - Math.abs(left.valuePct))[0] ?? null;
  const holdingPerformance = Object.values(currencyPositions).flat().map((position) => ({
    stockName: position.stockName,
    valuePct: position.profitPct,
  }));
  const bestHolding = [...holdingPerformance].sort((left, right) => right.valuePct - left.valuePct)[0] ?? null;
  const weakestHolding = [...holdingPerformance].sort((left, right) => left.valuePct - right.valuePct)[0] ?? null;
  const positioned = positionedByCurrency.CNY + positionedByCurrency.USD;

  let nextAction = "复核自选依据与风险边界，暂不依据单一指标交易。";
  if (!watchlist.length) nextAction = "先添加关注股票，再核验行情来源与更新时间。";
  else if (failed) nextAction = `优先重试 ${failed} 只失败行情，避免在数据缺口下判断。`;
  else if (ready < watchlist.length) nextAction = `等待或刷新其余 ${watchlist.length - ready} 只行情，再比较信号。`;
  else if (!positioned) nextAction = "如需组合分析，先记录持股数与成本价；数据仍仅保存在本机。";
  else if (highestConcentration && highestConcentration.topWeightPct >= 60) {
    nextAction = `核验 ${highestConcentration.topStockName} 在${currencyName(highestConcentration.currency)}子组合中的集中风险。`;
  } else if (strongestMove && Math.abs(strongestMove.valuePct) >= 3) {
    nextAction = `核验 ${strongestMove.stockName} 波动原因、消息来源与价格时效。`;
  }

  return {
    tracked: watchlist.length,
    ready,
    failed,
    completionPct: watchlist.length ? Math.round((ready / watchlist.length) * 100) : 0,
    latestUpdate,
    positioned,
    exposures,
    highestConcentration,
    strongestMove,
    bestHolding,
    weakestHolding,
    nextAction,
  };
}

export function formatCapitalAmount(value: number, currency: StockCurrency): string {
  if (!Number.isFinite(value)) return "—";
  return `${currency === "USD" ? "$" : "¥"}${compactNumber(Math.abs(value))}`;
}

function signalPriority(report: StockScoreReport | null | undefined): number | null {
  if (!report) return null;
  if (report.signal.tone === "buy") return 300 + report.score;
  if (report.signal.tone === "sell") return 200 + (100 - report.score);
  return 100 + Math.abs(report.score - 50);
}

function descendingNullable(left: number | null | undefined, right: number | null | undefined): number {
  const validLeft = left != null && Number.isFinite(left) ? left : null;
  const validRight = right != null && Number.isFinite(right) ? right : null;
  if (validLeft == null && validRight == null) return 0;
  if (validLeft == null) return 1;
  if (validRight == null) return -1;
  return validRight - validLeft;
}

function currencyName(currency: StockCurrency): string {
  return currency === "USD" ? "美元" : "人民币";
}
