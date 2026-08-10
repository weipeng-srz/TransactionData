import { calculateHoldingMetrics, type StockHoldings } from "./holdings.ts";

export type WatchlistStock = {
  code: string;
  name: string;
  addedAt: string;
};

export type PortfolioTotals = {
  tracked: number;
  positioned: number;
  costValue: number;
  marketValue: number;
  profit: number;
  profitPct: number;
  dayProfit: number;
};

const maxWatchlistSize = 50;

export function parseWatchlist(value: unknown): WatchlistStock[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const stocks: WatchlistStock[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Partial<WatchlistStock>;
    const code = String(item.code ?? "").trim();
    const name = String(item.name ?? "").trim();
    const addedAt = String(item.addedAt ?? "");
    if (
      !/^\d{6}$/.test(code)
      || !name
      || name.length > 40
      || Number.isNaN(Date.parse(addedAt))
      || seen.has(code)
    ) continue;
    seen.add(code);
    stocks.push({ code, name, addedAt });
    if (stocks.length >= maxWatchlistSize) break;
  }
  return stocks;
}

export function upsertWatchlistStock(current: WatchlistStock[], stock: WatchlistStock): WatchlistStock[] {
  const normalized = parseWatchlist([stock])[0];
  if (!normalized) return current;
  return [normalized, ...current.filter((item) => item.code !== normalized.code)].slice(0, maxWatchlistSize);
}

export function calculatePortfolioTotals(
  watchlist: WatchlistStock[],
  holdings: StockHoldings,
  quotes: Record<string, { price?: number | null; change?: number | null }>,
): PortfolioTotals {
  let costValue = 0;
  let marketValue = 0;
  let profit = 0;
  let dayProfit = 0;
  let positioned = 0;

  for (const stock of watchlist) {
    const holding = holdings[stock.code];
    if (!holding) continue;
    positioned += 1;
    const quote = quotes[stock.code];
    const metrics = calculateHoldingMetrics(holding.shares, holding.cost, quote?.price);
    if (metrics) {
      costValue += metrics.costValue;
      marketValue += metrics.marketValue;
      profit += metrics.profit;
    }
    if (quote?.change != null && Number.isFinite(quote.change)) {
      dayProfit += holding.shares * quote.change;
    }
  }

  return {
    tracked: watchlist.length,
    positioned,
    costValue,
    marketValue,
    profit,
    profitPct: costValue > 0 ? (profit / costValue) * 100 : 0,
    dayProfit,
  };
}
