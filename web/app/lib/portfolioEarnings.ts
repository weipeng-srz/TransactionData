import type { StockHoldings } from "./holdings.ts";
import { currencyOf, stockStorageKey, type StockCurrency } from "./security.ts";

export type EarningsQuote = {
  status: "idle" | "loading" | "ready" | "error";
  partial?: boolean;
  price: number | null;
  previousClose: number | null;
  date: string;
  time: string;
  marketStatus?: string;
  candles?: Array<{ date: string }>;
};

export type EarningsDay = {
  date: string;
  currency: StockCurrency;
  profit: number | null;
  openingValue: number | null;
  positions: number;
  priced: number;
  signature: string;
  status: "estimated" | "holdings_changed" | "incomplete_quotes";
  observedAt: string;
  quoteTime: string;
};

export type EarningsHistory = { version: 1; days: EarningsDay[] };
export const earningsStorageKey = "ticklens.portfolio-earnings.v1";
const currencies: StockCurrency[] = ["CNY", "USD"];
const maxRecords = 3_660;

export function earningsMarketDate(currency: StockCurrency, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: currency === "USD" ? "America/New_York" : "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function parseEarningsHistory(value: unknown): EarningsHistory {
  const empty: EarningsHistory = { version: 1, days: [] };
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1
    || !("days" in value) || !Array.isArray(value.days)) return empty;
  const records = new Map<string, EarningsDay>();
  for (const item of value.days.slice(-maxRecords)) {
    if (!item || typeof item !== "object") continue;
    const row = item as EarningsDay;
    if (!isDate(row.date) || !currencies.includes(row.currency)
      || !["estimated", "holdings_changed", "incomplete_quotes"].includes(row.status)
      || !Number.isInteger(row.positions) || row.positions < 0 || row.positions > 200
      || !Number.isInteger(row.priced) || row.priced < 0 || row.priced > row.positions
      || typeof row.signature !== "string" || row.signature.length > 24_000
      || typeof row.observedAt !== "string" || Number.isNaN(Date.parse(row.observedAt))
      || typeof row.quoteTime !== "string" || !/^$|^\d{2}:\d{2}(?::\d{2})?$/.test(row.quoteTime)) continue;
    const complete = row.status === "estimated";
    if (complete && (!isFiniteNumber(row.profit) || !isPositive(row.openingValue)
      || row.priced !== row.positions || row.positions === 0)) continue;
    records.set(`${row.currency}:${row.date}`, {
      date: row.date, currency: row.currency, status: row.status,
      profit: complete ? row.profit : null,
      openingValue: complete ? row.openingValue : null,
      positions: row.positions, priced: row.priced, signature: row.signature,
      observedAt: row.observedAt, quoteTime: row.quoteTime,
    });
  }
  return { version: 1, days: [...records.values()].sort(compareDays) };
}

/** Records observed mark-to-market estimates only; never reconstructs trades or missing days. */
export function recordPortfolioEarnings(
  history: EarningsHistory,
  holdings: StockHoldings,
  quotes: Record<string, EarningsQuote | undefined>,
  now = new Date(),
): EarningsHistory {
  let days = history.days;
  for (const currency of currencies) {
    const date = earningsMarketDate(currency, now);
    const positions = Object.values(holdings).filter((holding) => currencyOf(holding) === currency)
      .sort((a, b) => stockStorageKey(a).localeCompare(stockStorageKey(b)));
    const signature = positions.map((holding) => `${stockStorageKey(holding)}:${holding.shares}:${holding.cost}:${holding.updatedAt}`).join("|");
    const existing = days.find((row) => row.currency === currency && row.date === date);
    const currentQuotes = positions.map((holding) => quotes[stockStorageKey(holding)]);
    // Yesterday's close shown on a holiday/weekend must not become a new day's return.
    if (!existing && !currentQuotes.some((quote) => isQuoteForDay(quote, currency, date))) continue;
    const changed = existing?.status === "holdings_changed"
      || (existing !== undefined && existing.signature !== signature)
      || positions.some((holding) => earningsMarketDate(currency, new Date(holding.updatedAt)) >= date);
    let profit = 0;
    let openingValue = 0;
    let priced = 0;
    const quoteTimes: string[] = [];
    positions.forEach((holding, index) => {
      const quote = currentQuotes[index];
      if (!quote || quote.status !== "ready" || quote.partial || !isQuoteForDay(quote, currency, date)
        || !isPositive(quote.price) || !isPositive(quote.previousClose)) return;
      priced += 1;
      profit += holding.shares * (quote.price - quote.previousClose);
      openingValue += holding.shares * quote.previousClose;
      quoteTimes.push(quote.time);
    });
    const complete = positions.length > 0 && priced === positions.length
      && Number.isFinite(profit) && Number.isFinite(openingValue);
    // Keep the last complete observation during a transient refresh, with its original timestamp.
    if (!changed && !complete && existing?.status === "estimated") continue;
    const next: EarningsDay = {
      date, currency, signature, positions: positions.length, priced,
      status: changed ? "holdings_changed" : complete ? "estimated" : "incomplete_quotes",
      profit: !changed && complete ? profit : null,
      openingValue: !changed && complete ? openingValue : null,
      observedAt: now.toISOString(),
      quoteTime: quoteTimes.sort()[0] ?? "",
    };
    if (existing && sameObservation(existing, next)) continue;
    days = [...days.filter((row) => row.currency !== currency || row.date !== date), next];
  }
  return days === history.days ? history : { version: 1, days: days.sort(compareDays).slice(-maxRecords) };
}

export function summarizeEarnings(days: EarningsDay[], currency: StockCurrency, month?: string) {
  const rows = days.filter((row) => row.currency === currency && (!month || row.date.startsWith(`${month}-`))).sort(compareDays);
  const available = rows.filter((row) => row.status === "estimated" && row.profit !== null);
  const best = [...available].sort((a, b) => b.profit! - a.profit!)[0] ?? null;
  const worst = [...available].sort((a, b) => a.profit! - b.profit!)[0] ?? null;
  return {
    rows,
    profit: available.length ? available.reduce((sum, row) => sum + row.profit!, 0) : null,
    recordedDays: available.length,
    unavailableDays: rows.length - available.length,
    winningDays: available.filter((row) => row.profit! > 0).length,
    losingDays: available.filter((row) => row.profit! < 0).length,
    flatDays: available.filter((row) => row.profit === 0).length,
    best,
    worst,
  };
}

export function earningsDayReturn(day: EarningsDay | undefined): number | null {
  return day?.profit !== null && day?.profit !== undefined && isPositive(day.openingValue)
    ? day.profit / day.openingValue * 100 : null;
}

export function earningsCalendar(month: string): Array<{ date: string; day: number } | null> {
  if (!/^\d{4}-\d{2}$/.test(month) || !isDate(`${month}-01`)) return [];
  const first = new Date(`${month}-01T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: count }, (_, index) => ({ date: `${month}-${String(index + 1).padStart(2, "0")}`, day: index + 1 })),
  ];
}

function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isPositive(value: unknown): value is number { return isFiniteNumber(value) && value > 0; }
function isQuoteForDay(quote: EarningsQuote | undefined, currency: StockCurrency, date: string): boolean {
  if (!quote || quote.date !== date) return false;
  if (currency === "CNY") return true;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  // The US realtime provider uses its fetch clock as the quote date. A matching daily
  // candle is therefore required to avoid assigning Friday's move to a holiday/Monday premarket.
  return weekday !== 0 && weekday !== 6 && quote.marketStatus !== "盘前"
    && quote.time >= "09:30:00" && Boolean(quote.candles?.some((candle) => candle.date === date));
}
function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function compareDays(a: EarningsDay, b: EarningsDay): number { return a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency); }
function sameObservation(a: EarningsDay, b: EarningsDay): boolean {
  return a.signature === b.signature && a.profit === b.profit && a.openingValue === b.openingValue
    && a.status === b.status && a.positions === b.positions && a.priced === b.priced && a.quoteTime === b.quoteTime;
}
