import { parseHoldings, type StockHoldings } from "./holdings.ts";
import { parseWatchlist, type WatchlistStock } from "./watchlist.ts";

export const personalPortfolioImportKey = "ticklens.personal-portfolio.2026-08-10.v1";

const importedAt = "2026-08-10T00:00:00.000+08:00";

export const personalPortfolioStocks = parseWatchlist([
  { code: "603629", name: "利通电子", addedAt: importedAt },
  { code: "002185", name: "华天科技", addedAt: importedAt },
  { code: "002080", name: "中材科技", addedAt: importedAt },
  { code: "002156", name: "通富微电", addedAt: importedAt },
  { code: "600487", name: "亨通光电", addedAt: importedAt },
  { code: "000066", name: "中国长城", addedAt: importedAt },
  { code: "002747", name: "埃斯顿", addedAt: importedAt },
]);

export const personalPortfolioHoldings = parseHoldings([
  { code: "603629", shares: 600, cost: 77.928, updatedAt: importedAt },
  { code: "002185", shares: 2900, cost: 16.236, updatedAt: importedAt },
  { code: "002080", shares: 800, cost: 51.593, updatedAt: importedAt },
  { code: "002156", shares: 400, cost: 58.711, updatedAt: importedAt },
  { code: "600487", shares: 400, cost: 60.395, updatedAt: importedAt },
  { code: "000066", shares: 800, cost: 53.903, updatedAt: importedAt },
  { code: "002747", shares: 6900, cost: 54.11, updatedAt: importedAt },
]);

export function mergePersonalPortfolio(
  watchlist: WatchlistStock[],
  holdings: StockHoldings,
): { watchlist: WatchlistStock[]; holdings: StockHoldings } {
  return {
    watchlist: parseWatchlist([...watchlist, ...personalPortfolioStocks]),
    holdings: parseHoldings([
      ...Object.values(holdings),
      ...Object.values(personalPortfolioHoldings),
    ]),
  };
}
