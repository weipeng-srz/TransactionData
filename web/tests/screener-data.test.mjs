import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeScreenerMarket,
  parseCNDailyResponse,
  parseCNListResponse,
  parseUSListResponse,
  scoreScreenerOpportunity,
} from "../app/lib/screenerData.ts";

test("screener normalizes markets and parses Sina A-share quotes", () => {
  assert.equal(normalizeScreenerMarket("us"), "US");
  assert.equal(normalizeScreenerMarket("unknown"), "CN");
  const [quote] = parseCNListResponse(JSON.stringify([{
    symbol: "sh600000", code: "600000", name: "浦发银行", trade: "12.30", changepercent: "1.25",
    settlement: "12.15", open: "12.18", high: "12.40", low: "12.10", volume: "1000000",
    amount: "12300000", mktcap: "1000000", nmc: "800000", turnoverratio: "1.8", ticktime: "15:00:00",
  }]));
  assert.equal(quote.code, "600000");
  assert.equal(quote.price, 12.3);
  assert.equal(quote.marketCap, 10_000_000_000);
});

test("screener parses Sina US JSONP and applies raw quote fields", () => {
  const response = parseUSListResponse(`/*guard*/\nvar trendsight=({"count":"18012","data":[{"symbol":"NVDA","cname":"NVIDIA","market":"NASDAQ","category":"Semiconductors","price":"180","chg":"2.5","preclose":"175.61","open":"177","high":"182","low":"176","volume":"1000000","mktcap":"4400000000000"}]})`);
  assert.equal(response.count, 18012);
  assert.equal(response.quotes[0].symbol, "NVDA");
  assert.equal(response.quotes[0].amount, 180_000_000);
});

test("screener scoring is derived from daily prices and exposes transparent factors", () => {
  const rows = parseCNDailyResponse(JSON.stringify(Array.from({ length: 30 }, (_, index) => ({
    day: `2026-07-${String(index + 1).padStart(2, "0")}`,
    open: 10 + index * .1,
    high: 10.3 + index * .1,
    low: 9.9 + index * .1,
    close: 10.2 + index * .1,
    volume: 1_000_000 + index * 20_000,
  }))));
  const opportunity = scoreScreenerOpportunity({
    market: "CN", symbol: "600000", name: "测试股份", exchange: "沪市", price: 13.3, change: 3.1,
    previousClose: 12.9, open: 13, high: 13.4, low: 12.95, volume: 2_000_000, amount: 26_600_000,
    marketCap: 10_000_000_000, turnover: 3.2, sector: "测试板块", themes: ["测试板块"], streak: 0,
    wasYesterdayLimit: false, isCurrentLimit: false,
  }, rows);
  assert.ok(opportunity.score >= 0 && opportunity.score <= 100);
  assert.ok(opportunity.risk >= 0 && opportunity.risk <= 100);
  assert.ok(opportunity.confidence >= 35 && opportunity.confidence <= 82);
  assert.deepEqual(opportunity.factorScores.map((item) => item.label), ["强度", "趋势", "量价", "动量"]);
  assert.match(opportunity.plan.stop, /^¥/);
});
