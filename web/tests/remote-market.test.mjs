import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/local-stock-data/route.ts";
import { aggregateCandles, parseMarketCsv } from "../app/lib/market.ts";
import { fetchRemoteMarketCsv } from "../app/lib/remoteMarket.ts";

const marketRequest = { code: "000001", days: 20, kind: "stock" };
const dailyRows = [
  { day: "2026-08-13", open: "20", high: "20", low: "20", close: "20", volume: "1000" },
  { day: "2026-08-14", open: "10", high: "10", low: "10", close: "10", volume: "2000" },
];

function mockMarketSources(t, factorResponse) {
  const requested = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("qfq.js")) return factorResponse();
    if (url.includes("getKLineData")) return new Response(`ticklens=(${JSON.stringify(dailyRows)});`);
    if (url.includes("suggest/get")) {
      return Response.json({ QuotationCodeTable: { Data: [{ Code: "000001", Name: "平安银行", Classify: "AStock", QuoteID: "0.000001" }] } });
    }
    if (url.includes("qt.gtimg.cn")) return new Response("");
    throw new Error(`Unexpected test request: ${url}`);
  });
  return requested;
}

test("rejects a stock export when adjustment factors cannot be fetched", async (t) => {
  mockMarketSources(t, () => { throw new Error("factor source unavailable"); });
  const response = await POST(new Request("http://localhost/api/local-stock-data", {
    method: "POST",
    body: JSON.stringify(marketRequest),
  }));

  assert.equal(response.status, 502);
  assert.match(response.headers.get("Content-Type"), /application\/json/);
  assert.match((await response.json()).error, /factor source unavailable/);
});

test("rejects malformed or incomplete factor feeds instead of assuming factor one", async (t) => {
  const invalidBodies = ["upstream HTML error", "var factor={};", 'var factor={"data":[{"d":"2026-08-13","f":0}]};', 'var factor={"data":[null]};'];
  for (const body of invalidBodies) {
    await t.test(body, async (t) => {
      mockMarketSources(t, () => new Response(body));
      await assert.rejects(fetchRemoteMarketCsv(marketRequest), /前复权因子/);
    });
  }
});

test("preserves valid adjustment factors through CSV parsing and daily candles", async (t) => {
  mockMarketSources(t, () => new Response('var factor={"data":[{"d":"2026-08-13","f":2},{"d":"2026-08-14","f":1}]};'));
  const dataset = parseMarketCsv(await fetchRemoteMarketCsv(marketRequest));
  const candles = aggregateCandles(dataset.rows, marketRequest.code, "1d");

  assert.equal(dataset.priceBasis, "前复权");
  assert.deepEqual(candles.map((candle) => candle.close), [10, 10]);
  assert.equal(candles[1].changePct, 0);
});

test("accepts an explicitly empty factor list and skips stock factors for indexes", async (t) => {
  const requested = mockMarketSources(t, () => new Response('var factor={"data":[]};'));
  const dataset = parseMarketCsv(await fetchRemoteMarketCsv(marketRequest));
  assert.deepEqual(aggregateCandles(dataset.rows, marketRequest.code, "1d").map((candle) => candle.close), [20, 10]);
  const factorCalls = requested.filter((url) => url.includes("qfq.js")).length;
  await fetchRemoteMarketCsv({ ...marketRequest, kind: "index" });
  assert.equal(requested.filter((url) => url.includes("qfq.js")).length, factorCalls);
});
