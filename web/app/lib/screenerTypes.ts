export type ScreenerMarket = "CN" | "US";
export type ScreenerRecommendation = "强烈关注" | "值得关注" | "观察" | "谨慎";

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
  signal: string;
  strategies: string[];
  sector: string;
  themes: string[];
  streak: number;
  volumeRatio: number;
  turnover: number;
  amount: string;
  closePosition: number;
  firstLimit?: string;
  sealStrength?: number;
  reasons: string[];
  risks: string[];
  factorScores: Array<{ label: string; value: number }>;
  plan: { watch: string; breakout: string; stop: string; targets: string };
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
  diagnostics: {
    universeCount: number;
    analyzedCount: number;
    failedHistoryCount: number;
    delayed: boolean;
  };
};
