import type { FinancialDataset } from "./financials.ts";
import type { Candle, DataQuality, IndicatorSet, IntentAnalysis } from "./market.ts";
import type { NewsItem } from "./news.ts";
import type { RiskMetrics, SignalBacktest } from "./research.ts";

export type StockScoreReasonTone = "positive" | "negative" | "neutral";

export type StockScoreReason = {
  tone: StockScoreReasonTone;
  text: string;
};

export type StockScoreDimension = {
  key: "trend" | "momentum" | "capital" | "profitability" | "growth" | "valuation" | "sentiment" | "risk";
  label: string;
  shortLabel: string;
  score: number;
  coverage: number;
  summary: string;
  reasons: StockScoreReason[];
};

export type StockScoreSignal = {
  action: "正向证据较多" | "证据大致均衡" | "风险证据较多" | "数据不足";
  tone: "buy" | "hold" | "sell";
  headline: string;
  description: string;
};

export type StockScoreReport = {
  score: number;
  coverage: number;
  signal: StockScoreSignal;
  dimensions: StockScoreDimension[];
};

export type StockScoreInput = {
  candles: Candle[];
  indicators: IndicatorSet;
  currentPrice: number | null;
  intent: IntentAnalysis | null;
  financials: FinancialDataset;
  newsItems: NewsItem[];
  risk: RiskMetrics;
  backtest: SignalBacktest;
  dataQuality: DataQuality;
};

type ScoreItem = {
  score: number | null;
  text: string;
  weight?: number;
};

type DimensionInput = {
  key: StockScoreDimension["key"];
  label: string;
  shortLabel: string;
  expected: number;
  items: ScoreItem[];
};

export function buildStockScore(input: StockScoreInput): StockScoreReport {
  const latestIndex = input.candles.length - 1;
  const latest = input.candles[latestIndex];
  const price = positiveNumber(input.currentPrice) ?? positiveNumber(latest?.close);
  const ma5 = input.indicators.ma5[latestIndex] ?? null;
  const ma10 = input.indicators.ma10[latestIndex] ?? null;
  const ma20 = input.indicators.ma20[latestIndex] ?? null;
  const return20 = periodReturn(input.candles, 20);
  const return60 = periodReturn(input.candles, 60);
  const rsi = input.indicators.rsi[latestIndex] ?? null;
  const macdDif = finite(input.indicators.macdDif[latestIndex]);
  const macdDea = finite(input.indicators.macdDea[latestIndex]);
  const k = finite(input.indicators.k[latestIndex]);
  const d = finite(input.indicators.d[latestIndex]);
  const recentGuide = latestGuide(input.indicators, latestIndex);
  const latestFinancial = input.financials.analysis.periods[0];
  const ttm = latestFinancial?.ttm;
  const ttmYoY = latestFinancial?.ttmYoY;
  const snapshot = input.financials.snapshot;
  const holder = input.financials.holderStructure;
  const newsSummary = summarizeNews(input.newsItems);
  const backtestHorizon = input.backtest.horizons.find((item) => item.periods === 20)
    ?? input.backtest.horizons.at(-1);

  const maAlignmentScore = price != null && ma5 != null && ma10 != null && ma20 != null
    ? price > ma5 && ma5 > ma10 && ma10 > ma20
      ? 90
      : price < ma5 && ma5 < ma10 && ma10 < ma20
        ? 12
        : price >= ma20
          ? 64
          : 36
    : null;
  const priceVsMa20 = price != null && ma20 != null && ma20 > 0 ? ((price / ma20) - 1) * 100 : null;

  const dimensions = [
    dimension({
      key: "trend",
      label: "趋势结构",
      shortLabel: "趋势",
      expected: 4,
      items: [
        {
          score: maAlignmentScore,
          text: maAlignmentScore == null
            ? "MA5/10/20 样本尚未形成"
            : maAlignmentScore >= 75
              ? "现价与 MA5/10/20 形成多头排列"
              : maAlignmentScore <= 25
                ? "现价与 MA5/10/20 形成空头排列"
                : "均线结构仍处于交错整理",
          weight: 1.4,
        },
        metricItem(priceVsMa20, scale(priceVsMa20, -10, 10), `现价相对 MA20 ${percent(priceVsMa20)}`),
        metricItem(return20, scale(return20, -18, 28), `近 20 日收益 ${percent(return20)}`),
        metricItem(return60, scale(return60, -25, 45), `近 60 日收益 ${percent(return60)}`),
      ],
    }),
    dimension({
      key: "momentum",
      label: "动量强度",
      shortLabel: "动量",
      expected: 4,
      items: [
        metricItem(rsi, rsiScore(rsi), `RSI14 ${number(rsi, 1)}`),
        metricItem(
          macdDif != null && macdDea != null ? macdDif - macdDea : null,
          macdDif != null && macdDea != null && price != null
            ? clamp(50 + ((macdDif - macdDea) / price) * 3_000, 12, 88)
            : null,
          macdDif == null || macdDea == null ? "MACD 样本不足" : `MACD ${macdDif >= macdDea ? "位于信号线上方" : "位于信号线下方"}`,
        ),
        metricItem(
          k != null && d != null ? k - d : null,
          k != null && d != null ? clamp(50 + (k - d) * 1.6, 15, 85) : null,
          k == null || d == null ? "KDJ 样本不足" : `KDJ ${k >= d ? "偏多" : "偏空"}，K ${number(k, 1)} / D ${number(d, 1)}`,
        ),
        {
          score: recentGuide ? (recentGuide.type === "buy" ? 82 : 18) : null,
          text: recentGuide
            ? `最近指引为 ${recentGuide.type === "buy" ? "B 买入" : "S 卖出"}，强度 ${recentGuide.score}`
            : "最近 5 个交易日没有 B/S 指引",
        },
      ],
    }),
    dimension({
      key: "capital",
      label: "资金行为",
      shortLabel: "资金",
      expected: 5,
      items: [
        {
          score: input.intent ? clamp(50 + input.intent.score * 10, 5, 95) : null,
          text: input.intent ? `${input.intent.label}，模型强度 ${signed(input.intent.score, 2)}` : "资金行为样本尚未生成",
          weight: 1.35,
        },
        metricItem(input.intent?.activeNetRatio ?? null, scale(input.intent?.activeNetRatio ?? null, -35, 35), `主动净比 ${percent(input.intent?.activeNetRatio ?? null)}`),
        metricItem(input.intent?.largeNetRatio ?? null, scale(input.intent?.largeNetRatio ?? null, -35, 35), `大额净比 ${percent(input.intent?.largeNetRatio ?? null)}`),
        metricItem(input.intent?.closeVsVwapPct ?? null, scale(input.intent?.closeVsVwapPct ?? null, -3, 3), `收盘相对 VWAP ${percent(input.intent?.closeVsVwapPct ?? null)}`),
        metricItem(
          holder.institutionalChangePp,
          scale(holder.institutionalChangePp, -3, 3),
          holder.institutionalChangePp == null ? "机构持仓变化尚无可比期" : `机构持仓变化 ${signed(holder.institutionalChangePp, 2)} 个百分点`,
        ),
      ],
    }),
    dimension({
      key: "profitability",
      label: "盈利质量",
      shortLabel: "盈利",
      expected: 5,
      items: [
        metricItem(ttm?.roe ?? null, scale(ttm?.roe ?? null, 0, 25), `TTM ROE ${percent(ttm?.roe ?? null)}`),
        metricItem(ttm?.roic ?? null, scale(ttm?.roic ?? null, 0, 20), `TTM ROIC ${percent(ttm?.roic ?? null)}`),
        metricItem(ttm?.grossMargin ?? null, scale(ttm?.grossMargin ?? null, 5, 50), `TTM 毛利率 ${percent(ttm?.grossMargin ?? null)}`),
        metricItem(ttm?.netMargin ?? null, scale(ttm?.netMargin ?? null, -5, 25), `TTM 净利率 ${percent(ttm?.netMargin ?? null)}`),
        metricItem(ttm?.cashCoverage ?? null, scale(ttm?.cashCoverage ?? null, 0, 1.5), `经营现金覆盖 ${multiple(ttm?.cashCoverage ?? null)}`),
      ],
    }),
    dimension({
      key: "growth",
      label: "成长能力",
      shortLabel: "成长",
      expected: 3,
      items: [
        metricItem(ttmYoY?.revenue ?? null, scale(ttmYoY?.revenue ?? null, -20, 35), `TTM 营收同比 ${percent(ttmYoY?.revenue ?? null)}`),
        metricItem(ttmYoY?.parentNetProfit ?? null, scale(ttmYoY?.parentNetProfit ?? null, -35, 45), `TTM 归母净利同比 ${percent(ttmYoY?.parentNetProfit ?? null)}`),
        metricItem(ttmYoY?.deductNetProfit ?? null, scale(ttmYoY?.deductNetProfit ?? null, -35, 45), `TTM 扣非净利同比 ${percent(ttmYoY?.deductNetProfit ?? null)}`),
      ],
    }),
    dimension({
      key: "valuation",
      label: "估值吸引力",
      shortLabel: "估值",
      expected: 5,
      items: [
        valuationItem("PE(TTM)", snapshot.peTtm, snapshot.peTtmPercentile, 8, 45),
        valuationItem("PB", snapshot.pb, snapshot.pbPercentile, 0.8, 8),
        valuationItem("PS(TTM)", snapshot.psTtm, snapshot.psTtmPercentile, 0.8, 12),
        pegItem(snapshot.peg),
        metricItem(snapshot.dividendYieldTtm, scale(snapshot.dividendYieldTtm, 0, 5), `TTM 股息率 ${percent(snapshot.dividendYieldTtm)}`),
      ],
    }),
    dimension({
      key: "sentiment",
      label: "舆情催化",
      shortLabel: "舆情",
      expected: 3,
      items: [
        metricItem(newsSummary.average, scale(newsSummary.average, -1, 1), `新闻情绪均值 ${signed(newsSummary.average, 3)}`),
        metricItem(newsSummary.negativeRatio, inverseScale(newsSummary.negativeRatio, 0, 0.6), `负面新闻占比 ${percentRatio(newsSummary.negativeRatio)}`),
        metricItem(newsSummary.positiveRatio, scale(newsSummary.positiveRatio, 0, 0.6), `正面新闻占比 ${percentRatio(newsSummary.positiveRatio)}`),
      ],
    }),
    dimension({
      key: "risk",
      label: "风险韧性",
      shortLabel: "风险",
      expected: 7,
      items: [
        metricItem(input.risk.annualizedVolatility, inverseScale(input.risk.annualizedVolatility, 12, 60), `年化波动率 ${percent(input.risk.annualizedVolatility)}`),
        metricItem(input.risk.maxDrawdown, inverseScale(abs(input.risk.maxDrawdown), 5, 45), `最大回撤 ${percent(input.risk.maxDrawdown)}`),
        metricItem(input.risk.sharpe, scale(input.risk.sharpe, -1, 2), `Sharpe ${number(input.risk.sharpe, 2)}`),
        metricItem(input.risk.currentDrawdown, inverseScale(abs(input.risk.currentDrawdown), 0, 20), `当前回撤 ${percent(input.risk.currentDrawdown)}`),
        metricItem(
          backtestHorizon && backtestHorizon.samples >= 3 ? backtestHorizon.winRate : null,
          backtestHorizon && backtestHorizon.samples >= 3 ? clamp(backtestHorizon.winRate ?? 50, 0, 100) : null,
          backtestHorizon && backtestHorizon.samples >= 3
            ? `${backtestHorizon.periods} 日信号胜率 ${percent(backtestHorizon.winRate)}（${backtestHorizon.samples} 样本）`
            : "回测有效样本少于 3 个",
        ),
        metricItem(
          input.dataQuality.duplicateRate,
          inverseScale(input.dataQuality.duplicateRate, 0, 0.08),
          `疑似重复率 ${percentRatio(input.dataQuality.duplicateRate)}`,
        ),
        {
          score: input.dataQuality.warnings.length === 0 ? 92 : input.dataQuality.warnings.length <= 2 ? 64 : 36,
          text: input.dataQuality.warnings.length
            ? `数据质量仍有 ${input.dataQuality.warnings.length} 项提示`
            : "当前数据质量检查未发现显著告警",
        },
      ],
    }),
  ];

  const score = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length);
  const coverage = Math.round(dimensions.reduce((sum, item) => sum + item.coverage, 0) / dimensions.length);
  return { score, coverage, signal: scoreSignal(score, coverage), dimensions };
}

function dimension(input: DimensionInput): StockScoreDimension {
  const available = input.items.filter((item): item is ScoreItem & { score: number } => item.score != null && Number.isFinite(item.score));
  const weight = available.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  const rawScore = available.length
    ? Math.round(available.reduce((sum, item) => sum + clamp(item.score, 0, 100) * (item.weight ?? 1), 0) / weight)
    : 50;
  const coverage = Math.round(clamp((available.length / input.expected) * 100, 0, 100));
  // Sparse evidence must not look like high conviction. Pull low-coverage
  // dimensions toward neutral while preserving fully covered scores.
  const score = Math.round(50 + (rawScore - 50) * (coverage / 100));
  const reasons = available
    .map((item) => ({ tone: reasonTone(item.score), text: item.text, distance: Math.abs(item.score - 50) }))
    .sort((left, right) => right.distance - left.distance)
    .slice(0, 3)
    .map(({ tone, text }) => ({ tone, text }));
  if (!reasons.length) reasons.push({ tone: "neutral", text: "当前维度数据不足，暂按 50 分中性处理" });
  return {
    key: input.key,
    label: input.label,
    shortLabel: input.shortLabel,
    score,
    coverage,
    summary: score >= 75 ? "优势明显" : score >= 60 ? "略占优势" : score >= 45 ? "中性观察" : score >= 30 ? "存在压力" : "风险偏高",
    reasons,
  };
}

function metricItem(value: number | null, score: number | null, text: string): ScoreItem {
  return { score: value == null || !Number.isFinite(value) ? null : score, text };
}

function valuationItem(label: string, value: number | null, percentile: number | null, low: number, high: number): ScoreItem {
  if (percentile != null && Number.isFinite(percentile)) {
    return { score: clamp(100 - percentile, 0, 100), text: `${label} ${multiple(value)}，历史分位 ${percent(percentile)}` };
  }
  if (value == null || !Number.isFinite(value)) return { score: null, text: `${label} 暂无可用数据` };
  if (value <= 0) return { score: 18, text: `${label} 为负，当前盈利口径不支持常规估值` };
  return { score: inverseScale(value, low, high), text: `${label} ${multiple(value)}，暂无历史分位` };
}

function pegItem(value: number | null): ScoreItem {
  if (value == null || !Number.isFinite(value)) return { score: null, text: "PEG 暂无可用数据" };
  if (value <= 0) return { score: 12, text: `PEG ${number(value, 2)}，负值不支持常规成长估值` };
  return { score: inverseScale(value, 0.6, 3), text: `PEG ${number(value, 2)}` };
}

function summarizeNews(items: NewsItem[]): { average: number | null; positiveRatio: number | null; negativeRatio: number | null } {
  if (!items.length) return { average: null, positiveRatio: null, negativeRatio: null };
  const average = items.reduce((sum, item) => sum + item.sentimentScore, 0) / items.length;
  return {
    average,
    positiveRatio: items.filter((item) => item.sentiment === "正面").length / items.length,
    negativeRatio: items.filter((item) => item.sentiment === "负面").length / items.length,
  };
}

function scoreSignal(score: number, coverage: number): StockScoreSignal {
  if (coverage < 35) {
    return {
      action: "数据不足",
      tone: "hold",
      headline: "数据覆盖不足，暂不形成方向结论",
      description: "补齐基本面、估值与新闻数据后，证据状态会自动更新。",
    };
  }
  if (score >= 72) {
    return {
      action: "正向证据较多",
      tone: "buy",
      headline: "多维数据共振偏强",
      description: "当前正向证据占优，但仍应结合价格区间、仓位和风险承受能力复核。",
    };
  }
  if (score <= 38) {
    return {
      action: "风险证据较多",
      tone: "sell",
      headline: "弱项与风险项占据主导",
      description: "当前风险证据占优，建议优先核对下方扣分原因与数据时效。",
    };
  }
  return {
    action: "证据大致均衡",
    tone: "hold",
    headline: score >= 58 ? "优势存在，但尚未形成充分共振" : score <= 48 ? "短板偏多，等待信号修复" : "多空证据接近平衡",
    description: "当前不形成明确买卖方向，等待趋势、资金或基本面出现更一致的变化。",
  };
}

function latestGuide(indicators: IndicatorSet, latestIndex: number) {
  for (let index = latestIndex; index >= Math.max(0, latestIndex - 4); index -= 1) {
    const guide = indicators.guidePoints[index];
    if (guide) return guide;
  }
  return null;
}

function periodReturn(candles: Candle[], periods: number): number | null {
  if (candles.length <= periods) return null;
  const start = candles[candles.length - periods - 1];
  const end = candles.at(-1);
  return start?.close > 0 && end ? ((end.close / start.close) - 1) * 100 : null;
}

function rsiScore(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 30) return scale(value, 10, 30);
  if (value <= 55) return scale(value, 30, 60);
  if (value <= 70) return 80 + ((value - 55) / 15) * 10;
  if (value <= 80) return 90 - ((value - 70) / 10) * 25;
  return clamp(65 - (value - 80) * 3, 20, 65);
}

function reasonTone(score: number): StockScoreReasonTone {
  return score >= 60 ? "positive" : score <= 40 ? "negative" : "neutral";
}

function scale(value: number | null | undefined, low: number, high: number): number | null {
  return value == null || !Number.isFinite(value) ? null : clamp(((value - low) / (high - low)) * 100, 0, 100);
}

function inverseScale(value: number | null | undefined, low: number, high: number): number | null {
  const result = scale(value, low, high);
  return result == null ? null : 100 - result;
}

function positiveNumber(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function abs(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.abs(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function number(value: number | null | undefined, digits: number): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function signed(value: number | null | undefined, digits: number): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function percentRatio(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}

function multiple(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}x`;
}
