import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePortfolioTotals,
  parseWatchlist,
  upsertWatchlistStock,
} from "../app/lib/watchlist.ts";

test("parseWatchlist keeps unique valid A-share entries", () => {
  const stocks = parseWatchlist([
    { code: "000001", name: "平安银行", addedAt: "2026-08-10T01:00:00.000Z" },
    { code: "000001", name: "重复项", addedAt: "2026-08-10T02:00:00.000Z" },
    { code: "invalid", name: "无效项", addedAt: "2026-08-10T03:00:00.000Z" },
  ]);
  assert.deepEqual(stocks, [
    { code: "000001", name: "平安银行", addedAt: "2026-08-10T01:00:00.000Z" },
  ]);
});

test("upsertWatchlistStock moves an existing stock to the top", () => {
  const current = parseWatchlist([
    { code: "000001", name: "平安银行", addedAt: "2026-08-10T01:00:00.000Z" },
    { code: "600519", name: "贵州茅台", addedAt: "2026-08-10T01:01:00.000Z" },
  ]);
  const next = upsertWatchlistStock(current, {
    code: "600519",
    name: "贵州茅台",
    addedAt: "2026-08-10T02:00:00.000Z",
  });
  assert.deepEqual(next.map((stock) => stock.code), ["600519", "000001"]);
});

test("calculatePortfolioTotals aggregates holdings, return and daily profit", () => {
  const watchlist = parseWatchlist([
    { code: "000001", name: "平安银行", addedAt: "2026-08-10T01:00:00.000Z" },
    { code: "600519", name: "贵州茅台", addedAt: "2026-08-10T01:01:00.000Z" },
  ]);
  const holdings = {
    "000001": { code: "000001", shares: 1000, cost: 10, updatedAt: "2026-08-10T01:00:00.000Z" },
    "600519": { code: "600519", shares: 100, cost: 1400, updatedAt: "2026-08-10T01:00:00.000Z" },
  };
  const totals = calculatePortfolioTotals(watchlist, holdings, {
    "000001": { price: 11, change: 0.2 },
    "600519": { price: 1450, change: -5 },
  });
  assert.equal(totals.tracked, 2);
  assert.equal(totals.positioned, 2);
  assert.equal(totals.costValue, 150_000);
  assert.equal(totals.marketValue, 156_000);
  assert.equal(totals.profit, 6_000);
  assert.equal(totals.profitPct, 4);
  assert.equal(totals.dayProfit, -300);
});
