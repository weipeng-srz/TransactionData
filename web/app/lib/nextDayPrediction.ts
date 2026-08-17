import type { Candle } from "./market.ts";

export type PredictionWindow = 60 | 126 | 250;
export type PredictionNeighborCount = 5 | 10 | 15 | 20 | 30;

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
  asOf: string;
  analysisWindow: PredictionWindow;
  availableDays: number;
  trainingSamples: number;
  signal: {
    grade: "S" | "A" | "B" | "C";
    score: number;
    state: string;
    confidence: number;
  };
  prediction: {
    upProbability: number;
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
  modelValidation: {
    accuracy: number | null;
    auc: number | null;
    precision: number | null;
    recall: number | null;
    baselineUpRate: number;
    baselineAccuracy: number;
    validationSamples: number;
    mlEnabled: boolean;
    reason: string;
  };
  weights: {
    rule: number;
    analog: number;
    ml: number;
  };
  notice: string;
};

type FeatureState = NextDayPredictionReport["technicalState"] & {
  ma5Deviation: number;
  ma20Deviation: number;
  streak: number;
  vector: number[];
};

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
  candles: Candle[],
  options: { window?: PredictionWindow; neighbors?: PredictionNeighborCount } = {},
): NextDayPredictionReport | null {
  const analysisWindow = options.window ?? 126;
  const requestedNeighbors = options.neighbors ?? 15;
  if (candles.length < 32) return null;

  const latestIndex = candles.length - 1;
  const currentFeature = featureAt(candles, latestIndex);
  if (!currentFeature) return null;

  const startIndex = Math.max(20, latestIndex - analysisWindow);
  const rows: TrainingRow[] = [];
  for (let index = startIndex; index < latestIndex; index += 1) {
    const feature = featureAt(candles, index);
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
      return { row, similarity: Math.exp(-distance * 0.72) };
    })
    .sort((left, right) => right.similarity - left.similarity)
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
  const analogUpRate = mean(similarItems.map((item) => item.nextCloseReturn > 0 ? 1 : 0));
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
    ? mean(activeRules.map((rule) => clamp(rule.sampleSize / 30, 0.08, 1)))
    : 0;
  const ruleProbability = activeRules.length
    ? weightedMean(activeRules.map((rule) => ({
      value: baselineUpRate + (rule.upRate - baselineUpRate) * clamp(rule.sampleSize / 30, 0.08, 1),
      weight: clamp(rule.sampleSize / 30, 0.08, 1),
    })))
    : baselineUpRate;

  const validation = validateLogistic(featureVectors, rows.map((row) => row.nextUp), baselineUpRate);
  const finalLogistic = trainLogistic(featureVectors, rows.map((row) => row.nextUp), 220);
  const mlProbability = predictLogistic(finalLogistic, currentFeature.vector);
  const ridgeTargets = [
    rows.map((row) => row.nextOpenReturn),
    rows.map((row) => row.nextCloseReturn),
    rows.map((row) => row.nextHighReturn),
    rows.map((row) => row.nextLowReturn),
    rows.map((row) => row.nextVolumeRatio20),
  ];
  const ridgePredictions = ridgeTargets.map((target) => boundedRidgePrediction(featureVectors, target, currentFeature.vector));

  const weights = predictionWeights(validation.mlEnabled, ruleReliability);
  const upProbability = clamp(
    ruleProbability * weights.rule + analogUpRate * weights.analog + mlProbability * weights.ml,
    0.05,
    0.95,
  );
  const returnMlWeight = validation.mlEnabled ? 0.35 : 0;
  const analogReturnWeight = 1 - returnMlWeight;
  const expectedOpenGap = mean(analogOpenReturns) * analogReturnWeight + ridgePredictions[0] * returnMlWeight;
  const expectedCloseReturn = mean(analogReturns) * analogReturnWeight + ridgePredictions[1] * returnMlWeight;
  const expectedHighReturn = Math.max(expectedOpenGap, mean(analogHighReturns) * analogReturnWeight + ridgePredictions[2] * returnMlWeight);
  const expectedLowReturn = Math.min(expectedOpenGap, mean(analogLowReturns) * analogReturnWeight + ridgePredictions[3] * returnMlWeight);
  const expectedVolumeRatio20 = clamp(mean(analogVolumeRatios) * analogReturnWeight + ridgePredictions[4] * returnMlWeight, 0.2, 4);
  const volumeUpProbability = mean(similarItems.map((item) => item.nextVolumeRatio20 >= 1.2 ? 1 : 0));
  const quietProbability = mean(similarItems.map((item) => item.nextVolumeRatio20 < 0.8 ? 1 : 0));
  const activeProbability = mean(similarItems.map((item) => item.nextVolumeRatio20 >= 1.2 ? 1 : 0));
  const normalProbability = clamp(1 - quietProbability - activeProbability, 0, 1);
  const averageVolume20 = mean(candles.slice(Math.max(0, latestIndex - 19), latestIndex + 1).map((item) => item.volume));

  const bullishFactors = buildBullishFactors(currentFeature, activeRules);
  const riskFactors = buildRiskFactors(currentFeature, activeRules);
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
  const confidence = clamp(Math.round(
    35 + Math.min(rows.length, analysisWindow) / analysisWindow * 25 + mean(similarRows.map((item) => item.similarity)) * 22 + (validation.mlEnabled ? 8 : 0),
  ), 30, 90);

  const scenarios = buildScenarios(upProbability, expectedOpenGap, expectedHighReturn, expectedLowReturn, expectedVolumeRatio20, currentFeature);
  const validationReason = validation.mlEnabled
    ? `滚动验证优于 ${(validation.baselineAccuracy * 100).toFixed(1)}% 的方向基准，ML 参与组合。`
    : validation.validationSamples < 12
      ? "滚动验证样本不足，ML 权重自动降为 0。"
      : `滚动验证未同时超过方向基准与 AUC 门槛，ML 权重自动降为 0。`;

  return {
    asOf: candles[latestIndex].date,
    analysisWindow,
    availableDays: Math.min(analysisWindow, candles.length),
    trainingSamples: rows.length,
    signal: { grade, score: signalScore, state, confidence },
    prediction: {
      upProbability,
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
      currentVolume: candles[latestIndex].volume,
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
      meanReturn: mean(analogReturns),
      medianReturn: quantile(analogReturns, 0.5),
      q25: quantile(analogReturns, 0.25),
      q75: quantile(analogReturns, 0.75),
      averageHighReturn: mean(analogHighReturns),
      averageLowReturn: mean(analogLowReturns),
      averageSimilarity: mean(similarItems.map((item) => item.similarity)),
      items: similarItems,
    },
    distribution: buildDistribution(analogReturns),
    scenarios,
    bullishFactors,
    riskFactors,
    activeRules,
    modelValidation: {
      accuracy: validation.accuracy,
      auc: validation.auc,
      precision: validation.precision,
      recall: validation.recall,
      baselineUpRate,
      baselineAccuracy: validation.baselineAccuracy,
      validationSamples: validation.validationSamples,
      mlEnabled: validation.mlEnabled,
      reason: validationReason,
    },
    weights,
    notice: `结果基于截至 ${candles[latestIndex].date} 的 ${Math.min(analysisWindow, candles.length)} 个交易日数据，采用概率、区间和场景表达，仅作交易研究辅助，不构成收益承诺或投资建议。`,
  };
}

function featureAt(candles: Candle[], index: number): FeatureState | null {
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
  const baselineAccuracy = Math.max(baselineUpRate, 1 - baselineUpRate);
  const mlEnabled = actuals.length >= 12 && accuracy != null && auc != null && accuracy > baselineAccuracy && auc >= 0.52;
  return { accuracy, auc, precision, recall, baselineAccuracy, validationSamples: actuals.length, mlEnabled };
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

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
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
