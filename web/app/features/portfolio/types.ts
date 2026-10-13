import type { Candle, IntentAnalysis } from "../../lib/market";
import type { NewsItem } from "../../lib/news";
import type { NextDayPredictionReport } from "../../lib/nextDayPrediction";
import type { StockScoreReport } from "../../lib/stockScore";

export type QuoteStatus = "idle" | "loading" | "ready" | "error";

export type PortfolioQuote = {
  status: QuoteStatus;
  partial: boolean;
  candles: Candle[];
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  amount: number | null;
  turnoverPct: number | null;
  date: string;
  time: string;
  marketStatus: string;
  source: string;
  error: string;
  score: StockScoreReport | null;
  intent: IntentAnalysis | null;
  predictionStatus: QuoteStatus;
  prediction: NextDayPredictionReport | null;
  newsItems: NewsItem[];
  newsStatus: QuoteStatus;
  newsError: string;
  technicalSignal: {
    side: "B" | "S";
    date: string;
    price: number;
    score: number;
    reasons: string[];
  } | null;
};

