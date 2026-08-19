export type NextDayPanelInput = {
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
    benchmarkReturn1d: number;
    benchmarkReturn5d: number;
    relativeStrength5d: number;
    marketRegime: string;
  };
  baselineUpRate: number;
  analogUpRate: number;
  baseUpProbability: number;
  ensembleAgreement: number;
  dataSufficiency: number;
  activeRuleCount: number;
};

export type NextDayPanelModelArtifact = {
  version: string;
  featureNames: readonly string[];
  means: readonly number[];
  scales: readonly number[];
  coefficients: readonly number[];
  intercept: number;
  trainedThrough: string;
  validation: {
    samples: number;
    accuracy: number;
    brierScore: number;
    baselineAccuracy: number;
    baselineBrierScore: number;
  };
  regimeCalibration?: {
    trainedThrough: string;
    samples: number;
    shrinkage: number;
    logitAdjustments: Readonly<Record<string, number>>;
  };
};

export const nextDayPanelFeatureNames = [
  "return1d",
  "return5d",
  "return10d",
  "return20d",
  "openGap",
  "amplitude",
  "upperShadow",
  "lowerShadow",
  "closePosition",
  "logVolumeRatio20",
  "aboveMA5",
  "aboveMA20",
  "ma5Rising",
  "ma20Rising",
  "newHigh20",
  "newHigh60",
  "upStreak",
  "downStreak",
  "volatility20",
  "atr14",
  "benchmarkReturn1d",
  "benchmarkReturn5d",
  "relativeStrength5d",
  "marketUp",
  "marketDown",
  "marketStrongRange",
  "marketWeakRange",
  "baselineLogit",
  "analogLogit",
  "ensembleLogit",
  "ensembleAgreement",
  "dataSufficiency",
  "activeRuleCount",
] as const;

export function buildNextDayPanelFeatures(input: NextDayPanelInput): number[] {
  const technical = input.technicalState;
  return [
    technical.return1d,
    technical.return5d,
    technical.return10d,
    technical.return20d,
    technical.openGap,
    technical.amplitude,
    technical.upperShadow,
    technical.lowerShadow,
    technical.closePosition,
    Math.log(clamp(technical.volumeRatio20, 0.1, 10)),
    Number(technical.aboveMA5),
    Number(technical.aboveMA20),
    Number(technical.ma5Rising),
    Number(technical.ma20Rising),
    Number(technical.newHigh20),
    Number(technical.newHigh60),
    clamp(technical.upStreak, 0, 8) / 8,
    clamp(technical.downStreak, 0, 8) / 8,
    technical.volatility20,
    technical.atr14,
    technical.benchmarkReturn1d,
    technical.benchmarkReturn5d,
    technical.relativeStrength5d,
    Number(technical.marketRegime === "市场上行"),
    Number(technical.marketRegime === "市场下行"),
    Number(technical.marketRegime === "市场偏强震荡"),
    Number(technical.marketRegime === "市场偏弱震荡"),
    logit(input.baselineUpRate),
    logit(input.analogUpRate),
    logit(input.baseUpProbability),
    clamp(input.ensembleAgreement, 0, 1),
    clamp(input.dataSufficiency / 100, 0, 1),
    clamp(input.activeRuleCount, 0, 5) / 5,
  ];
}

export function predictNextDayPanelProbability(
  input: NextDayPanelInput,
  artifact: NextDayPanelModelArtifact,
): number | null {
  const features = buildNextDayPanelFeatures(input);
  if (artifact.featureNames.length !== features.length
    || artifact.means.length !== features.length
    || artifact.scales.length !== features.length
    || artifact.coefficients.length !== features.length) return null;
  let score = artifact.intercept;
  for (let index = 0; index < features.length; index += 1) {
    const scale = artifact.scales[index] > 1e-9 ? artifact.scales[index] : 1;
    score += ((features[index] - artifact.means[index]) / scale) * artifact.coefficients[index];
  }
  return sigmoid(score);
}

function logit(value: number): number {
  const probability = clamp(value, 0.05, 0.95);
  return Math.log(probability / (1 - probability));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-clamp(value, -30, 30)));
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
