import type { Candle } from "./market.ts";
import type { NewsItem } from "./news.ts";
import panelArtifactData from "./nextDayPanelArtifact.json" with { type: "json" };
import {
  predictNextDayPanelProbability,
  type NextDayPanelModelArtifact,
} from "./nextDayPanelModel.ts";
import type { RealtimeSnapshot } from "./realtimeMarket.ts";
import type { StockMarket } from "./security.ts";

export type PredictionWindow = 60 | 126 | 250;
export type PredictionNeighborCount = 5 | 10 | 15 | 20 | 30;
export type PredictionMode = "today" | "tomorrow";

export type NextDayPredictionOptions = {
  window?: PredictionWindow;
  neighbors?: PredictionNeighborCount;
  mode?: PredictionMode;
  market?: StockMarket;
  realtimeSnapshot?: RealtimeSnapshot | null;
  benchmarkCandles?: Candle[];
  benchmarkName?: string;
  newsItems?: NewsItem[];
};

export type NextDayRuleResult = {
  key: string;
  name: string;
  description: string;
  tone: "bullish" | "risk" | "neutral";
  sampleSize: number;
  upRate: number;
  averageReturn: number;
  confidence: "极低" | "较低" | "中等" | "较高" | "高";
};

export type SimilarDayResult = {
  date: string;
  similarity: number;
  currentReturn: number;
  nextOpenReturn: number;
  nextCloseReturn: number;
  nextHighReturn: number;
  nextLowReturn: number;
  nextVolumeRatio20: number;
};

export type NextDayPredictionReport = {
  mode: PredictionMode;
  asOf: string;
  asOfTime: string;
  analysisWindow: PredictionWindow;
  availableDays: number;
  trainingSamples: number;
  target: {
    label: string;
    date: string | null;
    basis: string;
    usesCurrentSession: boolean;
    isPartialSession: boolean;
    sessionProgress: number;
  };
  signal: {
    grade: "S" | "A" | "B" | "C";
    score: number;
    state: string;
    dataSufficiency: number;
    decisionConfidence: number;
    reliability: "较低" | "中等" | "较高";
    ensembleAgreement: number;
  };
  prediction: {
    upProbability: number;
    baseUpProbability: number;
    contextAdjustment: number;
    expectedCloseReturn: number;
    expectedOpenGap: number;
    expectedHighReturn: number;
    expectedLowReturn: number;
    q25: number;
    median: number;
    q75: number;
  };
  volumePrediction: {
    expectedVolume: number;
    currentVolume: number;
    averageVolume20: number;
    expectedVolumeRatio20: number;
    volumeUpProbability: number;
    quietProbability: number;
    normalProbability: number;
    activeProbability: number;
    label: string;
  };
  technicalState: {
    return1d: number;
    return5d: number;
    return10d: number;
    return20d: number;
    openGap: number;
    amplitude: number;
    upperShadow: number;
    lowerShadow: number;
    closePosition: number;
    volumeRatio20: number;
    aboveMA5: boolean;
    aboveMA20: boolean;
    ma5Rising: boolean;
    ma20Rising: boolean;
    newHigh20: boolean;
    newHigh60: boolean;
    upStreak: number;
    downStreak: number;
    volatility20: number;
    atr14: number;
    benchmarkAvailable: boolean;
    benchmarkAsOf: string;
    benchmarkReturn1d: number;
    benchmarkReturn5d: number;
    relativeStrength5d: number;
    marketRegime: string;
  };
  similarDays: {
    count: number;
    upRate: number;
    meanReturn: number;
    medianReturn: number;
    q25: number;
    q75: number;
    averageHighReturn: number;
    averageLowReturn: number;
    averageSimilarity: number;
    upRateInterval95: [number, number];
    items: SimilarDayResult[];
  };
  distribution: Array<{ label: string; count: number; probability: number }>;
  scenarios: Array<{
    key: "strong" | "range" | "weak";
    label: string;
    probability: number;
    summary: string;
    details: string[];
  }>;
  bullishFactors: string[];
  riskFactors: string[];
  activeRules: NextDayRuleResult[];
  externalContext: {
    coverage: number;
    market: {
      available: boolean;
      name: string;
      asOf: string;
      fresh: boolean;
      return1d: number;
      return5d: number;
      relativeStrength5d: number;
      regime: string;
      role: string;
    };
    news: {
      available: boolean;
      itemCount: number;
      freshItemCount: number;
      weightedScore: number;
      confidence: number;
      tone: "正面" | "中性" | "负面";
      probabilityAdjustment: number;
      cutoff: string;
      role: string;
    };
  };
  decisionSupport: {
    action: "持有观察" | "等待确认" | "分批止盈" | "收紧止损" | "降低仓位";
    tone: "positive" | "neutral" | "warning" | "risk";
    summary: string;
    currentReturn: number | null;
    referencePrice: number;
    expectedPrice: number;
    takeProfitReference: number;
    riskReference: number;
    riskRewardRatio: number | null;
    checks: string[];
  };
  modelValidation: {
    accuracy: number | null;
    auc: number | null;
    precision: number | null;
    recall: number | null;
    brierScore: number | null;
    baselineBrierScore: number | null;
    baselineUpRate: number;
    baselineAccuracy: number;
    validationSamples: number;
    mlEnabled: boolean;
    panelEnabled: boolean;
    panelProbability: number | null;
    panelWeight: number;
    panelVersion: string;
    panelValidationAccuracy: number;
    panelValidationBrierScore: number;
    panelValidationSamples: number;
    regimeLogitAdjustment: number;
    probabilityLift: number;
    brierImprovement: number | null;
    version: string;
    reason: string;
  };
  weights: {
    rule: number;
    analog: number;
    ml: number;
    panel: number;
  };
  notice: string;
};

type FeatureState = NextDayPredictionReport["technicalState"] & {
  ma5Deviation: number;
  ma20Deviation: number;
  streak: number;
  vector: number[];
};

type BenchmarkFeature = {
  date: string;
  return1d: number;
  return5d: number;
  aboveMA20: boolean;
  volatility20: number;
  regime: string;
};

type BenchmarkLookup = {
  byDate: Map<string, BenchmarkFeature>;
  dates: string[];
};

type PreparedPredictionInput = {
  candles: Candle[];
  mode: PredictionMode;
  targetDate: string | null;
  targetLabel: string;
  basis: string;
  usesCurrentSession: boolean;
  isPartialSession: boolean;
  sessionProgress: number;
  asOfTime: string;
  observedCurrentReturn: number | null;
  observedVolume: number | null;
  decisionReferencePrice: number | null;
};

const predictionModelVersion = "ensemble-v2.2-regime";
const nextDayPanelArtifact = panelArtifactData as NextDayPanelModelArtifact;
const nextDayPanelBlendWeight = 0.75;

type TrainingRow = {
  index: number;
  feature: FeatureState;
  nextOpenReturn: number;
  nextCloseReturn: number;
  nextHighReturn: number;
  nextLowReturn: number;
  nextVolumeRatio20: number;
  nextUp: number;
  nextVolumeUp: number;
};

type LogisticModel = {
  weights: number[];
  means: number[];
  scales: number[];
};

type RuleDefinition = {
  key: string;
  name: string;
  description: string;
  tone: NextDayRuleResult["tone"];
  matches: (feature: FeatureState) => boolean;
};

const ruleDefinitions: RuleDefinition[] = [
  {
    key: "strong-trend",
    name: "强趋势延续",
    description: "单日涨幅至少 8%，且上影线不超过 1%",
    tone: "bullish",
    matches: (feature) => feature.return1d >= 0.08 && feature.upperShadow <= 0.01,
  },
  {
    key: "acceleration",
    name: "强趋势加速",
    description: "单日涨幅至少 5%、5 日涨幅至少 10%，且上影较短",
    tone: "bullish",
    matches: (feature) => feature.return1d >= 0.05 && feature.return5d >= 0.1 && feature.upperShadow <= 0.01,
  },
  {
    key: "strong-close",
    name: "强势收盘",
    description: "5 日涨幅至少 10%，收盘位于日内上方 20% 区域",
    tone: "bullish",
    matches: (feature) => feature.return5d >= 0.1 && feature.closePosition >= 0.8 && feature.upperShadow <= 0.01,
  },
  {
    key: "gap-confirmation",
    name: "高开确认",
    description: "高开至少 2%，收盘站上 MA5 且上影较短",
    tone: "bullish",
    matches: (feature) => feature.openGap >= 0.02 && feature.aboveMA5 && feature.upperShadow <= 0.01,
  },
  {
    key: "quiet-lock",
    name: "缩量锁筹",
    description: "量比不超过 0.8，收盘站上 MA5 且上影较短",
    tone: "bullish",
    matches: (feature) => feature.volumeRatio20 <= 0.8 && feature.aboveMA5 && feature.upperShadow <= 0.01,
  },
  {
    key: "single-crash",
    name: "单日暴跌",
    description: "单日跌幅达到 5% 或以上，按该股历史后验结果处理",
    tone: "risk",
    matches: (feature) => feature.return1d <= -0.05,
  },
  {
    key: "extreme-crash",
    name: "极端暴跌",
    description: "单日跌幅达到 8% 或以上，隔日延续与波动风险上升",
    tone: "risk",
    matches: (feature) => feature.return1d <= -0.08,
  },
  {
    key: "long-upper-shadow",
    name: "高位长上影",
    description: "上影线至少 3%，且近期仍有累计涨幅",
    tone: "risk",
    matches: (feature) => feature.upperShadow >= 0.03 && feature.return5d >= 0.05,
  },
];

export function buildNextDayPrediction(
  sourceCandles: Candle[],
  options: NextDayPredictionOptions = {},
): NextDayPredictionReport | null {
  const analysisWindow = options.window ?? 126;
  const requestedNeighbors = options.neighbors ?? 15;
  const prepared = preparePredictionInput(sourceCandles, options);
  const candles = prepared.candles;
  if (candles.length < 32) return null;

  const benchmarkLookup = buildBenchmarkLookup(options.benchmarkCandles ?? []);
  const latestIndex = candles.length - 1;
  const currentFeature = featureAt(candles, latestIndex, benchmarkLookup);
  if (!currentFeature) return null;

  const trainingEndExclusive = prepared.isPartialSession ? latestIndex - 1 : latestIndex;
  const startIndex = Math.max(20, trainingEndExclusive - analysisWindow);
  const rows: TrainingRow[] = [];
  for (let index = startIndex; index < trainingEndExclusive; index += 1) {
    const feature = featureAt(candles, index, benchmarkLookup);
    const next = candles[index + 1];
    const current = candles[index];
    if (!feature || !next || current.close <= 0) continue;
    const averageVolume20 = mean(candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.volume));
    const nextVolumeRatio20 = averageVolume20 > 0 ? next.volume / averageVolume20 : 1;
    rows.push({
      index,
      feature,
      nextOpenReturn: next.open / current.close - 1,
      nextCloseReturn: next.close / current.close - 1,
      nextHighReturn: next.high / current.close - 1,
      nextLowReturn: next.low / current.close - 1,
      nextVolumeRatio20,
      nextUp: next.close > current.close ? 1 : 0,
      nextVolumeUp: nextVolumeRatio20 >= 1.2 ? 1 : 0,
    });
  }
  if (rows.length < 20) return null;

  const neighborCount = Math.min(requestedNeighbors, rows.length);
  const featureVectors = rows.map((row) => row.feature.vector);
  const standardizer = fitStandardizer(featureVectors);
  const currentVector = standardize(currentFeature.vector, standardizer.means, standardizer.scales);
  const similarRows = rows
    .map((row) => {
      const vector = standardize(row.feature.vector, standardizer.means, standardizer.scales);
      const distance = Math.sqrt(vector.reduce((sum, value, index) => sum + (value - currentVector[index]) ** 2, 0) / vector.length);
      const similarity = Math.exp(-distance * 0.72);
      const recency = Math.exp(-(latestIndex - row.index) / Math.max(30, analysisWindow * 0.8));
      return {
        row,
        similarity,
        weight: similarity * (0.65 + recency * 0.35),
        selectionScore: similarity * (0.85 + recency * 0.15),
      };
    })
    .sort((left, right) => right.selectionScore - left.selectionScore)
    .slice(0, neighborCount);

  const similarItems: SimilarDayResult[] = similarRows.map(({ row, similarity }) => ({
    date: candles[row.index].date,
    similarity,
    currentReturn: row.feature.return1d,
    nextOpenReturn: row.nextOpenReturn,
    nextCloseReturn: row.nextCloseReturn,
    nextHighReturn: row.nextHighReturn,
    nextLowReturn: row.nextLowReturn,
    nextVolumeRatio20: row.nextVolumeRatio20,
  }));
  const analogReturns = similarItems.map((item) => item.nextCloseReturn);
  const analogOpenReturns = similarItems.map((item) => item.nextOpenReturn);
  const analogHighReturns = similarItems.map((item) => item.nextHighReturn);
  const analogLowReturns = similarItems.map((item) => item.nextLowReturn);
  const analogVolumeRatios = similarItems.map((item) => item.nextVolumeRatio20);
  const analogWeights = similarRows.map((item) => item.weight);
  const analogUpRate = weightedValueMean(similarItems.map((item) => item.nextCloseReturn > 0 ? 1 : 0), analogWeights);
  const baselineUpRate = mean(rows.map((row) => row.nextUp));

  const activeRules = ruleDefinitions.flatMap((definition) => {
    if (!definition.matches(currentFeature)) return [];
    const matchedRows = rows.filter((row) => definition.matches(row.feature));
    const sampleSize = matchedRows.length;
    return [{
      key: definition.key,
      name: definition.name,
      description: definition.description,
      tone: definition.tone,
      sampleSize,
      upRate: sampleSize ? mean(matchedRows.map((row) => row.nextUp)) : baselineUpRate,
      averageReturn: sampleSize ? mean(matchedRows.map((row) => row.nextCloseReturn)) : 0,
      confidence: sampleConfidence(sampleSize),
    } satisfies NextDayRuleResult];
  });

  const ruleReliability = activeRules.length
    ? mean(activeRules.map((rule) => clamp(rule.sampleSize / (rule.sampleSize + 18), 0.05, 1)))
    : 0;
  const ruleProbability = activeRules.length
    ? weightedMean(activeRules.map((rule) => ({
      value: (rule.upRate * rule.sampleSize + baselineUpRate * 18) / (rule.sampleSize + 18),
      weight: clamp(rule.sampleSize / (rule.sampleSize + 18), 0.05, 1),
    })))
    : baselineUpRate;

  const validation = validateLogistic(featureVectors, rows.map((row) => row.nextUp), baselineUpRate);
  const finalLogistic = trainLogistic(featureVectors, rows.map((row) => row.nextUp), 220);
  const rawMlProbability = predictLogistic(finalLogistic, currentFeature.vector);
  const brierImprovement = validation.brierScore != null && validation.baselineBrierScore != null
    ? validation.baselineBrierScore - validation.brierScore
    : null;
  const mlReliability = validation.mlEnabled
    ? clamp(validation.validationSamples / 60, 0.25, 1) * clamp((brierImprovement ?? 0) / 0.035, 0.2, 1)
    : 0;
  const mlProbability = baselineUpRate + (rawMlProbability - baselineUpRate) * mlReliability;
  const ridgeTargets = [
    rows.map((row) => row.nextOpenReturn),
    rows.map((row) => row.nextCloseReturn),
    rows.map((row) => row.nextHighReturn),
    rows.map((row) => row.nextLowReturn),
    rows.map((row) => row.nextVolumeRatio20),
  ];
  const ridgePredictions = ridgeTargets.map((target) => boundedRidgePrediction(featureVectors, target, currentFeature.vector));

  const legacyWeights = predictionWeights(validation.mlEnabled, ruleReliability);
  const legacyBaseUpProbability = clamp(
    ruleProbability * legacyWeights.rule + analogUpRate * legacyWeights.analog + mlProbability * legacyWeights.ml,
    0.05,
    0.95,
  );
  const partialSessionPenalty = prepared.isPartialSession ? (1 - prepared.sessionProgress) * 14 : 0;
  const dataSufficiency = clamp(Math.round(
    35 + Math.min(rows.length, analysisWindow) / analysisWindow * 25 + mean(similarRows.map((item) => item.similarity)) * 22 + (validation.mlEnabled ? 8 : 0) - partialSessionPenalty,
  ), 25, 90);
  const legacyComponentProbabilities = [ruleProbability, analogUpRate, ...(validation.mlEnabled ? [mlProbability] : [])];
  const legacyComponentSpread = Math.max(...legacyComponentProbabilities) - Math.min(...legacyComponentProbabilities);
  const legacyEnsembleAgreement = clamp(1 - legacyComponentSpread / 0.45, 0, 1);
  const panelEligible = (options.market ?? "CN") === "CN"
    && currentFeature.benchmarkAvailable
    && !prepared.isPartialSession;
  const panelProbability = panelEligible
    ? predictNextDayPanelProbability({
      technicalState: currentFeature,
      baselineUpRate,
      analogUpRate,
      baseUpProbability: legacyBaseUpProbability,
      ensembleAgreement: legacyEnsembleAgreement,
      dataSufficiency,
      activeRuleCount: activeRules.length,
    }, nextDayPanelArtifact)
    : null;
  const panelWeight = panelProbability == null ? 0 : nextDayPanelBlendWeight;
  const blendedUpProbability = clamp(
    legacyBaseUpProbability * (1 - panelWeight) + (panelProbability ?? legacyBaseUpProbability) * panelWeight,
    0.05,
    0.95,
  );
  const regimeLogitAdjustment = panelProbability == null
    ? 0
    : nextDayPanelArtifact.regimeCalibration?.logitAdjustments[currentFeature.marketRegime] ?? 0;
  const baseUpProbability = shiftProbabilityByLogit(blendedUpProbability, regimeLogitAdjustment);
  const weights = {
    rule: legacyWeights.rule * (1 - panelWeight),
    analog: legacyWeights.analog * (1 - panelWeight),
    ml: legacyWeights.ml * (1 - panelWeight),
    panel: panelWeight,
  };
  const newsContext = buildNewsContext(options.newsItems ?? [], candles[latestIndex].date);
  const contextAdjustment = clamp(newsContext.probabilityAdjustment, -0.05, 0.05);
  const upProbability = clamp(baseUpProbability + contextAdjustment, 0.05, 0.95);
  const returnMlWeight = validation.mlEnabled ? 0.35 : 0;
  const analogReturnWeight = 1 - returnMlWeight;
  const expectedOpenGap = weightedValueMean(analogOpenReturns, analogWeights) * analogReturnWeight + ridgePredictions[0] * returnMlWeight;
  const expectedCloseReturn = weightedValueMean(analogReturns, analogWeights) * analogReturnWeight + ridgePredictions[1] * returnMlWeight;
  const expectedHighReturn = Math.max(expectedOpenGap, weightedValueMean(analogHighReturns, analogWeights) * analogReturnWeight + ridgePredictions[2] * returnMlWeight);
  const expectedLowReturn = Math.min(expectedOpenGap, weightedValueMean(analogLowReturns, analogWeights) * analogReturnWeight + ridgePredictions[3] * returnMlWeight);
  const expectedVolumeRatio20 = clamp(weightedValueMean(analogVolumeRatios, analogWeights) * analogReturnWeight + ridgePredictions[4] * returnMlWeight, 0.2, 4);
  const volumeUpProbability = weightedValueMean(similarItems.map((item) => item.nextVolumeRatio20 >= 1.2 ? 1 : 0), analogWeights);
  const quietProbability = weightedValueMean(similarItems.map((item) => item.nextVolumeRatio20 < 0.8 ? 1 : 0), analogWeights);
  const activeProbability = weightedValueMean(similarItems.map((item) => item.nextVolumeRatio20 >= 1.2 ? 1 : 0), analogWeights);
  const normalProbability = clamp(1 - quietProbability - activeProbability, 0, 1);
  const averageVolume20 = mean(candles.slice(Math.max(0, latestIndex - 19), latestIndex + 1).map((item) => item.volume));

  const marketContext = buildMarketContext(currentFeature, options.benchmarkName ?? "市场基准", candles[latestIndex].date);
  const bullishFactors = [...new Set([
    ...buildBullishFactors(currentFeature, activeRules),
    ...(currentFeature.benchmarkAvailable && currentFeature.benchmarkReturn1d >= 0.008 ? [`${marketContext.name}当日上涨 ${formatPercentValue(currentFeature.benchmarkReturn1d)}，市场环境偏暖`] : []),
    ...(currentFeature.relativeStrength5d >= 0.025 ? [`近 5 日跑赢${marketContext.name} ${formatPercentValue(currentFeature.relativeStrength5d)}`] : []),
    ...(newsContext.weightedScore >= 0.18 ? [`截至切片时点的消息面偏正向（加权分 ${newsContext.weightedScore.toFixed(2)}）`] : []),
  ])].slice(0, 8);
  const riskFactors = [...new Set([
    ...buildRiskFactors(currentFeature, activeRules),
    ...(currentFeature.benchmarkAvailable && currentFeature.benchmarkReturn1d <= -0.012 ? [`${marketContext.name}当日下跌 ${formatPercentValue(Math.abs(currentFeature.benchmarkReturn1d))}，系统性风险上升`] : []),
    ...(currentFeature.relativeStrength5d <= -0.03 ? [`近 5 日跑输${marketContext.name} ${formatPercentValue(Math.abs(currentFeature.relativeStrength5d))}`] : []),
    ...(newsContext.weightedScore <= -0.18 ? [`截至切片时点的消息面偏负向（加权分 ${newsContext.weightedScore.toFixed(2)}）`] : []),
  ])].slice(0, 8);
  const signalScore = clamp(Math.round(
    50 + (upProbability - 0.5) * 75 + expectedCloseReturn * 180 + (bullishFactors.length - riskFactors.length) * 2,
  ), 0, 100);
  const grade: NextDayPredictionReport["signal"]["grade"] = signalScore >= 78 && riskFactors.length === 0
    ? "S"
    : signalScore >= 64
      ? "A"
      : signalScore >= 48
        ? "B"
        : "C";
  const state = classifyState(currentFeature, upProbability, riskFactors.length);
  const analogUpCount = similarItems.filter((item) => item.nextCloseReturn > 0).length;
  const rawUpRateInterval95 = wilsonInterval(analogUpCount, similarItems.length);
  const upRateInterval95: [number, number] = [
    Math.min(rawUpRateInterval95[0], analogUpRate),
    Math.max(rawUpRateInterval95[1], analogUpRate),
  ];
  const componentProbabilities = [...legacyComponentProbabilities, ...(panelProbability == null ? [] : [panelProbability])];
  const componentSpread = Math.max(...componentProbabilities) - Math.min(...componentProbabilities);
  const ensembleAgreement = clamp(1 - componentSpread / 0.45, 0, 1);
  const analogPrecision = 1 - (upRateInterval95[1] - upRateInterval95[0]);
  const externalCoverage = clamp((marketContext.available ? 0.65 : 0) + newsContext.confidence * 0.35, 0, 1);
  const modelQuality = panelProbability != null
    ? clamp(
      (nextDayPanelArtifact.validation.accuracy - 0.5) * 3
      + Math.max(0, nextDayPanelArtifact.validation.baselineBrierScore - nextDayPanelArtifact.validation.brierScore) * 8,
      0,
      1,
    )
    : validation.mlEnabled
      ? clamp(((validation.auc ?? 0.5) - 0.5) * 3 + Math.max(0, brierImprovement ?? 0) * 8, 0, 1)
      : 0.25;
  const decisionConfidence = clamp(Math.round(
    dataSufficiency * 0.48 + ensembleAgreement * 18 + analogPrecision * 12 + modelQuality * 10 + externalCoverage * 7,
  ), 20, 88);
  const reliability: NextDayPredictionReport["signal"]["reliability"] = decisionConfidence >= 72 ? "较高" : decisionConfidence >= 52 ? "中等" : "较低";

  const scenarios = buildScenarios(upProbability, expectedOpenGap, expectedHighReturn, expectedLowReturn, expectedVolumeRatio20, currentFeature);
  const decisionSupport = buildDecisionSupport({
    prepared,
    currentFeature,
    upProbability,
    expectedCloseReturn,
    expectedHighReturn,
    expectedLowReturn,
    q25: quantile(analogReturns, 0.25),
    q75: quantile(analogReturns, 0.75),
    referencePrice: prepared.decisionReferencePrice ?? candles[latestIndex].close,
    riskCount: riskFactors.length,
    marketContext,
  });
  const panelReason = panelProbability != null
    ? `跨股票面板模型 ${nextDayPanelArtifact.version} 已通过 ${nextDayPanelArtifact.validation.samples} 条时间外样本验证，以 ${Math.round(panelWeight * 100)}% 权重参与组合；市场状态校准使用 ${nextDayPanelArtifact.regimeCalibration?.samples ?? 0} 条独立股票样本并保守收缩。`
    : "跨股票面板模型仅用于带同期基准的 A 股完整收盘切片，当前场景自动回退到个股模型。";
  const validationReason = `${panelReason}${validation.mlEnabled
    ? " 个股滚动 ML 同时通过方向、AUC 与 Brier 门槛，保留其动态子权重。"
    : validation.validationSamples < 12
      ? " 个股滚动验证样本不足，其 ML 子权重自动降为 0。"
      : " 个股滚动 ML 未同时超过方向、AUC 与 Brier 门槛，其子权重自动降为 0。"}`;

  return {
    mode: prepared.mode,
    asOf: candles[latestIndex].date,
    asOfTime: prepared.asOfTime,
    analysisWindow,
    availableDays: Math.min(analysisWindow, candles.length),
    trainingSamples: rows.length,
    target: {
      label: prepared.targetLabel,
      date: prepared.targetDate,
      basis: prepared.basis,
      usesCurrentSession: prepared.usesCurrentSession,
      isPartialSession: prepared.isPartialSession,
      sessionProgress: prepared.sessionProgress,
    },
    signal: { grade, score: signalScore, state, dataSufficiency, decisionConfidence, reliability, ensembleAgreement },
    prediction: {
      upProbability,
      baseUpProbability,
      contextAdjustment,
      expectedCloseReturn,
      expectedOpenGap,
      expectedHighReturn,
      expectedLowReturn,
      q25: quantile(analogReturns, 0.25),
      median: quantile(analogReturns, 0.5),
      q75: quantile(analogReturns, 0.75),
    },
    volumePrediction: {
      expectedVolume: averageVolume20 * expectedVolumeRatio20,
      currentVolume: prepared.observedVolume ?? candles[latestIndex].volume,
      averageVolume20,
      expectedVolumeRatio20,
      volumeUpProbability,
      quietProbability,
      normalProbability,
      activeProbability,
      label: expectedVolumeRatio20 < 0.8 ? "预计缩量" : expectedVolumeRatio20 < 1.2 ? "预计量能平稳" : expectedVolumeRatio20 < 2 ? "预计放量" : "预计显著放量",
    },
    technicalState: currentFeature,
    similarDays: {
      count: similarItems.length,
      upRate: analogUpRate,
      meanReturn: weightedValueMean(analogReturns, analogWeights),
      medianReturn: quantile(analogReturns, 0.5),
      q25: quantile(analogReturns, 0.25),
      q75: quantile(analogReturns, 0.75),
      averageHighReturn: mean(analogHighReturns),
      averageLowReturn: mean(analogLowReturns),
      averageSimilarity: mean(similarItems.map((item) => item.similarity)),
      upRateInterval95,
      items: similarItems,
    },
    distribution: buildDistribution(analogReturns),
    scenarios,
    bullishFactors,
    riskFactors,
    activeRules,
    externalContext: {
      coverage: externalCoverage,
      market: marketContext,
      news: {
        available: newsContext.available,
        itemCount: newsContext.itemCount,
        freshItemCount: newsContext.freshItemCount,
        weightedScore: newsContext.weightedScore,
        confidence: newsContext.confidence,
        tone: newsContext.tone,
        probabilityAdjustment: newsContext.probabilityAdjustment,
        cutoff: candles[latestIndex].date,
        role: newsContext.available ? "按发布时间、相关性和新鲜度加权，影响被限制在 ±5 个百分点" : "消息数据缺失时不做方向修正",
      },
    },
    decisionSupport,
    modelValidation: {
      accuracy: validation.accuracy,
      auc: validation.auc,
      precision: validation.precision,
      recall: validation.recall,
      brierScore: validation.brierScore,
      baselineBrierScore: validation.baselineBrierScore,
      baselineUpRate,
      baselineAccuracy: validation.baselineAccuracy,
      validationSamples: validation.validationSamples,
      mlEnabled: validation.mlEnabled,
      panelEnabled: panelProbability != null,
      panelProbability,
      panelWeight,
      panelVersion: nextDayPanelArtifact.version,
      panelValidationAccuracy: nextDayPanelArtifact.validation.accuracy,
      panelValidationBrierScore: nextDayPanelArtifact.validation.brierScore,
      panelValidationSamples: nextDayPanelArtifact.validation.samples,
      regimeLogitAdjustment,
      probabilityLift: upProbability - baselineUpRate,
      brierImprovement,
      version: predictionModelVersion,
      reason: validationReason,
    },
    weights,
    notice: `模型 ${predictionModelVersion} 基于截至 ${candles[latestIndex].date}${prepared.asOfTime ? ` ${prepared.asOfTime}` : ""} 的 ${Math.min(analysisWindow, candles.length)} 个交易日数据；个股子模型随行情滚动重训，跨股票面板模型按版本化 Walk Forward 流程离线更新。概率、价格带和风控倾向仅作研究辅助，不构成收益承诺或投资建议。`,
  };
}

function preparePredictionInput(sourceCandles: Candle[], options: NextDayPredictionOptions): PreparedPredictionInput {
  const mode = options.mode ?? "tomorrow";
  const ordered = [...sourceCandles]
    .filter((candle) => /^\d{4}-\d{2}-\d{2}$/.test(candle.date) && [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0))
    .sort((left, right) => left.date.localeCompare(right.date));
  const snapshot = isUsableSnapshot(options.realtimeSnapshot) ? options.realtimeSnapshot : null;
  const market = options.market ?? "CN";
  const latestCompleted = ordered.at(-1);
  const snapshotIsLiveSession = snapshot ? representsLiveTradingSession(snapshot, market) : false;

  if (mode === "today") {
    if (snapshot) {
      const canObserveCurrentSession = snapshotIsLiveSession && snapshot.date > (latestCompleted?.date ?? "");
      return {
        candles: ordered.filter((candle) => candle.date < snapshot.date),
        mode,
        targetDate: snapshot.date,
        targetLabel: "今日 / 本交易日",
        basis: `严格使用 ${snapshot.date} 之前的完整日 K；今日行情仅用于检验预测与风控，不进入模型特征`,
        usesCurrentSession: false,
        isPartialSession: false,
        sessionProgress: canObserveCurrentSession ? estimateSessionProgress(snapshot.time, market, snapshot.marketStatus) : 1,
        asOfTime: "15:00 前一交易日收盘",
        observedCurrentReturn: canObserveCurrentSession && snapshot.previousClose > 0 ? snapshot.price / snapshot.previousClose - 1 : null,
        observedVolume: canObserveCurrentSession ? snapshot.volume : null,
        decisionReferencePrice: canObserveCurrentSession ? snapshot.price : latestCompleted?.close ?? null,
      };
    }
    const target = ordered.at(-1);
    const previous = ordered.at(-2);
    return {
      candles: ordered.slice(0, -1),
      mode,
      targetDate: target?.date ?? null,
      targetLabel: "最近交易日（回看）",
      basis: "实时快照未就绪，暂以最后一根完整日 K 作为检验目标，并从模型输入中剔除",
      usesCurrentSession: false,
      isPartialSession: false,
      sessionProgress: 1,
      asOfTime: "收盘",
      observedCurrentReturn: target && previous?.close ? target.close / previous.close - 1 : null,
      observedVolume: target?.volume ?? null,
      decisionReferencePrice: target?.close ?? null,
    };
  }

  if (snapshot && snapshotIsLiveSession && (!ordered.length || snapshot.date >= ordered.at(-1)!.date)) {
    const completed = ordered.filter((candle) => candle.date < snapshot.date);
    const previous = completed.at(-1);
    const existing = ordered.find((candle) => candle.date === snapshot.date);
    const partial = isPartialMarketSession(snapshot.marketStatus);
    const sessionProgress = estimateSessionProgress(snapshot.time, market, snapshot.marketStatus);
    const liveCandle = buildLiveSessionCandle(snapshot, previous, existing, partial ? sessionProgress : 1);
    return {
      candles: liveCandle ? [...completed, liveCandle] : ordered,
      mode,
      targetDate: null,
      targetLabel: "明日 / 下一交易日",
      basis: liveCandle
        ? `使用今日截至 ${snapshot.time || "当前"} 的 OHLCV；盘中成交量按 ${Math.round(sessionProgress * 100)}% 进度投影后进入特征`
        : "使用最近完整日 K 预测下一交易日",
      usesCurrentSession: Boolean(liveCandle),
      isPartialSession: Boolean(liveCandle && partial),
      sessionProgress,
      asOfTime: snapshot.time,
      observedCurrentReturn: snapshot.previousClose > 0 ? snapshot.price / snapshot.previousClose - 1 : null,
      observedVolume: snapshot.volume,
      decisionReferencePrice: snapshot.price,
    };
  }

  return {
    candles: ordered,
    mode,
    targetDate: null,
    targetLabel: "明日 / 下一交易日",
    basis: snapshot && market === "US" && /盘前|盘后/.test(snapshot.marketStatus)
      ? `当前为美股${snapshot.marketStatus}，不把延长时段报价伪装成完整日 K；使用最近完整日 K 预测下一交易日`
      : "使用最近完整日 K 预测下一交易日；实时快照不可用时不伪造盘中特征",
    usesCurrentSession: false,
    isPartialSession: false,
    sessionProgress: 1,
    asOfTime: "收盘",
    observedCurrentReturn: ordered.length > 1 ? ordered.at(-1)!.close / ordered.at(-2)!.close - 1 : null,
    observedVolume: ordered.at(-1)?.volume ?? null,
    decisionReferencePrice: ordered.at(-1)?.close ?? null,
  };
}

function isUsableSnapshot(snapshot: RealtimeSnapshot | null | undefined): snapshot is RealtimeSnapshot {
  return Boolean(snapshot
    && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.date)
    && snapshot.previousClose > 0
    && [snapshot.open, snapshot.high, snapshot.low, snapshot.price].every((value) => Number.isFinite(value) && value > 0));
}

function isPartialMarketSession(status: string): boolean {
  return !/已收盘|休市|最近收盘/.test(status) && /交易中|午间休市|盘中/.test(status);
}

function representsLiveTradingSession(snapshot: RealtimeSnapshot, market: StockMarket): boolean {
  if (market === "US") return /交易中|盘中/.test(snapshot.marketStatus);
  return /交易中|午间休市|盘中/.test(snapshot.marketStatus);
}

function estimateSessionProgress(time: string, market: StockMarket, status: string): number {
  if (!isPartialMarketSession(status)) return 1;
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0.5;
  const clock = hour * 60 + minute;
  if (market === "US") return clamp((clock - 570) / 390, 0.08, 1);
  const elapsed = clock <= 690
    ? clock - 570
    : clock < 780
      ? 120
      : 120 + clock - 780;
  return clamp(elapsed / 240, 0.08, 1);
}

function buildLiveSessionCandle(
  snapshot: RealtimeSnapshot,
  previous: Candle | undefined,
  existing: Candle | undefined,
  sessionProgress: number,
): Candle | null {
  if (!previous?.close) return null;
  const priceScale = snapshot.previousClose > 0 ? previous.close / snapshot.previousClose : 1;
  const open = snapshot.open * priceScale;
  const high = snapshot.high * priceScale;
  const low = snapshot.low * priceScale;
  const close = snapshot.price * priceScale;
  const projectedVolume = snapshot.volume / clamp(sessionProgress, 0.08, 1);
  const projectedAmount = snapshot.amount / clamp(sessionProgress, 0.08, 1);
  if (![open, high, low, close, projectedVolume, projectedAmount].every(Number.isFinite)) return null;
  return {
    key: snapshot.date,
    label: snapshot.date,
    date: snapshot.date,
    time: snapshot.time,
    open,
    high: Math.max(open, close, high),
    low: Math.min(open, close, low),
    close,
    volume: Math.max(0, projectedVolume),
    amount: Math.max(0, projectedAmount),
    adjustedAmount: Math.max(0, projectedAmount * priceScale),
    vwap: snapshot.volume > 0 && snapshot.amount > 0 ? snapshot.amount / snapshot.volume * priceScale : (open + high + low + close) / 4,
    turnoverPct: existing?.turnoverPct ?? null,
    listedAShares: existing?.listedAShares ?? previous.listedAShares,
    change: close - previous.close,
    changePct: previous.close > 0 ? (close / previous.close - 1) * 100 : 0,
  };
}

function buildBenchmarkLookup(candles: Candle[]): BenchmarkLookup {
  const ordered = [...candles].sort((left, right) => left.date.localeCompare(right.date));
  const byDate = new Map<string, BenchmarkFeature>();
  for (let index = 20; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const ma20 = movingAverage(ordered, index, 20);
    if (!previous?.close || !ma20) continue;
    const return1d = current.close / previous.close - 1;
    const return5d = periodReturn(ordered, index, 5);
    const volatility20 = standardDeviation(dailyReturns(ordered, Math.max(1, index - 19), index));
    const aboveMA20 = current.close >= ma20;
    const regime = aboveMA20
      ? return5d >= 0.015 ? "市场上行" : "市场偏强震荡"
      : return5d <= -0.015 ? "市场下行" : "市场偏弱震荡";
    byDate.set(current.date, { date: current.date, return1d, return5d, aboveMA20, volatility20, regime });
  }
  return { byDate, dates: [...byDate.keys()].sort() };
}

function resolveBenchmarkFeature(lookup: BenchmarkLookup, date: string): BenchmarkFeature | null {
  const exact = lookup.byDate.get(date);
  if (exact) return exact;
  for (let index = lookup.dates.length - 1; index >= 0; index -= 1) {
    if (lookup.dates[index] <= date) return lookup.byDate.get(lookup.dates[index]) ?? null;
  }
  return null;
}

function buildNewsContext(items: NewsItem[], cutoff: string) {
  const cutoffTime = dateNumber(cutoff);
  const eligible = items.flatMap((item) => {
    const publishedDate = item.publishedAt.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
    const publishedTime = dateNumber(publishedDate);
    if (!publishedTime || !cutoffTime || publishedTime > cutoffTime) return [];
    const ageDays = Math.max(0, (cutoffTime - publishedTime) / 86_400_000);
    if (ageDays > 14) return [];
    const recency = Math.exp(-ageDays / 4.5);
    const relevance = clamp(item.relevance, 0, 1);
    const sourceQuality = clamp(item.sourceQualityScore ?? (item.media || item.portal ? 0.7 : 0.4), 0.3, 1);
    const corroboration = 1 + Math.min(0.12, Math.log2(Math.max(1, item.duplicateCount ?? 1)) * 0.05);
    const weight = recency * (0.3 + relevance * 0.7) * (0.55 + sourceQuality * 0.45) * corroboration;
    return [{ item, ageDays, weight }];
  });
  const totalWeight = eligible.reduce((sum, value) => sum + value.weight, 0);
  const weightedScore = totalWeight
    ? eligible.reduce((sum, value) => sum + clamp(value.item.sentimentScore, -1, 1) * value.weight, 0) / totalWeight
    : 0;
  const freshItemCount = eligible.filter((value) => value.ageDays <= 3).length;
  const averageRelevance = eligible.length ? mean(eligible.map((value) => clamp(value.item.relevance, 0, 1))) : 0;
  const confidence = eligible.length
    ? clamp(Math.log2(eligible.length + 1) / Math.log2(13) * (0.55 + averageRelevance * 0.45) * (0.7 + freshItemCount / eligible.length * 0.3), 0, 1)
    : 0;
  const probabilityAdjustment = clamp(weightedScore * confidence * 0.075, -0.05, 0.05);
  return {
    available: eligible.length > 0,
    itemCount: eligible.length,
    freshItemCount,
    weightedScore,
    confidence,
    probabilityAdjustment,
    tone: (weightedScore >= 0.15 ? "正面" : weightedScore <= -0.15 ? "负面" : "中性") as "正面" | "中性" | "负面",
  };
}

function dateNumber(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildMarketContext(
  feature: FeatureState,
  name: string,
  cutoff: string,
): NextDayPredictionReport["externalContext"]["market"] {
  return {
    available: feature.benchmarkAvailable,
    name,
    asOf: feature.benchmarkAsOf,
    fresh: feature.benchmarkAvailable && feature.benchmarkAsOf === cutoff,
    return1d: feature.benchmarkReturn1d,
    return5d: feature.benchmarkReturn5d,
    relativeStrength5d: feature.relativeStrength5d,
    regime: feature.marketRegime,
    role: feature.benchmarkAvailable ? "同日期市场收益、趋势、波动和个股相对强弱已进入相似日与 ML 特征" : "基准行情缺失，模型自动退化为个股特征",
  };
}

function buildDecisionSupport(input: {
  prepared: PreparedPredictionInput;
  currentFeature: FeatureState;
  upProbability: number;
  expectedCloseReturn: number;
  expectedHighReturn: number;
  expectedLowReturn: number;
  q25: number;
  q75: number;
  referencePrice: number;
  riskCount: number;
  marketContext: NextDayPredictionReport["externalContext"]["market"];
}): NextDayPredictionReport["decisionSupport"] {
  const currentReturn = input.prepared.observedCurrentReturn ?? input.currentFeature.return1d;
  const upside = Math.max(input.expectedHighReturn, input.q75, 0.005);
  const downside = Math.min(input.expectedLowReturn, input.q25, -0.005);
  const riskRewardRatio = Math.abs(downside) > 1e-6 ? upside / Math.abs(downside) : null;
  const marketPressure = input.marketContext.available && input.marketContext.return1d <= -0.012;
  let action: NextDayPredictionReport["decisionSupport"]["action"] = "等待确认";
  let tone: NextDayPredictionReport["decisionSupport"]["tone"] = "neutral";

  if (currentReturn >= Math.max(0.035, input.q75) && (input.upProbability < 0.56 || input.riskCount >= 2)) {
    action = "分批止盈";
    tone = "warning";
  } else if (currentReturn <= Math.min(-0.03, input.q25) && input.upProbability < 0.45) {
    action = "收紧止损";
    tone = "risk";
  } else if (input.riskCount >= 3 || (marketPressure && input.upProbability < 0.5)) {
    action = "降低仓位";
    tone = "risk";
  } else if (input.upProbability >= 0.6 && input.expectedCloseReturn > 0 && (riskRewardRatio ?? 0) >= 1) {
    action = "持有观察";
    tone = "positive";
  }

  const summary = action === "分批止盈"
    ? "当前涨幅已进入历史偏乐观区间，但延续概率或风险项未同步确认，可用分批方式锁定部分浮盈。"
    : action === "收紧止损"
      ? "当前跌幅已落入历史弱势尾部且修复概率偏低，应优先控制单笔损失和隔夜风险。"
      : action === "降低仓位"
        ? "个股风险项或系统性压力偏高，建议把仓位和回撤上限放在方向判断之前。"
        : action === "持有观察"
          ? "方向、收益期望和风险收益比暂时一致，可继续观察但仍需执行预设退出纪律。"
          : "多模型尚未形成足够优势，等待价格、量能或大盘方向进一步确认。";

  return {
    action,
    tone,
    summary,
    currentReturn,
    referencePrice: input.referencePrice,
    expectedPrice: input.referencePrice * (1 + input.expectedCloseReturn),
    takeProfitReference: input.referencePrice * (1 + upside),
    riskReference: input.referencePrice * (1 + downside),
    riskRewardRatio,
    checks: [
      `上涨概率 ${formatPercentValue(input.upProbability)}，预期收盘 ${formatSignedPercent(input.expectedCloseReturn)}`,
      `统计观察带 ${formatSignedPercent(downside)} ～ ${formatSignedPercent(upside)}`,
      input.marketContext.available ? `${input.marketContext.name}：${input.marketContext.regime} ${formatSignedPercent(input.marketContext.return1d)}` : "大盘基准暂不可用，降低结论可信度",
    ],
  };
}

function featureAt(candles: Candle[], index: number, benchmarkLookup?: BenchmarkLookup): FeatureState | null {
  const candle = candles[index];
  const previous = candles[index - 1];
  if (!candle || !previous || previous.close <= 0) return null;
  const movingAverage5 = movingAverage(candles, index, 5);
  const movingAverage20 = movingAverage(candles, index, 20);
  const priorMa5 = movingAverage(candles, index - 1, 5);
  const priorMa20 = movingAverage(candles, index - 1, 20);
  if (movingAverage5 == null || movingAverage20 == null || priorMa5 == null || priorMa20 == null) return null;
  const highLowRange = candle.high - candle.low;
  const volumeAverage20 = mean(candles.slice(index - 19, index + 1).map((item) => item.volume));
  const return1d = candle.close / previous.close - 1;
  const return5d = periodReturn(candles, index, 5);
  const return10d = periodReturn(candles, index, 10);
  const return20d = periodReturn(candles, index, 20);
  const recentReturns = dailyReturns(candles, Math.max(1, index - 19), index);
  const volatility20 = standardDeviation(recentReturns);
  const atr14 = averageTrueRangeRatio(candles, index, 14);
  const openGap = candle.open / previous.close - 1;
  const amplitude = highLowRange / previous.close;
  const upperShadow = (candle.high - Math.max(candle.open, candle.close)) / previous.close;
  const lowerShadow = (Math.min(candle.open, candle.close) - candle.low) / previous.close;
  const closePosition = highLowRange > 0 ? (candle.close - candle.low) / highLowRange : 0.5;
  const volumeRatio20 = volumeAverage20 > 0 ? candle.volume / volumeAverage20 : 1;
  const recent20 = candles.slice(Math.max(0, index - 19), index + 1);
  const recent60 = candles.slice(Math.max(0, index - 59), index + 1);
  const { upStreak, downStreak } = streaks(candles, index);
  const ma5Deviation = candle.close / movingAverage5 - 1;
  const ma20Deviation = candle.close / movingAverage20 - 1;
  const benchmark = benchmarkLookup ? resolveBenchmarkFeature(benchmarkLookup, candle.date) : null;
  const relativeStrength5d = benchmark ? return5d - benchmark.return5d : 0;
  const state = {
    return1d,
    return5d,
    return10d,
    return20d,
    openGap,
    amplitude,
    upperShadow,
    lowerShadow,
    closePosition,
    volumeRatio20,
    aboveMA5: candle.close >= movingAverage5,
    aboveMA20: candle.close >= movingAverage20,
    ma5Rising: movingAverage5 >= priorMa5,
    ma20Rising: movingAverage20 >= priorMa20,
    newHigh20: candle.close >= Math.max(...recent20.map((item) => item.close)),
    newHigh60: recent60.length >= 40 && candle.close >= Math.max(...recent60.map((item) => item.close)),
    upStreak,
    downStreak,
    volatility20,
    atr14,
    benchmarkAvailable: Boolean(benchmark),
    benchmarkAsOf: benchmark?.date ?? "",
    benchmarkReturn1d: benchmark?.return1d ?? 0,
    benchmarkReturn5d: benchmark?.return5d ?? 0,
    relativeStrength5d,
    marketRegime: benchmark?.regime ?? "市场基准缺失",
    ma5Deviation,
    ma20Deviation,
    streak: clamp(upStreak - downStreak, -6, 6),
  };
  return {
    ...state,
    vector: [
      return1d,
      openGap,
      amplitude,
      upperShadow,
      lowerShadow,
      closePosition,
      return5d,
      return10d,
      return20d,
      ma5Deviation,
      ma20Deviation,
      volumeRatio20,
      state.aboveMA5 ? 1 : 0,
      state.aboveMA20 ? 1 : 0,
      state.newHigh20 ? 1 : 0,
      state.newHigh60 ? 1 : 0,
      state.streak / 6,
      (movingAverage5 / priorMa5 - 1),
      (movingAverage20 / priorMa20 - 1),
      volatility20,
      atr14,
      state.benchmarkReturn1d,
      state.benchmarkReturn5d,
      relativeStrength5d,
      benchmark?.aboveMA20 ? 1 : 0,
      benchmark?.volatility20 ?? 0,
    ],
  };
}

function validateLogistic(vectors: number[][], labels: number[], baselineUpRate: number) {
  const validationStart = Math.max(40, Math.floor(vectors.length * 0.6));
  const probabilities: number[] = [];
  const actuals: number[] = [];
  if (vectors.length >= 52) {
    for (let index = validationStart; index < vectors.length; index += 1) {
      const model = trainLogistic(vectors.slice(0, index), labels.slice(0, index), 52);
      probabilities.push(predictLogistic(model, vectors[index]));
      actuals.push(labels[index]);
    }
  }
  const predictions = probabilities.map((value) => value >= 0.5 ? 1 : 0);
  const correct = predictions.reduce<number>((sum, value, index) => sum + (value === actuals[index] ? 1 : 0), 0);
  const truePositive = predictions.reduce<number>((sum, value, index) => sum + (value === 1 && actuals[index] === 1 ? 1 : 0), 0);
  const predictedPositive = predictions.filter((value) => value === 1).length;
  const actualPositive = actuals.filter((value) => value === 1).length;
  const accuracy = actuals.length ? correct / actuals.length : null;
  const auc = actuals.length ? rocAuc(probabilities, actuals) : null;
  const precision = predictedPositive ? truePositive / predictedPositive : null;
  const recall = actualPositive ? truePositive / actualPositive : null;
  const brierScore = actuals.length ? mean(probabilities.map((probability, index) => (probability - actuals[index]) ** 2)) : null;
  const baselineBrierScore = actuals.length ? mean(actuals.map((actual) => (baselineUpRate - actual) ** 2)) : null;
  const baselineAccuracy = Math.max(baselineUpRate, 1 - baselineUpRate);
  const mlEnabled = actuals.length >= 12 && accuracy != null && auc != null && brierScore != null && baselineBrierScore != null
    && accuracy > baselineAccuracy && auc >= 0.52 && brierScore < baselineBrierScore;
  return { accuracy, auc, precision, recall, brierScore, baselineBrierScore, baselineAccuracy, validationSamples: actuals.length, mlEnabled };
}

function wilsonInterval(successes: number, samples: number): [number, number] {
  if (samples <= 0) return [0, 1];
  const z = 1.96;
  const observed = successes / samples;
  const denominator = 1 + (z * z) / samples;
  const center = (observed + (z * z) / (2 * samples)) / denominator;
  const spread = z * Math.sqrt((observed * (1 - observed) + (z * z) / (4 * samples)) / samples) / denominator;
  return [clamp(center - spread, 0, 1), clamp(center + spread, 0, 1)];
}

function trainLogistic(vectors: number[][], labels: number[], iterations: number): LogisticModel {
  const { means, scales } = fitStandardizer(vectors);
  const inputs = vectors.map((vector) => standardize(vector, means, scales));
  const weights = Array((vectors[0]?.length ?? 0) + 1).fill(0);
  const learningRate = 0.12;
  const lambda = 0.025;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradients = Array(weights.length).fill(0);
    for (let row = 0; row < inputs.length; row += 1) {
      const probability = sigmoid(weights[0] + dot(inputs[row], weights.slice(1)));
      const error = probability - labels[row];
      gradients[0] += error;
      for (let column = 0; column < inputs[row].length; column += 1) gradients[column + 1] += error * inputs[row][column];
    }
    const divisor = Math.max(1, inputs.length);
    weights[0] -= learningRate * gradients[0] / divisor;
    for (let column = 1; column < weights.length; column += 1) {
      weights[column] -= learningRate * (gradients[column] / divisor + lambda * weights[column]);
    }
  }
  return { weights, means, scales };
}

function predictLogistic(model: LogisticModel, vector: number[]): number {
  const input = standardize(vector, model.means, model.scales);
  return sigmoid(model.weights[0] + dot(input, model.weights.slice(1)));
}

function boundedRidgePrediction(vectors: number[][], targets: number[], current: number[]): number {
  if (!vectors.length || !targets.length) return 0;
  const { means, scales } = fitStandardizer(vectors);
  const inputs = vectors.map((vector) => [1, ...standardize(vector, means, scales)]);
  const currentInput = [1, ...standardize(current, means, scales)];
  const size = currentInput.length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  const right = Array(size).fill(0);
  for (let row = 0; row < inputs.length; row += 1) {
    for (let left = 0; left < size; left += 1) {
      right[left] += inputs[row][left] * targets[row];
      for (let column = 0; column < size; column += 1) matrix[left][column] += inputs[row][left] * inputs[row][column];
    }
  }
  for (let index = 1; index < size; index += 1) matrix[index][index] += 2.4;
  const coefficients = solveLinearSystem(matrix, right);
  const prediction = coefficients ? dot(coefficients, currentInput) : mean(targets);
  return clamp(prediction, quantile(targets, 0.05), quantile(targets, 0.95));
}

function solveLinearSystem(matrix: number[][], right: number[]): number[] | null {
  const size = right.length;
  const augmented = matrix.map((row, index) => [...row, right[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let value = column; value <= size; value += 1) augmented[column][value] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let value = column; value <= size; value += 1) augmented[row][value] -= factor * augmented[column][value];
    }
  }
  return augmented.map((row) => row[size]);
}

function predictionWeights(mlEnabled: boolean, ruleReliability: number) {
  if (!mlEnabled && ruleReliability < 0.34) return { rule: 0.15, analog: 0.85, ml: 0 };
  if (!mlEnabled) return { rule: 0.4, analog: 0.6, ml: 0 };
  if (ruleReliability < 0.34) return { rule: 0.15, analog: 0.55, ml: 0.3 };
  return { rule: 0.3, analog: 0.4, ml: 0.3 };
}

function buildBullishFactors(feature: FeatureState, rules: NextDayRuleResult[]): string[] {
  const factors: string[] = [];
  if (feature.return5d >= 0.03) factors.push(`近 5 日累计上涨 ${formatPercentValue(feature.return5d)}`);
  if (feature.newHigh20) factors.push("收盘创近 20 日新高");
  if (feature.closePosition >= 0.8) factors.push(`收盘位于日内区间上方 ${Math.round((1 - feature.closePosition) * 100)}%`);
  if (feature.upperShadow <= 0.01) factors.push(`上影线仅 ${formatPercentValue(feature.upperShadow)}`);
  if (feature.aboveMA5 && feature.aboveMA20) factors.push("收盘同时站稳 MA5 与 MA20");
  if (feature.ma5Rising && feature.ma20Rising) factors.push("MA5 与 MA20 斜率同步向上");
  for (const rule of rules.filter((item) => item.tone === "bullish")) factors.push(`${rule.name}：历史 ${rule.sampleSize} 次，隔日上涨率 ${formatPercentValue(rule.upRate)}`);
  return [...new Set(factors)].slice(0, 6);
}

function buildRiskFactors(feature: FeatureState, rules: NextDayRuleResult[]): string[] {
  const factors: string[] = [];
  if (feature.return5d >= 0.12) factors.push(`近 5 日累计涨幅 ${formatPercentValue(feature.return5d)}，兑现压力上升`);
  if (feature.upperShadow >= 0.025) factors.push(`上影线 ${formatPercentValue(feature.upperShadow)}，冲高抛压明显`);
  if (feature.volumeRatio20 >= 1.8) factors.push(`量比 ${feature.volumeRatio20.toFixed(2)}，高换手分歧风险上升`);
  if (feature.ma20Deviation >= 0.12) factors.push(`收盘偏离 MA20 ${formatPercentValue(feature.ma20Deviation)}，趋势过热`);
  if (!feature.aboveMA20) factors.push("收盘仍位于 MA20 下方，中期结构偏弱");
  if (feature.return1d <= -0.05) factors.push(`当日下跌 ${formatPercentValue(Math.abs(feature.return1d))}，不自动视为超跌机会`);
  for (const rule of rules.filter((item) => item.tone === "risk")) factors.push(`${rule.name}：历史 ${rule.sampleSize} 次，隔日平均 ${formatSignedPercent(rule.averageReturn)}`);
  return [...new Set(factors)].slice(0, 6);
}

function classifyState(feature: FeatureState, upProbability: number, riskCount: number): string {
  if (riskCount >= 2 || feature.return1d <= -0.05) return "风险释放 / 高波动";
  if (feature.aboveMA5 && feature.aboveMA20 && feature.ma5Rising && feature.return5d >= 0.05 && upProbability >= 0.58) return "强趋势延续";
  if (feature.newHigh20 && feature.upperShadow >= 0.02) return "趋势新高 / 多空分歧";
  if (feature.aboveMA20 && Math.abs(feature.return5d) < 0.05) return "偏强震荡";
  if (!feature.aboveMA20) return "弱势整理";
  return "震荡 / 等待确认";
}

function buildScenarios(
  upProbability: number,
  expectedOpenGap: number,
  expectedHighReturn: number,
  expectedLowReturn: number,
  volumeRatio: number,
  feature: FeatureState,
): NextDayPredictionReport["scenarios"] {
  let strong = clamp(upProbability * 0.52 + (expectedHighReturn >= 0.04 ? 0.08 : 0) + (feature.aboveMA5 ? 0.03 : 0), 0.12, 0.68);
  let weak = clamp((1 - upProbability) * 0.48 + (expectedLowReturn <= -0.03 ? 0.07 : 0) + (!feature.aboveMA20 ? 0.04 : 0), 0.1, 0.6);
  if (strong + weak > 0.82) {
    const scale = 0.82 / (strong + weak);
    strong *= scale;
    weak *= scale;
  }
  const range = 1 - strong - weak;
  return [
    {
      key: "strong",
      label: "强势场景",
      probability: strong,
      summary: `${expectedOpenGap >= 0 ? "偏高开" : "低开后修复"}，盘中上探 ${formatSignedPercent(expectedHighReturn)}`,
      details: ["尝试突破今日高点", volumeRatio >= 1.2 ? "量能维持活跃" : "温和量能配合", "强势收盘结构延续"],
    },
    {
      key: "range",
      label: "震荡场景",
      probability: range,
      summary: `主要围绕 ${formatSignedPercent(expectedLowReturn)} ～ ${formatSignedPercent(expectedHighReturn)} 波动`,
      details: ["多空在昨日收盘附近反复", "成交量趋向 20 日常态", "等待方向选择"],
    },
    {
      key: "weak",
      label: "弱势场景",
      probability: weak,
      summary: `${expectedOpenGap < 0 ? "偏低开" : "高开承压"}，关注 ${formatSignedPercent(expectedLowReturn)} 下探`,
      details: ["获利盘或套牢盘兑现", feature.aboveMA5 ? "留意 MA5 支撑" : "MA5 下方承接偏弱", "放量下跌时风险上升"],
    },
  ];
}

function buildDistribution(values: number[]): NextDayPredictionReport["distribution"] {
  const buckets = [
    { label: "<-5%", min: Number.NEGATIVE_INFINITY, max: -0.05 },
    { label: "-5~-3%", min: -0.05, max: -0.03 },
    { label: "-3~0%", min: -0.03, max: 0 },
    { label: "0~3%", min: 0, max: 0.03 },
    { label: "3~5%", min: 0.03, max: 0.05 },
    { label: ">5%", min: 0.05, max: Number.POSITIVE_INFINITY },
  ];
  return buckets.map((bucket, index) => {
    const count = values.filter((value) => value >= bucket.min && (index === buckets.length - 1 ? value <= bucket.max : value < bucket.max)).length;
    return { label: bucket.label, count, probability: values.length ? count / values.length : 0 };
  });
}

function fitStandardizer(vectors: number[][]) {
  const width = vectors[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, index) => mean(vectors.map((vector) => vector[index])));
  const scales = Array.from({ length: width }, (_, index) => {
    const variance = mean(vectors.map((vector) => (vector[index] - means[index]) ** 2));
    return Math.sqrt(variance) || 1;
  });
  return { means, scales };
}

function standardize(vector: number[], means: number[], scales: number[]) {
  return vector.map((value, index) => (value - means[index]) / scales[index]);
}

function movingAverage(candles: Candle[], index: number, period: number): number | null {
  if (index < period - 1) return null;
  return mean(candles.slice(index - period + 1, index + 1).map((candle) => candle.close));
}

function periodReturn(candles: Candle[], index: number, period: number): number {
  const prior = candles[index - period];
  return prior?.close ? candles[index].close / prior.close - 1 : 0;
}

function dailyReturns(candles: Candle[], startIndex: number, endIndex: number): number[] {
  const values: number[] = [];
  for (let index = Math.max(1, startIndex); index <= endIndex; index += 1) {
    const previous = candles[index - 1]?.close;
    const current = candles[index]?.close;
    if (previous > 0 && current > 0) values.push(current / previous - 1);
  }
  return values;
}

function averageTrueRangeRatio(candles: Candle[], index: number, period: number): number {
  const start = Math.max(1, index - period + 1);
  const ranges: number[] = [];
  for (let cursor = start; cursor <= index; cursor += 1) {
    const candle = candles[cursor];
    const previousClose = candles[cursor - 1]?.close;
    if (!candle || !previousClose) continue;
    ranges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    ) / previousClose);
  }
  return mean(ranges);
}

function standardDeviation(values: number[]): number {
  if (!values.length) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function streaks(candles: Candle[], index: number) {
  let upStreak = 0;
  let downStreak = 0;
  for (let cursor = index; cursor > 0; cursor -= 1) {
    const change = candles[cursor].close - candles[cursor - 1].close;
    if (change > 0 && downStreak === 0) upStreak += 1;
    else if (change < 0 && upStreak === 0) downStreak += 1;
    else break;
  }
  return { upStreak, downStreak };
}

function sampleConfidence(sampleSize: number): NextDayRuleResult["confidence"] {
  if (sampleSize < 10) return "极低";
  if (sampleSize < 20) return "较低";
  if (sampleSize < 50) return "中等";
  if (sampleSize <= 100) return "较高";
  return "高";
}

function rocAuc(probabilities: number[], labels: number[]): number | null {
  const positiveIndexes = labels.flatMap((label, index) => label === 1 ? [index] : []);
  const negativeIndexes = labels.flatMap((label, index) => label === 0 ? [index] : []);
  if (!positiveIndexes.length || !negativeIndexes.length) return null;
  let score = 0;
  for (const positive of positiveIndexes) {
    for (const negative of negativeIndexes) {
      if (probabilities[positive] > probabilities[negative]) score += 1;
      else if (probabilities[positive] === probabilities[negative]) score += 0.5;
    }
  }
  return score / (positiveIndexes.length * negativeIndexes.length);
}

function quantile(values: number[], probability: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function weightedMean(values: Array<{ value: number; weight: number }>): number {
  const weight = values.reduce((sum, item) => sum + item.weight, 0);
  return weight ? values.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : 0;
}

function weightedValueMean(values: number[], weights: number[]): number {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!values.length || !totalWeight) return mean(values);
  return values.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0) / totalWeight;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function shiftProbabilityByLogit(probability: number, adjustment: number): number {
  const bounded = clamp(probability, 0.01, 0.99);
  return clamp(sigmoid(Math.log(bounded / (1 - bounded)) + adjustment), 0.05, 0.95);
}

function sigmoid(value: number): number {
  if (value < -35) return 0;
  if (value > 35) return 1;
  return 1 / (1 + Math.exp(-value));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatPercentValue(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}
