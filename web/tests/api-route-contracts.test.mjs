import assert from "node:assert/strict";
import test from "node:test";

import * as globalIndexesRoute from "../app/api/global-indexes/route.ts";
import * as localStockDataRoute from "../app/api/local-stock-data/route.ts";
import * as localStockNewsRoute from "../app/api/local-stock-news/route.ts";
import * as localStockTradesRoute from "../app/api/local-stock-trades/route.ts";
import * as realtimeMarketRoute from "../app/api/realtime-market/route.ts";
import * as telemetryRoute from "../app/api/telemetry/route.ts";
import * as usStockDataRoute from "../app/api/us-stock-data/route.ts";
import * as usStockFinancialsRoute from "../app/api/us-stock-financials/route.ts";
import * as usStockLookupRoute from "../app/api/us-stock-lookup/route.ts";
import * as usStockNewsRoute from "../app/api/us-stock-news/route.ts";
import * as usStockRealtimeRoute from "../app/api/us-stock-realtime/route.ts";
import { GLOBAL_INDEXES } from "../app/lib/globalIndexes.ts";
import { US_INDEXES } from "../app/lib/usMarketIndexes.ts";

const offlineFetch = async () => { throw new TypeError("fixture network offline"); };

function post(path, body) {
  return new Request(`http://localhost/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function encodedBodyOver(limit) {
  const characterCount = Math.floor(limit / 3) + 1;
  const body = JSON.stringify("界".repeat(characterCount));
  assert.ok(body.length < limit, "fixture must stay below the JavaScript character limit");
  assert.ok(new TextEncoder().encode(body).byteLength > limit, "fixture must exceed the UTF-8 byte limit");
  return body;
}

async function withFetch(mock, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function assertJson(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("Content-Type") ?? "", /^application\/json\b/i);
  return response.json();
}

async function assertClientError(response) {
  const payload = await assertJson(response, 400);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(typeof payload.error, "string");
  assert.ok(payload.error.length > 0);
  return payload;
}

async function assertUpstreamError(response) {
  const payload = await assertJson(response, 502);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(typeof payload.error, "string");
  assert.ok(payload.error.length > 0);
  return payload;
}

async function assertPostOnly(route) {
  const response = await route.GET();
  assert.deepEqual(await assertJson(response, 405), { error: "仅支持 POST 请求" });
  assert.equal(response.headers.get("Allow"), "POST");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
}

async function assertInputGuards(route, path, limit) {
  await assertClientError(await route.POST(post(path, "{")));
  const oversized = await route.POST(post(path, encodedBodyOver(limit)));
  const payload = await assertClientError(oversized);
  assert.match(payload.error, /请求内容过大/);
}

function globalQuoteFixture() {
  const globalLines = GLOBAL_INDEXES.slice(0, 10).map((item, index) => (
    `var hq_str_${item.symbol}="${item.name},${1000 + index},${index + 1},0.${index + 1},,,2026-08-18,12:00:00";`
  ));
  const usLines = US_INDEXES.slice(0, 3).map((item, index) => {
    const fields = Array(27).fill("");
    Object.assign(fields, {
      0: item.name,
      1: String(5000 + index),
      2: "0.5",
      3: "2026-08-18 16:00:00",
      4: "25",
      25: "Aug 18 04:00PM EDT",
      26: String(4975 + index),
    });
    return `var hq_str_${item.cashSymbol}="${fields.join(",")}";`;
  });
  return [...globalLines, ...usLines].join("\n");
}

function cnQuoteFixture() {
  return 'var hq_str_sz000001="平安银行,10.990,10.980,10.870,11.130,10.860,10.860,10.870,124327163,1369501332.140,771500,10.860,775800,10.850,249500,10.840,188500,10.830,277300,10.820,57700,10.870,179000,10.880,183900,10.890,105500,10.900,40500,10.910,2026-08-18,11:30:00,00";';
}

function usQuoteFixture() {
  const fields = Array(31).fill("");
  Object.assign(fields, {
    0: "Apple Inc.",
    1: "224",
    2: "1.5",
    3: "2026-08-18 16:00:00",
    4: "3.3",
    5: "221",
    6: "225",
    7: "219",
    10: "1000",
    26: "220.7",
  });
  return `var hq_str_gb_aapl="${fields.join(",")}";`;
}

test("global indexes route exposes a no-store JSON feed and maps quote outages to 502", async () => {
  const response = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "hq.sinajs.cn") return new Response(globalQuoteFixture());
    return new Response("upstream unavailable", { status: 503 });
  }, () => globalIndexesRoute.GET());

  const payload = await assertJson(response, 200);
  assert.ok(payload.quotes.length >= 10);
  assert.ok(payload.usQuotes.length >= 3);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-TickLens-Source"), "sina-global-indexes-https");

  await withFetch(offlineFetch, async () => {
    const failed = await globalIndexesRoute.GET();
    const error = await assertUpstreamError(failed);
    assert.match(error.error, /全球行情/);
  });
});

test("local stock data route enforces input bounds and returns cacheable CSV", async () => {
  await assertPostOnly(localStockDataRoute);
  await assertInputGuards(localStockDataRoute, "local-stock-data", 4096);

  const response = await withFetch(async (input) => {
    const url = String(input);
    if (url.includes("CN_MarketDataService.getKLineData")) {
      return new Response('ticklens=([{"day":"2026-08-18","open":"10","high":"11","low":"9.5","close":"10.5","volume":"10000"}]);');
    }
    return new Response("unavailable", { status: 503 });
  }, () => localStockDataRoute.POST(post("local-stock-data", JSON.stringify({ code: "000001", days: 20 }))));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.match(response.headers.get("Cache-Control") ?? "", /^public, max-age=60/);
  assert.equal(response.headers.get("X-TickLens-Source"), "sina-https-kline");
  assert.match(await response.text(), /交易日期/);

  await withFetch(offlineFetch, async () => {
    await assertUpstreamError(await localStockDataRoute.POST(post("local-stock-data", JSON.stringify({ code: "000001", days: 20 }))));
  });
});

test("local stock news route enforces limits and separates upstream failures from bad requests", async () => {
  await assertPostOnly(localStockNewsRoute);
  await assertInputGuards(localStockNewsRoute, "local-stock-news", 4096);

  const response = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "search.sina.com.cn") {
      return Response.json({ data: { list: [{
        title: "000001 发布业绩公告",
        searchSummary: "000001 业绩增长",
        url: "https://example.com/cn-news",
        ctime: 1_776_000_000,
        media_show: "测试媒体",
      }] } });
    }
    return new Response("unavailable", { status: 503 });
  }, () => localStockNewsRoute.POST(post("local-stock-news", JSON.stringify({ code: "000001", limit: 10 }))));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.match(response.headers.get("Cache-Control") ?? "", /^public, max-age=60/);
  assert.equal(response.headers.get("X-TickLens-Source"), "sina-news-search");
  assert.match(await response.text(), /新闻标题/);

  await withFetch(offlineFetch, async () => {
    await assertUpstreamError(await localStockNewsRoute.POST(post("local-stock-news", JSON.stringify({ code: "000001", limit: 10 }))));
  });
});

test("local stock trades route returns a download contract and keeps provider failures as 502", async () => {
  await assertPostOnly(localStockTradesRoute);
  await assertInputGuards(localStockTradesRoute, "local-stock-trades", 2048);
  const requestBody = JSON.stringify({ code: "000001", date: "2026-08-18", name: "平安银行", previousClose: 11.1 });

  const response = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "push2.eastmoney.com") {
      return Response.json({ rc: 0, data: { code: "000001", prePrice: 11.1, details: ["09:30:03,11.20,10,2,2"] } });
    }
    return new Response("unavailable", { status: 503 });
  }, () => localStockTradesRoute.POST(post("local-stock-trades", requestBody)));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="000001-2026-08-18-level1-trades.csv"');
  assert.equal(response.headers.get("X-TrendSight-Source"), "level1-trades-auto-fallback");
  assert.match(await response.text(), /公开Level-1成交明细/);

  await withFetch(async () => new Response("unavailable", { status: 503 }), async () => {
    await assertUpstreamError(await localStockTradesRoute.POST(post("local-stock-trades", requestBody)));
  });
});

test("realtime market route returns no-store JSON and maps exhausted fallbacks to 502", async () => {
  await assertPostOnly(realtimeMarketRoute);
  await assertInputGuards(realtimeMarketRoute, "realtime-market", 2048);
  const requestBody = JSON.stringify({ code: "000001" });

  const response = await withFetch(async (input) => {
    const url = String(input);
    if (url.includes("CN_MarketDataService.getKLineData")) {
      return new Response('ticklens=([{"day":"2026-08-18 09:31:00","open":"10.99","high":"11.01","low":"10.98","close":"11.00","volume":"1000","amount":"11000"}]);');
    }
    if (url.includes("hq.sinajs.cn")) return new Response(cnQuoteFixture());
    throw new Error(`unexpected fixture request: ${url}`);
  }, () => realtimeMarketRoute.POST(post("realtime-market", requestBody)));

  const payload = await assertJson(response, 200);
  assert.equal(payload.code, "000001");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-TickLens-Source"), "realtime-market-auto-fallback");

  await withFetch(async () => new Response("unavailable", { status: 503 }), async () => {
    await assertUpstreamError(await realtimeMarketRoute.POST(post("realtime-market", requestBody)));
  });
});

test("telemetry route remains fire-and-forget for valid, invalid, oversized, and unavailable-storage events", async () => {
  for (const body of [
    JSON.stringify({ event: "app_loaded", durationMs: 42 }),
    JSON.stringify({ event: "not-allowed" }),
    "{",
    "x".repeat(2049),
  ]) {
    const response = await telemetryRoute.POST(post("telemetry", body));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Content-Type"), null);
    assert.equal(await response.text(), "");
  }
});

test("US stock data route enforces byte limits and returns cacheable CSV", async () => {
  await assertPostOnly(usStockDataRoute);
  await assertInputGuards(usStockDataRoute, "us-stock-data", 4096);
  const requestBody = JSON.stringify({ code: "AAPL", days: 20 });

  const response = await withFetch(async (input) => {
    const url = String(input);
    if (url.includes("US_MinKService.getDailyK")) {
      return new Response('var _AAPL=([{"d":"2026-08-18","o":"220","h":"225","l":"219","c":"224","v":"1000","a":"224000"}]);');
    }
    return new Response("unavailable", { status: 503 });
  }, () => usStockDataRoute.POST(post("us-stock-data", requestBody)));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.match(response.headers.get("Cache-Control") ?? "", /^public, max-age=60/);
  assert.equal(response.headers.get("X-TrendSight-Source"), "sina-us-daily");
  assert.match(await response.text(), /AAPL/);

  await withFetch(offlineFetch, async () => {
    await assertUpstreamError(await usStockDataRoute.POST(post("us-stock-data", requestBody)));
  });
});

test("US financials route distinguishes invalid input from SEC service failure", async () => {
  await assertPostOnly(usStockFinancialsRoute);
  await assertInputGuards(usStockFinancialsRoute, "us-stock-financials", 4096);
  const requestBody = JSON.stringify({ code: "AAPL" });
  const secFacts = {
    entityName: "Apple Inc.",
    sicDescription: "Electronic Computers",
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: { USD: [{ start: "2026-01-01", end: "2026-03-31", val: 100, accn: "q1", fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01" }] },
        },
        NetIncomeLoss: {
          units: { USD: [{ start: "2026-01-01", end: "2026-03-31", val: 20, accn: "q1", fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01" }] },
        },
      },
    },
  };

  const response = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "www.sec.gov") return Response.json({ 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } });
    if (url.hostname === "data.sec.gov") return Response.json(secFacts);
    return new Response("unavailable", { status: 503 });
  }, () => usStockFinancialsRoute.POST(post("us-stock-financials", requestBody)));

  const payload = await assertJson(response, 200);
  assert.equal(payload.code, "AAPL");
  assert.equal(payload.reports[0].periodLabel, "2026Q1");
  assert.match(response.headers.get("Cache-Control") ?? "", /^public, max-age=300/);
  assert.equal(response.headers.get("X-TrendSight-Source"), "sec-company-facts");

  await withFetch(async () => new Response("unavailable", { status: 503 }), async () => {
    await assertUpstreamError(await usStockFinancialsRoute.POST(post("us-stock-financials", requestBody)));
  });
});

test("US stock lookup route provides no-store JSON, 404 for no match, and 502 for provider failure", async () => {
  await assertPostOnly(usStockLookupRoute);
  await assertInputGuards(usStockLookupRoute, "us-stock-lookup", 4096);

  const response = await withFetch(async () => new Response('var trendsight="Apple,41,aapl,aapl,Apple Inc.,,Apple,99,1,ESG,,;";'), () => (
    usStockLookupRoute.POST(post("us-stock-lookup", JSON.stringify({ query: "AAPL" })))
  ));
  assert.deepEqual(await assertJson(response, 200), { code: "AAPL", name: "Apple Inc.", market: "US", currency: "USD" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  const notFound = await withFetch(async () => new Response('var trendsight="";'), () => (
    usStockLookupRoute.POST(post("us-stock-lookup", JSON.stringify({ query: "not a public company" })))
  ));
  assert.equal(notFound.status, 404);
  assert.equal(notFound.headers.get("Cache-Control"), "no-store");

  await withFetch(offlineFetch, async () => {
    await assertUpstreamError(await usStockLookupRoute.POST(post("us-stock-lookup", JSON.stringify({ query: "AAPL" }))));
  });
});

test("US stock news route returns cacheable CSV and maps search outages to 502", async () => {
  await assertPostOnly(usStockNewsRoute);
  await assertInputGuards(usStockNewsRoute, "us-stock-news", 4096);
  const requestBody = JSON.stringify({ code: "AAPL", limit: 10 });

  const response = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "suggest3.sinajs.cn") return new Response('var trendsight="Apple,41,aapl,aapl,Apple Inc.,,Apple,99,1,ESG,,;";');
    if (url.hostname === "search.sina.com.cn") {
      return Response.json({ data: { list: [{
        title: "AAPL shares rise after earnings beat",
        searchSummary: "Apple revenue growth beats estimates",
        url: "https://example.com/aapl-news",
        ctime: 1_776_000_000,
        media_show: "Test Wire",
      }] } });
    }
    throw new Error(`unexpected fixture request: ${url}`);
  }, () => usStockNewsRoute.POST(post("us-stock-news", requestBody)));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.match(response.headers.get("Cache-Control") ?? "", /^public, max-age=60/);
  assert.equal(response.headers.get("X-TrendSight-Market"), "US");
  assert.match(await response.text(), /AAPL shares rise/);

  await withFetch(offlineFetch, async () => {
    await assertUpstreamError(await usStockNewsRoute.POST(post("us-stock-news", requestBody)));
  });
});

test("US realtime route returns no-store JSON and maps quote plus daily fallback failure to 502", async () => {
  await assertPostOnly(usStockRealtimeRoute);
  await assertInputGuards(usStockRealtimeRoute, "us-stock-realtime", 4096);
  const requestBody = JSON.stringify({ code: "AAPL" });

  const response = await withFetch(async (input) => {
    const url = String(input);
    if (url.includes("hq.sinajs.cn/list=gb_aapl")) return new Response(usQuoteFixture());
    throw new Error(`unexpected fixture request: ${url}`);
  }, () => usStockRealtimeRoute.POST(post("us-stock-realtime", requestBody)));

  const payload = await assertJson(response, 200);
  assert.equal(payload.code, "AAPL");
  assert.equal(payload.price, 224);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-TrendSight-Market"), "US");

  await withFetch(async () => new Response("unavailable", { status: 503 }), async () => {
    await assertUpstreamError(await usStockRealtimeRoute.POST(post("us-stock-realtime", requestBody)));
  });
});
