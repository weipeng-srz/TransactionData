import { calculateIndicators, type Candle, type GuidePoint } from "./market.ts";
import type { RealtimeMinuteCandle } from "./realtimeMarket.ts";

export type RealtimeGuidePoint = GuidePoint & {
  provisional: boolean;
};

export type RealtimeSignalAnalysis = {
  guidePoints: Array<RealtimeGuidePoint | null>;
  signalCount: number;
  latestSignal: { index: number; time: string; guide: RealtimeGuidePoint } | null;
};

export function analyzeRealtimeSignals(
  candles: RealtimeMinuteCandle[],
  date: string,
): RealtimeSignalAnalysis {
  if (!candles.length) return { guidePoints: [], signalCount: 0, latestSignal: null };

  const marketCandles: Candle[] = candles.map((candle, index) => {
    const previousClose = index > 0 ? candles[index - 1].close : candle.open;
    const typicalAmount = candle.amount || candle.close * candle.volume;
    return {
      key: `${date} ${candle.time}`,
      label: candle.time,
      date,
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      amount: typicalAmount,
      adjustedAmount: typicalAmount,
      vwap: candle.volume > 0 && candle.amount > 0 ? candle.amount / candle.volume : candle.close,
      turnoverPct: null,
      change: candle.close - previousClose,
      changePct: previousClose > 0 ? ((candle.close / previousClose) - 1) * 100 : 0,
    };
  });
  const indicators = calculateIndicators(marketCandles);
  const guidePoints = indicators.guidePoints.map((guide, index) => guide ? {
    ...guide,
    provisional: index === candles.length - 1,
  } : null);
  let latestSignal: RealtimeSignalAnalysis["latestSignal"] = null;
  for (let index = guidePoints.length - 1; index >= 0; index -= 1) {
    const guide = guidePoints[index];
    if (!guide) continue;
    latestSignal = { index, time: candles[index].time, guide };
    break;
  }

  return {
    guidePoints,
    signalCount: guidePoints.filter(Boolean).length,
    latestSignal,
  };
}
