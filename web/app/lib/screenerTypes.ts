export type ScreenerMarket = "CN" | "US";
export type ScreenerRecommendation = "强烈关注" | "值得关注" | "观察" | "谨慎";
export type ScreenerSecurityType = "股票" | "ETF" | "杠杆ETF" | "信托";

export type ScreenerStrategyEvidence = {
  strategy: string;
  sampleSize: number;
  winRate1D: number;
  medianReturn1D: number;
  averageReturn3D: number;
  averageMfe3D: number;
  averageMae3D: number;
  window: string;
  methodology: string;
};

export type ScreenerPhaseAssessment = {
  score: number;
  rawScore: number;
  level: "强" | "中" | "弱";
  stage: string;
  actionable: boolean;
  overheat: boolean;
  gateReason: string;
  rankPercentile: number;
  rankLabel: string;
  summary: string;
  features: string[];
  warning: string;
};

export type ScreenerResearchScore = {
  score: number;
  coverage: number;
  modelVersion: string;
  signal: "正向证据较多" | "证据大致均衡" | "风险证据较多" | "数据不足";
  dimensions: Array<{
    key: "trend" | "momentum" | "capital" | "profitability" | "growth" | "valuation" | "sentiment" | "risk";
    label: string;
    score: number;
    coverage: number;
  }>;
};

export type ScreenerOpportunity = {
  market: ScreenerMarket;
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  currency: "CNY" | "USD";
  change: number;
  score: number;
  risk: number;
  confidence: number;
  recommendation: ScreenerRecommendation;
  researchScore?: ScreenerResearchScore;
  signal: string;
  strategies: string[];
  sector: string;
  themes: string[];
  streak: number;
  volumeRatio: number;
  turnover: number;
  amount: string;
  amountValue: number;
  marketCap: number;
  closePosition: number;
  return20: number;
  benchmarkReturn20: number;
  relativeStrength20: number;
  securityType: ScreenerSecurityType;
  qualityTier: "standard" | "expanded";
  firstLimit?: string;
  sealStrength?: number;
  limitDetail?: {
    first: string;
    last: string;
    burstCount: number;
    sealFund: string;
    sealFundRatio: number;
    shape: string;
    strength: number;
  };
  reasons: string[];
  risks: string[];
  factorScores: Array<{ label: string; value: number }>;
  phaseAnalysis: {
    mainUptrend: ScreenerPhaseAssessment;
    accumulation: ScreenerPhaseAssessment;
  };
  plan: {
    watch: string;
    breakout: string;
    stop: string;
    targets: string;
    watchLow: number;
    watchHigh: number;
    breakoutPrice: number;
    stopPrice: number;
    targetPrices: number[];
    atr: number;
    atrPercent: number;
    stopDistancePercent: number;
    rewardRisk: number;
    riskPerTradePercent: number;
    suggestedPositionPercent: number;
    trailingStop: string;
    exitRule: string;
  };
  chart: {
    dates: string[];
    prices: number[];
    volumes: number[];
  };
  audit: {
    lastBarDate: string;
    barCount: number;
    modelVersion: string;
    completeness: number;
  };
};

export type ScreenerTheme = {
  name: string;
  heat: number;
  change: number;
  count: number;
};

export type ScreenerSnapshot = {
  mood: "极强" | "偏强" | "中性" | "偏弱" | "极弱";
  moodScore: number;
  primary: string;
  secondary: string;
  breadthLabel: string;
  breadthValue: string;
  breadthCaption: string;
  event: string;
  liquidity: string;
  riskBudget: "低" | "中" | "中高" | "高";
  riskNote: string;
};

export type ScreenerLadderRow = {
  level: string;
  names: string[];
};

export type ScreenerStructure = {
  title: string;
  badge: string;
  rows: ScreenerLadderRow[];
  stats: Array<{ label: string; value: string }>;
  note: string;
};

export type ScreenerFeed = {
  market: ScreenerMarket;
  tradeDate: string;
  fetchedAt: string;
  quoteStatus: string;
  source: string;
  sourceLinks: Array<{ label: string; url: string }>;
  snapshot: ScreenerSnapshot;
  brief: { priority: string; summary: string; positiveTag: string; warningTag: string };
  opportunities: ScreenerOpportunity[];
  themes: ScreenerTheme[];
  structure: ScreenerStructure;
  strategyEvidence: ScreenerStrategyEvidence[];
  diagnostics: {
    universeCount: number;
    scannedCount: number;
    qualityCount: number;
    expandedQualityCount: number;
    prefilterCount: number;
    analyzedCount: number;
    failedHistoryCount: number;
    historyWindowDays: number;
    modelVersion: string;
    delayed: boolean;
  };
};
