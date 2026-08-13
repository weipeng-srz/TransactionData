import { calculateHoldingMetrics, type StockHoldings } from "./holdings.ts";
import {
  currencyOf,
  isUSStockSymbol,
  marketOf,
  normalizeUSSymbol,
  stockStorageKey,
  type StockCurrency,
  type StockMarket,
} from "./security.ts";

export type WatchlistStock = {
  code: string;
  name: string;
  market?: StockMarket;
  currency?: StockCurrency;
  addedAt: string;
};

export type CurrencyPortfolioTotals = Omit<PortfolioTotals, "tracked" | "positioned" | "byCurrency">;

export type PortfolioTotals = {
  tracked: number;
  positioned: number;
  costValue: number;
  marketValue: number;
  profit: number;
  profitPct: number;
  dayProfit: number;
  byCurrency: Record<StockCurrency, CurrencyPortfolioTotals>;
};

const maxWatchlistSize = 50;

export function parseWatchlist(value: unknown): WatchlistStock[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const stocks: WatchlistStock[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Partial<WatchlistStock>;
    const market = marketOf(item);
    const currency = currencyOf(item);
    const rawCode = String(item.code ?? "").trim();
    const code = market === "US" ? normalizeUSSymbol(rawCode) : rawCode;
    const name = String(item.name ?? "").trim();
    const addedAt = String(item.addedAt ?? "");
    if (
      !(market === "US" ? isUSStockSymbol(code) : /^\d{6}$/.test(code))
      || !name
      || name.length > 40
      || Number.isNaN(Date.parse(addedAt))
      || seen.has(stockStorageKey({ code, market }))
    ) continue;
    seen.add(stockStorageKey({ code, market }));
    stocks.push(market === "US" ? { code, name, market, currency, addedAt } : { code, name, addedAt });
    if (stocks.length >= maxWatchlistSize) break;
  }
  return stocks;
}

export function upsertWatchlistStock(current: WatchlistStock[], stock: WatchlistStock): WatchlistStock[] {
  const normalized = parseWatchlist([stock])[0];
  if (!normalized) return current;
  const key = stockStorageKey(normalized);
  return [normalized, ...current.filter((item) => stockStorageKey(item) !== key)].slice(0, maxWatchlistSize);
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
  const byCurrency: Record<StockCurrency, CurrencyPortfolioTotals> = {
    CNY: { costValue: 0, marketValue: 0, profit: 0, profitPct: 0, dayProfit: 0 },
    USD: { costValue: 0, marketValue: 0, profit: 0, profitPct: 0, dayProfit: 0 },
  };

  for (const stock of watchlist) {
    const key = stockStorageKey(stock);
    const holding = holdings[key];
    if (!holding) continue;
    positioned += 1;
    const quote = quotes[key];
    const currency = currencyOf(stock);
    const currencyTotals = byCurrency[currency];
    const metrics = calculateHoldingMetrics(holding.shares, holding.cost, quote?.price);
    if (metrics) {
      currencyTotals.costValue += metrics.costValue;
      currencyTotals.marketValue += metrics.marketValue;
      currencyTotals.profit += metrics.profit;
    }
    if (quote?.change != null && Number.isFinite(quote.change)) {
      currencyTotals.dayProfit += holding.shares * quote.change;
    }
  }

  for (const totals of Object.values(byCurrency)) {
    totals.profitPct = totals.costValue > 0 ? (totals.profit / totals.costValue) * 100 : 0;
  }
  costValue = byCurrency.CNY.costValue;
  marketValue = byCurrency.CNY.marketValue;
  profit = byCurrency.CNY.profit;
  dayProfit = byCurrency.CNY.dayProfit;

  return {
    tracked: watchlist.length,
    positioned,
    costValue,
    marketValue,
    profit,
    profitPct: costValue > 0 ? (profit / costValue) * 100 : 0,
    dayProfit,
    byCurrency,
  };
}
