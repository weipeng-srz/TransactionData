import assert from "node:assert/strict";
import test from "node:test";
import { exportHoldingsCsv, parseHoldings, parseHoldingsCsv } from "../app/lib/holdings.ts";
import { buildPortfolioStocks, calculatePortfolioTotals, parseWatchlist } from "../app/lib/watchlist.ts";
import { buildPortfolioWorkbenchDigest } from "../app/lib/portfolioWorkbench.ts";

const updatedAt = "2026-10-08T00:00:00.000Z";

test("positions outside the watchlist remain visible, counted and exportable after reload", (context) => {
  context.mock.method(Date, "now", () => Date.parse(updatedAt));
  const holdings = parseHoldings(JSON.parse(JSON.stringify([
    { code: "000001", name: "平安银行", shares: 1000, cost: 10, updatedAt },
    { code: "MU", name: "Micron", market: "US", currency: "USD", shares: 10, cost: 100, updatedAt },
  ])));
  const stocks = buildPortfolioStocks([], holdings);
  assert.deepEqual(stocks.map((stock) => stock.name), ["平安银行", "Micron"]);
  const quotes = {
    "000001": { status: "ready", price: 12, change: 1, date: "2026-10-08", time: "15:00:00", score: null, prediction: null },
    "US:MU": { status: "ready", price: 110, change: 2, date: "2026-10-08", time: "16:00:00", score: null, prediction: null },
  };
  const totals = calculatePortfolioTotals([], holdings, quotes);
  assert.equal(totals.positioned, 2);
  assert.equal(totals.byCurrency.CNY.marketValue, 12000);
  assert.equal(totals.byCurrency.USD.marketValue, 1100);
  const digest = buildPortfolioWorkbenchDigest(stocks, holdings, quotes);
  assert.equal(digest.holdings.length, 2);
  assert.equal(digest.quoteCoverage.tracked, 2);
  const restored = parseHoldingsCsv(exportHoldingsCsv(holdings, []), updatedAt);
  assert.deepEqual(restored.holdings, holdings);
});

test("removing a watched security preserves its holding and does not double count overlaps", () => {
  const holdings = parseHoldings([{ code: "000001", name: "平安银行", shares: 100, cost: 10, updatedAt }]);
  const watched = [{ code: "000001", name: "平安银行", addedAt: updatedAt }];
  assert.equal(buildPortfolioStocks(watched, holdings).length, 1);
  assert.equal(buildPortfolioStocks([], holdings).length, 1);
  assert.equal(calculatePortfolioTotals(watched, holdings, { "000001": { price: 11 } }).marketValue, 1100);
});

test("legacy holdings without a name still round trip through CSV", () => {
  const holdings = parseHoldings([{ code: "000001", shares: 100, cost: 10, updatedAt }]);
  const imported = parseHoldingsCsv(exportHoldingsCsv(holdings, []), updatedAt);
  assert.equal(imported.stocks[0].name, "000001");
  assert.equal(imported.holdings["000001"].shares, 100);
});

test("a full watchlist cannot truncate independently stored holdings", () => {
  const watched = parseWatchlist(Array.from({ length: 50 }, (_, index) => ({
    code: String(600000 + index), name: `股票${index}`, addedAt: updatedAt,
  })));
  const holdings = parseHoldings(Array.from({ length: 100 }, (_, index) => ({
    code: String(300000 + index), name: `持仓${index}`, shares: 100, cost: 10, updatedAt,
  })));
  assert.equal(buildPortfolioStocks(watched, holdings).length, 150);
  assert.equal(calculatePortfolioTotals(watched, holdings, {}).positioned, 100);
});
