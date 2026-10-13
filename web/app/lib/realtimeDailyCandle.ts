import type { Candle, ParsedDataset } from "./market.ts";
import type { RealtimeSnapshot } from "./realtimeMarket.ts";

const chinaTimezone = "Asia/Shanghai";
const sessionOpenTime = "09:30:00";
const sessionCloseTime = "15:00:00";

export type RealtimeDailyCandleMerge = {
  candles: Candle[];
  included: boolean;
  provisional: boolean;
  date: string;
  time: string;
};

export function mergeCnRealtimeDailyCandle(
  candles: Candle[],
  dataset: ParsedDataset,
  snapshot: RealtimeSnapshot | null,
  now = new Date(),
): RealtimeDailyCandleMerge {
  const unchanged = {
    candles,
    included: false,
    provisional: false,
    date: "",
    time: "",
  };
  if (!snapshot || !dataset.dataLevel.includes("日K聚合")) return unchanged;
  if (!dataset.codes.includes(snapshot.code) || !isCurrentTradingDaySnapshot(snapshot, now)) return unchanged;
  if (![snapshot.open, snapshot.high, snapshot.low, snapshot.price].every(isPositiveFinite)) return unchanged;
  if (!Number.isFinite(snapshot.volume) || snapshot.volume < 0 || !Number.isFinite(snapshot.amount) || snapshot.amount < 0) return unchanged;

  const context = contextForDate(dataset, snapshot.date);
  const adjustmentFactor = context?.adjustmentFactor && context.adjustmentFactor > 0 ? context.adjustmentFactor : 1;
  const listedAShares = context?.listedAShares ?? dataset.listedAShares;
  const open = snapshot.open / adjustmentFactor;
  const close = snapshot.price / adjustmentFactor;
  const high = Math.max(snapshot.high, snapshot.open, snapshot.price) / adjustmentFactor;
  const low = Math.min(snapshot.low, snapshot.open, snapshot.price) / adjustmentFactor;
  const volume = Math.round(snapshot.volume);
  const amount = snapshot.amount;
  const typicalPrice = (open + high + low + close) / 4;
  const adjustedAmount = amount > 0 ? amount / adjustmentFactor : typicalPrice * volume;
  const withoutCurrentDay = candles.filter((candle) => candle.date !== snapshot.date);
  const previousClose = withoutCurrentDay.at(-1)?.close ?? open;
  const change = close - previousClose;
  const candle: Candle = {
    key: snapshot.date,
    label: snapshot.date.slice(5),
    date: snapshot.date,
    time: "",
    open,
    high,
    low,
    close,
    volume,
    amount,
    adjustedAmount,
    vwap: volume > 0 ? adjustedAmount / volume : close,
    turnoverPct: listedAShares && listedAShares > 0 ? (volume / listedAShares) * 100 : null,
    listedAShares,
    change,
    changePct: previousClose ? (change / previousClose) * 100 : 0,
  };
  const merged = [...withoutCurrentDay, candle].sort((left, right) => left.date.localeCompare(right.date));
  const snapshotTime = normalizeClock(snapshot.time);

  return {
    candles: merged,
    included: true,
    provisional: snapshotTime < sessionCloseTime,
    date: snapshot.date,
    time: snapshotTime,
  };
}

function isCurrentTradingDaySnapshot(snapshot: RealtimeSnapshot, now: Date): boolean {
  const today = now.toLocaleDateString("sv-SE", { timeZone: chinaTimezone });
  const currentTime = now.toLocaleTimeString("sv-SE", { timeZone: chinaTimezone, hour12: false, hourCycle: "h23" });
  const snapshotTime = normalizeClock(snapshot.time);
  return snapshot.date === today
    && snapshotTime >= sessionOpenTime
    && snapshotTime <= sessionCloseTime
    && snapshotTime <= currentTime;
}

function contextForDate(dataset: ParsedDataset, date: string) {
  if (dataset.dailyContexts[date]) return dataset.dailyContexts[date];
  return Object.values(dataset.dailyContexts)
    .filter((context) => context.date <= date)
    .sort((left, right) => right.date.localeCompare(left.date))[0];
}

function normalizeClock(value: string): string {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
