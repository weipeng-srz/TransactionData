import type { ParsedDataset, TickRow } from "./market.ts";
import type { RealtimeSnapshot } from "./realtimeMarket.ts";

const chinaTimezone = "Asia/Shanghai";
const closeTime = "15:00:00";

export function mergeClosedCnRealtimeDay(
  dataset: ParsedDataset,
  snapshot: RealtimeSnapshot | null,
  now = new Date(),
): ParsedDataset {
  if (!snapshot || !dataset.dataLevel.includes("日K聚合")) return dataset;
  if (!dataset.codes.includes(snapshot.code) || !isFinalSnapshotForToday(snapshot, now)) return dataset;
  if (![snapshot.open, snapshot.high, snapshot.low, snapshot.price].every((value) => Number.isFinite(value) && value > 0)) return dataset;
  if (!Number.isFinite(snapshot.volume) || snapshot.volume < 0 || !Number.isFinite(snapshot.amount) || snapshot.amount < 0) return dataset;

  const context = contextForDate(dataset, snapshot.date);
  const adjustmentFactor = context?.adjustmentFactor && context.adjustmentFactor > 0 ? context.adjustmentFactor : 1;
  const listedAShares = context?.listedAShares ?? dataset.listedAShares;
  const rawPrices = [snapshot.open, snapshot.high, snapshot.low, snapshot.price];
  const times = ["09:30:00", "10:30:00", "14:00:00", closeTime];
  const volumes = splitIntegerTotal(Math.round(snapshot.volume), rawPrices.length);
  const amounts = splitTotal(snapshot.amount, rawPrices.length);
  const rows = dataset.rows.filter((row) => row.code !== snapshot.code || row.date !== snapshot.date);
  const dayRows = rawPrices.map<TickRow>((rawPrice, index) => {
    const price = rawPrice / adjustmentFactor;
    return {
      date: snapshot.date,
      time: times[index],
      code: snapshot.code,
      price,
      rawPrice,
      volume: volumes[index],
      amount: amounts[index],
      adjustedAmount: price * volumes[index],
      status: "",
      rawStatus: "",
      sequence: index + 1,
      session: index === rawPrices.length - 1 ? "收盘集合竞价" : "连续竞价",
      level: "HTTPS日K聚合行情 · 收盘实时快照",
      adjustmentFactor,
      listedAShares,
      shareCapitalDate: context?.shareCapitalDate ?? dataset.shareCapitalDate,
    };
  });
  rows.push(...dayRows);
  rows.sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`) || left.sequence - right.sequence);

  return {
    ...dataset,
    rows,
    dailyContexts: {
      ...dataset.dailyContexts,
      [snapshot.date]: {
        date: snapshot.date,
        adjustmentFactor,
        listedAShares,
        shareCapitalDate: context?.shareCapitalDate ?? dataset.shareCapitalDate,
      },
    },
  };
}

function isFinalSnapshotForToday(snapshot: RealtimeSnapshot, now: Date): boolean {
  const today = now.toLocaleDateString("sv-SE", { timeZone: chinaTimezone });
  const time = now.toLocaleTimeString("sv-SE", { timeZone: chinaTimezone, hour12: false, hourCycle: "h23" });
  return snapshot.date === today && time >= closeTime && snapshot.time >= closeTime;
}

function contextForDate(dataset: ParsedDataset, date: string) {
  if (dataset.dailyContexts[date]) return dataset.dailyContexts[date];
  return Object.values(dataset.dailyContexts)
    .filter((context) => context.date <= date)
    .sort((left, right) => right.date.localeCompare(left.date))[0];
}

function splitIntegerTotal(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => index === count - 1 ? total - base * (count - 1) : base);
}

function splitTotal(total: number, count: number): number[] {
  const base = total / count;
  return Array.from({ length: count }, (_, index) => index === count - 1 ? total - base * (count - 1) : base);
}
