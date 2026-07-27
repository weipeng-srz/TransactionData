import type { FinancialDataset } from "./financials.ts";
import type { Candle, IndicatorSet, Timeframe } from "./market.ts";
import type { NewsItem, ParsedNewsDataset } from "./news.ts";

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
};

export type SignalBacktest = {
  totalSignals: number;
  buySignals: number;
  sellSignals: number;
  skippedSignals: number;
  roundTripCostPct: number;
  executionModel: string;
  horizons: BacktestHorizon[];
};

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
  options: { benchmark?: Candle[]; roundTripCostPct?: number } = {},
): SignalBacktest {
  const roundTripCostPct = Number.isFinite(options.roundTripCostPct) ? Math.max(0, options.roundTripCostPct ?? 0) : 0.25;
  const benchmarkByDate = new Map((options.benchmark ?? []).map((candle) => [candle.date, candle]));
  const signals: Array<{ index: number; direction: "buy" | "sell" }> = [];
  let previous: { index: number; direction: "buy" | "sell" } | null = null;
  indicators.guidePoints.forEach((guide, index) => {
    if (!guide) return;
    if (previous && previous.direction === guide.type && index - previous.index <= 3) return;
    const signal = { index, direction: guide.type };
    signals.push(signal);
    previous = signal;
  });

  const skippedSignalIndexes = new Set<number>();
  const horizons = [...new Set(periods)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right)
    .map((horizon): BacktestHorizon => {
      const outcomes = signals.flatMap((signal) => {
        const target = candles[signal.index + horizon];
        const signalCandle = candles[signal.index];
        const entry = candles[signal.index + 1];
        if (!signalCandle || !entry || !target || entry.open <= 0 || entry.volume <= 0) {
          skippedSignalIndexes.add(signal.index);
          return [];
        }
        const gapPct = signalCandle.close > 0 ? ((entry.open / signalCandle.close) - 1) * 100 : 0;
        if ((signal.direction === "buy" && gapPct >= 9.8) || (signal.direction === "sell" && gapPct <= -9.8)) {
          skippedSignalIndexes.add(signal.index);
          return [];
        }
        const direction = signal.direction === "buy" ? 1 : -1;
        const grossReturn = ((target.close / entry.open) - 1) * 100 * direction;
        const strategyReturn = grossReturn - roundTripCostPct;
        const path = candles.slice(signal.index + 1, signal.index + horizon + 1);
        const worstAdverseMove = signal.direction === "buy"
          ? Math.min(0, ...path.map((candle) => ((candle.low / entry.open) - 1) * 100))
          : Math.min(0, ...path.map((candle) => ((entry.open / candle.high) - 1) * 100));
        const bestFavorableMove = signal.direction === "buy"
          ? Math.max(0, ...path.map((candle) => ((candle.high / entry.open) - 1) * 100))
          : Math.max(0, ...path.map((candle) => ((entry.open / candle.low) - 1) * 100));
        const benchmarkEntry = benchmarkByDate.get(entry.date);
        const benchmarkTarget = benchmarkByDate.get(target.date);
        const benchmarkReturn = benchmarkEntry && benchmarkTarget && benchmarkEntry.open > 0
          ? ((benchmarkTarget.close / benchmarkEntry.open) - 1) * 100 * direction
          : null;
        return [{ strategyReturn, worstAdverseMove, bestFavorableMove, excessReturn: benchmarkReturn == null ? null : strategyReturn - benchmarkReturn }];
      });
      const returns = outcomes.map((item) => item.strategyReturn);
      const wins = returns.filter((value) => value > 0).length;
      const positive = returns.filter((value) => value > 0);
      const negative = returns.filter((value) => value < 0);
      const winInterval = wilsonInterval(wins, outcomes.length);
      return {
        periods: horizon,
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
      };
    });

  return {
    totalSignals: signals.length,
    buySignals: signals.filter((signal) => signal.direction === "buy").length,
    sellSignals: signals.filter((signal) => signal.direction === "sell").length,
    skippedSignals: skippedSignalIndexes.size,
    roundTripCostPct,
    executionModel: "信号后一根K线开盘成交，固定观察期收盘退出",
    horizons,
  };
}

export function calculateRiskMetrics(candles: Candle[], benchmark: Candle[] = [], periodsPerYear = 252): RiskMetrics {
  const returns = simpleReturns(candles);
  const benchmarkByDate = new Map(benchmark.map((candle, index) => [candle.date, { candle, index }]));
  const paired = candles.slice(1).flatMap((candle, index) => {
    const previous = candles[index];
    const currentBenchmark = benchmarkByDate.get(candle.date);
    if (!previous || !currentBenchmark || currentBenchmark.index < 1) return [];
    const previousBenchmark = benchmark[currentBenchmark.index - 1];
    if (!previous.close || !previousBenchmark?.close) return [];
    return [[(candle.close / previous.close) - 1, (currentBenchmark.candle.close / previousBenchmark.close) - 1] as const];
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
  const benchmarkReturn = benchmark.length > 1 && benchmark[0].close > 0 ? ((benchmark.at(-1)!.close / benchmark[0].close) - 1) * 100 : null;
  const covarianceValue = covariance(paired.map((item) => item[0]), paired.map((item) => item[1]));
  const benchmarkVariance = variance(paired.map((item) => item[1]));
  const beta = covarianceValue != null && benchmarkVariance != null && benchmarkVariance > 0 ? covarianceValue / benchmarkVariance : null;
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
    excessReturn: totalReturn != null && benchmarkReturn != null ? totalReturn - benchmarkReturn : null,
    beta,
    alphaAnnualized: beta != null && dailyMean != null && benchmarkMean != null ? (dailyMean - beta * benchmarkMean) * periodsPerYear * 100 : null,
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
    ...backtest.horizons.map((item) => `- ${item.periods}期：样本 ${item.samples}，胜率 ${formatPercent(item.winRate)}，平均收益 ${formatPercent(item.averageReturn)}，最差不利波动 ${formatPercent(item.worstAdverseMove)}`),
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
    "> 本报告由公开数据和规则模型生成，仅供研究参考，不构成投资建议。信号回测未计入手续费、滑点和涨跌停成交约束。",
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
