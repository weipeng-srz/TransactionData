import type { FinancialDataset } from "./financials.ts";
import type { Candle, GuidePoint, IndicatorSet, Timeframe } from "./market.ts";
import type { NewsItem, ParsedNewsDataset } from "./news.ts";
import type { StockMarket } from "./security.ts";

export type ChartEventKind = "news" | "report" | "dividend";

export type ChartEvent = {
  date: string;
  kind: ChartEventKind;
  label: string;
  tone: "up" | "down" | "neutral";
};

export type BacktestHorizon = {
  periods: number;
  samples: number;
  wins: number;
  winRate: number | null;
  averageReturn: number | null;
  medianReturn: number | null;
  worstAdverseMove: number | null;
  bestFavorableMove: number | null;
  expectancy: number | null;
  payoffRatio: number | null;
  profitFactor: number | null;
  maxDrawdown: number | null;
  maxLossStreak: number;
  averageExcessReturn: number | null;
  winRateLow: number | null;
  winRateHigh: number | null;
  averageCostPct?: number | null;
  pendingExits?: number;
  delayedExits?: number;
};

export type BacktestDirectionSummary = {
  signalCount: number;
  tradable: boolean;
  horizons: BacktestHorizon[];
};

export type BacktestRecentAssessment = {
  windowPeriods: number;
  fromDate: string;
  status: "active" | "watch" | "weak" | "insufficient";
  label: string;
  buy: BacktestDirectionSummary;
  sell: BacktestDirectionSummary;
};

export type SignalBacktest = {
  totalSignals: number;
  buySignals: number;
  sellSignals: number;
  skippedSignals: number;
  roundTripCostPct: number;
  executionModel: string;
  horizons: BacktestHorizon[];
  directions?: {
    buy: BacktestDirectionSummary;
    sell: BacktestDirectionSummary;
  };
  recent?: BacktestRecentAssessment;
  costModel?: "flat" | "liquidity";
};

export type SignalBacktestOptions = {
  benchmark?: Candle[];
  roundTripCostPct?: number;
  limitUpDownPct?: number | null;
  market?: StockMarket;
  code?: string;
  name?: string;
  costModel?: "flat" | "liquidity";
  positionValue?: number;
  recentWindowPeriods?: number;
  exitRule?: "fixed" | "sell-signal";
};

export function collectGuideSignals(guidePoints: Array<GuidePoint | null>): Array<{ index: number; guide: GuidePoint }> {
  const last = { buy: -Infinity, sell: -Infinity };
  return guidePoints.flatMap((guide, index) => {
    if (!guide || guide.confidence === "watch" || index - last[guide.type] < 3) return [];
    last[guide.type] = index;
    return [{ index, guide }];
  });
}

function previousSessionClose(candles: Candle[], index: number): number | null {
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    if (candles[previous].date !== candles[index].date) return candles[previous].close;
  }
  return null;
}

export function isGuideEntryTradable(candles: Candle[], index: number, direction: "buy" | "sell", options: SignalBacktestOptions = {}): boolean {
  const entry = candles[index];
  if (!entry || !Number.isFinite(entry.open) || entry.open <= 0 || !(entry.volume > 0)) return false;
  const previousClose = previousSessionClose(candles, index);
  const limit = resolveBacktestPriceLimitPct(options, entry.date);
  if (limit == null || previousClose == null || previousClose <= 0) return true;
  const gap = (entry.open / previousClose - 1) * 100;
  return direction === "buy" ? gap < limit : gap > -limit;
}

// A blocked exit remains a position; it is never silently removed as a losing sample.
// Daily-bar limit checks deliberately assume no fill at the adverse price limit.
export function resolveGuideExit(
  candles: Candle[], signalIndex: number, horizon: number, direction: "buy" | "sell",
  options: SignalBacktestOptions = {}, guidePoints: Array<GuidePoint | null> = [],
): { index: number; price: number; execution: "open" | "close"; plannedIndex: number; delayed: boolean } | null {
  const entry = candles[signalIndex + 1];
  if (!entry) return null;
  let plannedIndex = signalIndex + horizon;
  let execution: "open" | "close" = "close";
  if (options.exitRule === "sell-signal" && direction === "buy") {
    for (let index = signalIndex + 1; index < Math.min(plannedIndex, candles.length - 1); index += 1) {
      if (guidePoints[index]?.type === "sell") {
        plannedIndex = index + 1;
        execution = "open";
        break;
      }
    }
  }
  for (let index = plannedIndex; index < candles.length; index += 1) {
    const candle = candles[index];
    if (options.market !== "US" && candle.date <= entry.date) continue;
    const price = candle[execution];
    if (!(candle.volume > 0) || !Number.isFinite(price) || price <= 0) continue;
    const previousClose = previousSessionClose(candles, index);
    const limit = resolveBacktestPriceLimitPct(options, candle.date);
    if (limit != null && previousClose != null && previousClose > 0) {
      const move = (price / previousClose - 1) * 100;
      if ((direction === "buy" && move <= -limit) || (direction === "sell" && move >= limit)) continue;
    }
    return { index, price, execution, plannedIndex, delayed: index > plannedIndex };
  }
  return null;
}

export type RiskMetrics = {
  samples: number;
  totalReturn: number | null;
  annualizedReturn: number | null;
  annualizedVolatility: number | null;
  downsideVolatility: number | null;
  maxDrawdown: number | null;
  currentDrawdown: number | null;
  sharpe: number | null;
  sortino: number | null;
  valueAtRisk95: number | null;
  expectedShortfall95: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  beta: number | null;
  alphaAnnualized: number | null;
  correlation: number | null;
};

export type ChartAnnotation = {
  id: string;
  code: string;
  date: string;
  price?: number | null;
  text: string;
  createdAt: string;
};

export type SavedWorkspace = {
  version: 1;
  code: string;
  market?: StockMarket;
  isDemo: boolean;
  timeframe: Timeframe;
  lowerIndicator: string;
  overlays: string[];
  range: { from: number; to: number };
  savedAt: string;
};

export function backtestGuideSignals(
  candles: Candle[],
  indicators: IndicatorSet,
  periods: number[] = [5, 10, 20],
  options: SignalBacktestOptions = {},
): SignalBacktest {
  const roundTripCostPct = Number.isFinite(options.roundTripCostPct) ? Math.max(0, options.roundTripCostPct ?? 0) : 0.25;
  const costModel = options.costModel ?? "flat";
  const positionValue = Number.isFinite(options.positionValue) ? Math.max(0, options.positionValue ?? 0) : 80_000;
  const benchmarkByDate = new Map((options.benchmark ?? []).map((candle) => [candle.date, candle]));
  const normalizedPeriods = [...new Set(periods)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right);
  const signals = collectGuideSignals(indicators.guidePoints).map(({ index, guide }) => ({ index, direction: guide.type }));

  const skippedSignalIndexes = new Set<number>();
  const calculateHorizons = (
    selectedSignals: Array<{ index: number; direction: "buy" | "sell" }>,
    fromIndex = 0,
  ): BacktestHorizon[] => normalizedPeriods.map((horizon): BacktestHorizon => {
      let pendingExits = 0;
      let delayedExits = 0;
      const outcomes = selectedSignals.flatMap((signal) => {
        if (signal.index < fromIndex) return [];
        const signalCandle = candles[signal.index];
        const entry = candles[signal.index + 1];
        if (!signalCandle || !entry || !isGuideEntryTradable(candles, signal.index + 1, signal.direction, options)) {
          skippedSignalIndexes.add(signal.index);
          return [];
        }
        const exit = resolveGuideExit(candles, signal.index, horizon, signal.direction, options, indicators.guidePoints);
        if (!exit) {
          pendingExits += 1;
          return [];
        }
        if (exit.delayed) delayedExits += 1;
        const target = candles[exit.index];
        const direction = signal.direction === "buy" ? 1 : -1;
        const grossReturn = ((exit.price / entry.open) - 1) * 100 * direction;
        const tradeCostPct = costModel === "liquidity"
          ? estimateLiquidityRoundTripCostPct(signalCandle, positionValue, roundTripCostPct)
          : roundTripCostPct;
        const strategyReturn = grossReturn - tradeCostPct;
        const path = candles.slice(signal.index + 1, exit.index + (exit.execution === "close" ? 1 : 0));
        // For an opening exit, the rest of that day's high/low was never held.
        if (exit.execution === "open") path.push({ ...target, high: exit.price, low: exit.price });
        const worstAdverseMove = signal.direction === "buy"
          ? Math.min(0, ...path.map((candle) => ((candle.low / entry.open) - 1) * 100))
          : Math.min(0, ...path.map((candle) => ((entry.open / candle.high) - 1) * 100));
        const bestFavorableMove = signal.direction === "buy"
          ? Math.max(0, ...path.map((candle) => ((candle.high / entry.open) - 1) * 100))
          : Math.max(0, ...path.map((candle) => ((entry.open / candle.low) - 1) * 100));
        const benchmarkEntry = benchmarkByDate.get(entry.date);
        const benchmarkTarget = benchmarkByDate.get(target.date);
        const benchmarkReturn = benchmarkEntry && benchmarkTarget && benchmarkEntry.open > 0
          ? ((benchmarkTarget[exit.execution] / benchmarkEntry.open) - 1) * 100 * direction
          : null;
        return [{ strategyReturn, tradeCostPct, worstAdverseMove, bestFavorableMove, excessReturn: benchmarkReturn == null ? null : strategyReturn - benchmarkReturn }];
      });
      const returns = outcomes.map((item) => item.strategyReturn);
      const wins = returns.filter((value) => value > 0).length;
      const positive = returns.filter((value) => value > 0);
      const negative = returns.filter((value) => value < 0);
      const winInterval = wilsonInterval(wins, outcomes.length);
      return {
        periods: horizon,
        pendingExits,
        delayedExits,
        samples: outcomes.length,
        wins,
        winRate: outcomes.length ? (wins / outcomes.length) * 100 : null,
        averageReturn: outcomes.length ? average(returns) : null,
        medianReturn: outcomes.length ? median(returns) : null,
        worstAdverseMove: outcomes.length ? Math.min(...outcomes.map((item) => item.worstAdverseMove)) : null,
        bestFavorableMove: outcomes.length ? Math.max(...outcomes.map((item) => item.bestFavorableMove)) : null,
        expectancy: outcomes.length ? average(returns) : null,
        payoffRatio: positive.length && negative.length ? average(positive) / Math.abs(average(negative)) : null,
        profitFactor: positive.length && negative.length ? positive.reduce((sum, value) => sum + value, 0) / Math.abs(negative.reduce((sum, value) => sum + value, 0)) : null,
        maxDrawdown: outcomes.length ? returnSequenceDrawdown(returns) : null,
        maxLossStreak: maxLossStreak(returns),
        averageExcessReturn: averageNullable(outcomes.map((item) => item.excessReturn)),
        winRateLow: winInterval?.[0] ?? null,
        winRateHigh: winInterval?.[1] ?? null,
        averageCostPct: outcomes.length ? average(outcomes.map((item) => item.tradeCostPct)) : null,
      };
    });

  const horizons = calculateHorizons(signals);
  const buySignals = signals.filter((signal) => signal.direction === "buy");
  const sellSignals = signals.filter((signal) => signal.direction === "sell");
  const directions = {
    buy: { signalCount: buySignals.length, tradable: true, horizons: calculateHorizons(buySignals) },
    sell: { signalCount: sellSignals.length, tradable: false, horizons: calculateHorizons(sellSignals) },
  };
  const recentWindowPeriods = Number.isFinite(options.recentWindowPeriods)
    ? Math.max(60, Math.round(options.recentWindowPeriods ?? 252))
    : 252;
  const recentFromIndex = Math.max(0, candles.length - recentWindowPeriods);
  const recentBuy = { signalCount: buySignals.filter((signal) => signal.index >= recentFromIndex).length, tradable: true, horizons: calculateHorizons(buySignals, recentFromIndex) };
  const recentSell = { signalCount: sellSignals.filter((signal) => signal.index >= recentFromIndex).length, tradable: false, horizons: calculateHorizons(sellSignals, recentFromIndex) };
  const recentPrimary = recentBuy.horizons.find((item) => item.periods === 10) ?? recentBuy.horizons[0];
  const recentStatus = assessRecentBuyStatus(recentPrimary);

  return {
    totalSignals: signals.length,
    buySignals: buySignals.length,
    sellSignals: sellSignals.length,
    skippedSignals: skippedSignalIndexes.size,
    roundTripCostPct,
    executionModel: `信号后一根K线开盘成交，${options.exitRule === "sell-signal" ? "B持仓遇S后下一根开盘退出，最迟固定观察期收盘退出" : "固定观察期收盘退出"}；受阻退出顺延，未退出单列；${costModel === "liquidity" ? "按信号K线估算流动性成本" : "固定交易摩擦"}；A股校验T+1及涨跌停成交约束`,
    horizons,
    directions,
    recent: {
      windowPeriods: recentWindowPeriods,
      fromDate: candles[recentFromIndex]?.date ?? "",
      status: recentStatus.status,
      label: recentStatus.label,
      buy: recentBuy,
      sell: recentSell,
    },
    costModel,
  };
}

export function resolveCnPriceLimitPct(code: string, date: string, name = ""): number | null {
  const normalizedCode = code.trim().replace(/^(?:sh|sz|bj)/i, "").replace(/\.(?:sh|sz|bj)$/i, "");
  if (!/^\d{6}$/.test(normalizedCode)) return 9.8;
  if (/^[48]/.test(normalizedCode)) return 29.8;
  if (/^(?:688|689)/.test(normalizedCode)) return 19.8;
  if (/^(?:300|301)/.test(normalizedCode) && date >= "2020-08-24") return 19.8;
  if (/(?:\*?ST|退)/i.test(name) && date < "2026-07-06") return 4.8;
  return 9.8;
}

export function estimateLiquidityRoundTripCostPct(
  candle: Candle,
  positionValue = 80_000,
  baseRoundTripCostPct = 0.25,
): number {
  const dailyAmount = Math.max(candle.amount, candle.adjustedAmount, candle.close * candle.volume, 0);
  if (!(dailyAmount > 0) || !(positionValue > 0)) return Math.max(baseRoundTripCostPct, 1);
  const participation = Math.max(0, positionValue / dailyAmount);
  const liquidityPremiumPct = Math.min(0.75, Math.sqrt(participation) * 1.5);
  return Math.min(2, Math.max(0, baseRoundTripCostPct) + liquidityPremiumPct);
}

function resolveBacktestPriceLimitPct(options: SignalBacktestOptions, entryDate: string): number | null {
  if (options.limitUpDownPct === null || options.market === "US") return null;
  if (Number.isFinite(options.limitUpDownPct)) return Math.max(0, options.limitUpDownPct ?? 0);
  return resolveCnPriceLimitPct(options.code ?? "", entryDate, options.name ?? "");
}

function assessRecentBuyStatus(primary: BacktestHorizon | undefined): { status: BacktestRecentAssessment["status"]; label: string } {
  if (!primary || primary.samples < 8) return { status: "insufficient", label: "近期样本不足" };
  if (primary.wins === primary.samples && (primary.averageReturn ?? 0) > 0) return { status: "active", label: "近期样本全胜，仍需验证" };
  if ((primary.averageReturn ?? 0) > 0 && (primary.profitFactor ?? 0) >= 1.1) return { status: "active", label: "近期优势有效" };
  if ((primary.averageReturn ?? 0) > 0 || (primary.profitFactor ?? 0) >= 1) return { status: "watch", label: "近期优势偏弱" };
  return { status: "weak", label: "近期优势失效" };
}

export function calculateRiskMetrics(candles: Candle[], benchmark: Candle[] = [], periodsPerYear = 252): RiskMetrics {
  const returns = simpleReturns(candles);
  const benchmarkByDate = new Map(benchmark.map((candle) => [candle.date, candle]));
  const comparableCandles = candles.flatMap((candle) => {
    const matchingBenchmark = benchmarkByDate.get(candle.date);
    return matchingBenchmark && [candle.close, matchingBenchmark.close].every((value) => Number.isFinite(value) && value > 0)
      ? [{ stock: candle, benchmark: matchingBenchmark }]
      : [];
  });
  const paired = candles.slice(1).flatMap((candle, index) => {
    const previous = candles[index];
    const currentBenchmark = benchmarkByDate.get(candle.date);
    const previousBenchmark = previous ? benchmarkByDate.get(previous.date) : undefined;
    if (!previous || !currentBenchmark || !previousBenchmark
      || ![candle.close, previous.close, currentBenchmark.close, previousBenchmark.close].every((value) => Number.isFinite(value) && value > 0)) return [];
    return [[(candle.close / previous.close) - 1, (currentBenchmark.close / previousBenchmark.close) - 1] as const];
  });
  const totalReturn = candles.length > 1 && candles[0].close > 0 ? ((candles.at(-1)!.close / candles[0].close) - 1) * 100 : null;
  const years = returns.length / periodsPerYear;
  const annualizedReturn = totalReturn != null && years > 0 ? ((1 + totalReturn / 100) ** (1 / years) - 1) * 100 : null;
  const dailyMean = returns.length ? average(returns) : null;
  const dailyStd = standardDeviation(returns);
  const downside = standardDeviation(returns.filter((value) => value < 0));
  const drawdowns = drawdownSeries(candles.map((candle) => candle.close));
  const sorted = [...returns].sort((left, right) => left - right);
  const tailCount = Math.max(1, Math.ceil(sorted.length * 0.05));
  // Keep standalone stock risk on its full history, but compare equal date ranges.
  const comparisonStart = comparableCandles[0];
  const comparisonEnd = comparableCandles.at(-1);
  const hasComparisonPeriod = comparisonStart && comparisonEnd && comparisonStart.stock.date < comparisonEnd.stock.date;
  const comparableStockReturn = hasComparisonPeriod ? ((comparisonEnd.stock.close / comparisonStart.stock.close) - 1) * 100 : null;
  const benchmarkReturn = hasComparisonPeriod ? ((comparisonEnd.benchmark.close / comparisonStart.benchmark.close) - 1) * 100 : null;
  const covarianceValue = covariance(paired.map((item) => item[0]), paired.map((item) => item[1]));
  const benchmarkVariance = variance(paired.map((item) => item[1]));
  const beta = covarianceValue != null && benchmarkVariance != null && benchmarkVariance > 0 ? covarianceValue / benchmarkVariance : null;
  const pairedStockMean = paired.length ? average(paired.map((item) => item[0])) : null;
  const benchmarkMean = paired.length ? average(paired.map((item) => item[1])) : null;
  return {
    samples: returns.length,
    totalReturn,
    annualizedReturn,
    annualizedVolatility: dailyStd == null ? null : dailyStd * Math.sqrt(periodsPerYear) * 100,
    downsideVolatility: downside == null ? null : downside * Math.sqrt(periodsPerYear) * 100,
    maxDrawdown: drawdowns.length ? Math.min(...drawdowns) * 100 : null,
    currentDrawdown: drawdowns.length ? drawdowns.at(-1)! * 100 : null,
    sharpe: dailyMean != null && dailyStd ? (dailyMean / dailyStd) * Math.sqrt(periodsPerYear) : null,
    sortino: dailyMean != null && downside ? (dailyMean / downside) * Math.sqrt(periodsPerYear) : null,
    valueAtRisk95: sorted.length ? sorted[Math.max(0, tailCount - 1)] * 100 : null,
    expectedShortfall95: sorted.length ? average(sorted.slice(0, tailCount)) * 100 : null,
    benchmarkReturn,
    excessReturn: comparableStockReturn != null && benchmarkReturn != null ? comparableStockReturn - benchmarkReturn : null,
    beta,
    alphaAnnualized: beta != null && pairedStockMean != null && benchmarkMean != null ? (pairedStockMean - beta * benchmarkMean) * periodsPerYear * 100 : null,
    correlation: paired.length > 2 ? correlation(paired.map((item) => item[0]), paired.map((item) => item[1])) : null,
  };
}

export function buildChartEvents(
  newsItems: NewsItem[],
  financialDataset: FinancialDataset,
  code: string,
): ChartEvent[] {
  const events: ChartEvent[] = [];
  newsItems
    .filter((item) => item.code === code)
    .slice(0, 40)
    .forEach((item) => {
      const date = extractDate(item.publishedAt);
      if (!date) return;
      events.push({
        date,
        kind: "news",
        label: item.title,
        tone: item.sentiment === "正面" ? "up" : item.sentiment === "负面" ? "down" : "neutral",
      });
    });
  if (financialDataset.code === code) {
    financialDataset.reports.forEach((report) => {
      const date = extractDate(report.noticeDate || report.reportDate);
      if (!date) return;
      events.push({
        date,
        kind: "report",
        label: `${report.periodLabel}财报发布`,
        tone: (report.netProfitYoY ?? 0) > 0 ? "up" : (report.netProfitYoY ?? 0) < 0 ? "down" : "neutral",
      });
    });
    const dividendDate = extractDate(financialDataset.snapshot.latestDividendDate);
    if (dividendDate) {
      events.push({
        date: dividendDate,
        kind: "dividend",
        label: financialDataset.snapshot.latestDividendProfile || "现金分红",
        tone: "up",
      });
    }
  }
  return events.sort((left, right) => left.date.localeCompare(right.date));
}

export function buildResearchReport({
  code,
  name,
  timeframe,
  candles,
  conclusion,
  backtest,
  financialDataset,
  newsDataset,
  generatedAt,
}: {
  code: string;
  name: string;
  timeframe: Timeframe;
  candles: Candle[];
  conclusion: { label: string; summary: string; points: string[] } | null;
  backtest: SignalBacktest;
  financialDataset: FinancialDataset;
  newsDataset: ParsedNewsDataset;
  generatedAt: string;
}): string {
  const latest = candles.at(-1);
  const snapshot = financialDataset.code === code ? financialDataset.snapshot : null;
  const lines = [
    `# TrendSight 研究报告：${name || code} ${code}`,
    "",
    `- 生成时间：${generatedAt}`,
    `- K线周期：${timeframe}`,
    `- 数据区间：${candles.at(0)?.key ?? "—"} 至 ${latest?.key ?? "—"}`,
    `- 最新收盘：${latest ? latest.close.toFixed(3) : "—"}`,
    `- 最新涨跌幅：${latest ? `${latest.changePct >= 0 ? "+" : ""}${latest.changePct.toFixed(2)}%` : "—"}`,
    "",
    "## K线研判",
    "",
    conclusion ? `**${conclusion.label}**：${conclusion.summary}` : "样本不足，暂无法生成研判。",
    ...(conclusion?.points.map((point) => `- ${point}`) ?? []),
    "",
    "## B/S 信号历史验证",
    "",
    `共识别 ${backtest.totalSignals} 个去重信号（B ${backtest.buySignals} / S ${backtest.sellSignals}）。`,
    `- 近期状态：${backtest.recent?.label ?? "样本不足"}${backtest.recent?.fromDate ? `（${backtest.recent.fromDate} 起）` : ""}`,
    "- B 点（可交易方向验证）：",
    ...(backtest.directions?.buy.horizons ?? backtest.horizons).map((item) => `  - ${item.periods}期：样本 ${item.samples}，胜率 ${formatPercent(item.winRate)}，平均收益 ${formatPercent(item.averageReturn)}，Profit Factor ${formatMultiple(item.profitFactor)}`),
    "- S 点（仅风险提示，不按可直接做空解释）：",
    ...(backtest.directions?.sell.horizons ?? []).map((item) => `  - ${item.periods}期：样本 ${item.samples}，方向胜率 ${formatPercent(item.winRate)}，平均方向收益 ${formatPercent(item.averageReturn)}，Profit Factor ${formatMultiple(item.profitFactor)}`),
    "",
    "## 估值与基本面",
    "",
    `- PE TTM：${formatMultiple(snapshot?.peTtm ?? null)}`,
    `- PB：${formatMultiple(snapshot?.pb ?? null)}`,
    `- 股息率 TTM：${formatPercent(snapshot?.dividendYieldTtm ?? null)}`,
    `- 财报截至：${financialDataset.analysis.latestReportDate || "—"}`,
    "",
    "## 舆情",
    "",
    `- 新闻数量：${newsDataset.summary.total}`,
    `- 综合倾向：${newsDataset.summary.tone}`,
    `- 综合得分：${newsDataset.summary.averageScore.toFixed(3)}`,
    ...newsDataset.items.slice(0, 5).map((item) => `- ${item.publishedAt || "时间未知"}｜${item.sentiment}｜[${item.title}](${item.url})`),
    "",
    `> 本报告由公开数据和规则模型生成，仅供研究参考，不构成投资建议。信号回测采用${backtest.costModel === "liquidity" ? "流动性分层" : "固定"}交易摩擦，并校验可识别的涨跌停成交约束；S 点不代表可直接建立空头仓位。`,
    "",
  ];
  return lines.join("\n");
}

function extractDate(value: string): string {
  return value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function averageNullable(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => value != null && Number.isFinite(value));
  return numbers.length ? average(numbers) : null;
}

function wilsonInterval(wins: number, samples: number): [number, number] | null {
  if (!samples) return null;
  const z = 1.96;
  const probability = wins / samples;
  const denominator = 1 + (z * z) / samples;
  const center = (probability + (z * z) / (2 * samples)) / denominator;
  const margin = (z / denominator) * Math.sqrt((probability * (1 - probability)) / samples + (z * z) / (4 * samples * samples));
  return [Math.max(0, center - margin) * 100, Math.min(1, center + margin) * 100];
}

function returnSequenceDrawdown(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const value of returns) {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, ((equity / peak) - 1) * 100);
  }
  return worst;
}

function maxLossStreak(returns: number[]): number {
  let current = 0;
  let maximum = 0;
  returns.forEach((value) => {
    current = value < 0 ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  });
  return maximum;
}

function simpleReturns(candles: Candle[]): number[] {
  return candles.slice(1).flatMap((candle, index) => {
    const previous = candles[index];
    return previous?.close > 0 ? [(candle.close / previous.close) - 1] : [];
  });
}

function drawdownSeries(values: number[]): number[] {
  let peak = Number.NEGATIVE_INFINITY;
  return values.map((value) => {
    peak = Math.max(peak, value);
    return peak > 0 ? (value / peak) - 1 : 0;
  });
}

function variance(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values);
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

function standardDeviation(values: number[]): number | null {
  const value = variance(values);
  return value == null ? null : Math.sqrt(value);
}

function covariance(left: number[], right: number[]): number | null {
  const length = Math.min(left.length, right.length);
  if (length < 2) return null;
  const leftSlice = left.slice(0, length);
  const rightSlice = right.slice(0, length);
  const leftMean = average(leftSlice);
  const rightMean = average(rightSlice);
  return leftSlice.reduce((sum, value, index) => sum + (value - leftMean) * (rightSlice[index] - rightMean), 0) / (length - 1);
}

function correlation(left: number[], right: number[]): number | null {
  const covarianceValue = covariance(left, right);
  const leftDeviation = standardDeviation(left);
  const rightDeviation = standardDeviation(right);
  return covarianceValue == null || !leftDeviation || !rightDeviation ? null : covarianceValue / (leftDeviation * rightDeviation);
}

function formatPercent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMultiple(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}x`;
}
