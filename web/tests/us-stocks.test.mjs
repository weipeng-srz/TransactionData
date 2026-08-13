import test from "node:test";
import assert from "node:assert/strict";
import { parseMarketCsv } from "../app/lib/market.ts";
import { parseNewsCsv } from "../app/lib/news.ts";
import { exportHoldingsCsv, parseHoldings, parseHoldingsCsv } from "../app/lib/holdings.ts";
import { parseWatchlist } from "../app/lib/watchlist.ts";
import { parseStockRoute, stockStorageKey } from "../app/lib/security.ts";
import { parseUSDailyResponse, fetchUSMarketCsv, normalizeUSMarketRequest } from "../app/lib/usStockMarket.ts";
import { parseUSQuoteResponse } from "../app/lib/usStockRealtime.ts";
import { parseUSStockSuggestions } from "../app/lib/usStockLookup.ts";
import { buildUSFinancialPeriods } from "../app/lib/usStockFinancials.ts";

test("keeps US routes and storage keys separate from legacy A-share codes", () => {
  assert.deepEqual(parseStockRoute("US:aapl"), { code: "AAPL", market: "US", currency: "USD" });
  assert.deepEqual(parseStockRoute("000001"), { code: "000001", market: "CN", currency: "CNY" });
  assert.equal(stockStorageKey({ code: "AAPL", market: "US" }), "US:AAPL");
  assert.equal(stockStorageKey({ code: "000001" }), "000001");
  assert.throws(() => normalizeUSMarketRequest({ code: "000001", days: 180 }), /有效的美股代码/);
});

test("parses Sina US lookup, daily and quote payloads", () => {
  const suggestions = parseUSStockSuggestions('var trendsight="苹果,41,aapl,aapl,苹果,,苹果,99,1,ESG,,;微软,41,msft,msft,微软,,微软,99,1,ESG,,;";');
  assert.deepEqual(suggestions.map(({ code, name, market, currency }) => ({ code, name, market, currency })), [
    { code: "AAPL", name: "苹果", market: "US", currency: "USD" },
    { code: "MSFT", name: "微软", market: "US", currency: "USD" },
  ]);
  const rows = parseUSDailyResponse('var _AAPL=([{"d":"2026-08-11","o":"220","h":"225","l":"219","c":"224","v":"1000","a":"224000"}]);');
  assert.equal(rows[0].close, 224);
  const fields = ["苹果", "224", "1.5", "2026-08-12 16:00:00", "3.3", "221", "225", "219", "250", "170", "1000", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "", "", "220", "0", "0", "0", "224000"];
  const quote = parseUSQuoteResponse(`var hq_str_gb_aapl="${fields.join(",")}";`, "AAPL");
  assert.equal(quote.code, "AAPL");
  assert.equal(quote.price, 224);
  assert.deepEqual(quote.bids, []);
});

test("generates a US market CSV compatible with the existing chart parser", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("getDailyK")) return new Response('var _AAPL=([{"d":"2026-08-11","o":"220","h":"225","l":"219","c":"224","v":"1000","a":"224000"}]);');
    if (url.includes("suggest3")) return new Response(new TextEncoder().encode('var trendsight="Apple,41,aapl,aapl,Apple,,Apple,99,1,ESG,,;";'));
    throw new Error(`unexpected request ${url}`);
  };
  try {
    const csv = await fetchUSMarketCsv({ code: "AAPL", days: 20 });
    const parsed = parseMarketCsv(csv);
    assert.deepEqual(parsed.codes, ["AAPL"]);
    assert.equal(parsed.stockNames.AAPL, "Apple");
    assert.match(parsed.dataLevel, /日K聚合/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts US news, watchlist and holdings without changing legacy records", () => {
  const news = [
    "股票代码,股票名称,情绪倾向,新闻标题,原文链接",
    "AAPL,苹果,正面,Apple beats estimates,https://example.com/aapl",
  ].join("\n");
  assert.equal(parseNewsCsv(news).items[0].code, "AAPL");
  const watchlist = parseWatchlist([
    { code: "000001", name: "平安银行", addedAt: "2026-08-12T10:00:00.000Z" },
    { code: "aapl", name: "苹果", market: "US", currency: "USD", addedAt: "2026-08-12T11:00:00.000Z" },
  ]);
  assert.equal(watchlist[0].market, undefined);
  assert.equal(watchlist[1].code, "AAPL");
  const holdings = parseHoldings([
    { code: "000001", shares: 100, cost: 10, updatedAt: "2026-08-12T10:00:00.000Z" },
    { code: "AAPL", market: "US", currency: "USD", shares: 5, cost: 200, updatedAt: "2026-08-12T11:00:00.000Z" },
  ]);
  assert.ok(holdings["000001"]);
  assert.ok(holdings["US:AAPL"]);
  const csv = exportHoldingsCsv(holdings, watchlist);
  assert.match(csv, /市场,币种/);
  const imported = parseHoldingsCsv(csv, "2026-08-13T00:00:00.000Z");
  assert.equal(imported.holdings["US:AAPL"].currency, "USD");
});

test("converts SEC cumulative filings into isolated quarters and TTM values", () => {
  const usd = (values) => ({ units: { USD: values } });
  const revenue = [
    { start: "2025-01-01", end: "2025-03-31", val: 10, accn: "q1", fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01" },
    { start: "2025-01-01", end: "2025-06-30", val: 22, accn: "q2", fy: 2025, fp: "Q2", form: "10-Q", filed: "2025-08-01" },
    { start: "2025-01-01", end: "2025-09-30", val: 36, accn: "q3", fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01" },
    { start: "2025-01-01", end: "2025-12-31", val: 56, accn: "fy", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-01" },
    { start: "2026-01-01", end: "2026-03-31", val: 15, accn: "q1b", fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01" },
  ];
  const companyFacts = { facts: { "us-gaap": { RevenueFromContractWithCustomerExcludingAssessedTax: usd(revenue), NetIncomeLoss: usd(revenue.map((item) => ({ ...item, val: item.val / 10 }))) } } };
  const periods = buildUSFinancialPeriods(companyFacts);
  assert.equal(periods[0].periodLabel, "2026Q1");
  assert.equal(periods.find((item) => item.periodLabel === "2025Q2").single.revenue, 12);
  assert.equal(periods.find((item) => item.periodLabel === "2025Q4").single.revenue, 20);
  assert.equal(periods[0].ttm.revenue, 61);
});
