import assert from "node:assert/strict";
import test from "node:test";
import { fetchScreenerFeed } from "../app/lib/screenerData.ts";

test("US feed retains ordinary R/U/W tickers while excluding explicit warrants, rights and units", async (context) => {
  const securities = [
    ["AAPL", "Apple Inc"], ["UBER", "Uber Technologies Inc"], ["PLTR", "Palantir Technologies Inc"],
    ["MU", "Micron Technology Inc"], ["UNH", "UnitedHealth Group"], ["BMW", "Ordinary Company"],
    ["BRK.B", "Berkshire Hathaway Class B"], ["ABCW", "ABC Warrants"], ["XYZ", "XYZ Rights"],
    ["ABCU", "ABC Units"], ["ABC.WS", "ABC"],
  ];
  const quotes = securities.map(([symbol, name]) => ({
    symbol, name, cname: name, market: "NASDAQ", category: "Technology", price: 100, chg: 4,
    preclose: 96, open: 97, high: 101, low: 96, volume: 10_000_000, mktcap: 100_000_000_000,
  }));
  const rows = Array.from({ length: 90 }, (_, index) => ({
    d: new Date(Date.UTC(2026, 4, 1 + index)).toISOString().slice(0, 10),
    o: 98 + index * .02, h: 101 + index * .02, l: 97 + index * .02, c: 100 + index * .02, v: 1_000_000,
  }));
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    if (url.includes("US_CategoryService.getList")) return new Response(`var x=(${JSON.stringify({ count: quotes.length, data: quotes })})`);
    if (url.includes("US_MinKService.getDailyK")) return new Response(`var x=(${JSON.stringify(rows)})`);
    return new Response("mock unavailable", { status: 404 });
  });
  const feed = await fetchScreenerFeed("US");
  assert.deepEqual(feed.opportunities.map((stock) => stock.symbol).sort(), ["AAPL", "BMW", "BRK.B", "MU", "PLTR", "UBER", "UNH"]);
  assert.equal(feed.diagnostics.qualityCount, 7);
  assert.equal(feed.diagnostics.failedHistoryCount, 0);
});
