import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/local-stock-trades/route.ts";
import { fetchDailyTradesCsv } from "../app/lib/dailyTrades.ts";

const tradeRequest = { code: "000001", date: "2026-08-17", name: "平安银行", previousClose: 11.11 };
const matchingTimeline = 'v_detail_time_sz000001=[20260817,"09:25:00~09:33:24"]';
const primaryTrades = { rc: 0, data: { code: "000001", prePrice: 11.11, details: ["09:30:03,11.19,10,1,1"] } };

test("checks the dated timeline before exporting the primary latest-day feed", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.searchParams.get("action") === "timeline") return new Response(matchingTimeline);
    if (url.hostname === "push2.eastmoney.com") return Response.json(primaryTrades);
    throw new Error(`Unexpected test request: ${url}`);
  });

  const csv = await fetchDailyTradesCsv(tradeRequest);
  assert.equal(calls[0].searchParams.get("action"), "timeline");
  assert.equal(calls[1].hostname, "push2.eastmoney.com");
  assert.equal(calls.length, 2);
  assert.match(csv, /2026-08-17,09:30:03,1,000001,平安银行,11\.190/);
});

test("rejects a stale snapshot date without requesting or exporting primary trades", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.searchParams.get("action") === "timeline") return new Response(matchingTimeline);
    throw new Error("The primary latest-day feed must not be queried");
  });
  const response = await POST(new Request("http://localhost/api/local-stock-trades", {
    method: "POST",
    body: JSON.stringify({ ...tradeRequest, date: "2026-08-14" }),
  }));

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("Content-Disposition"), null);
  assert.match((await response.json()).error, /成交明细日期为 2026-08-17/);
  assert.equal(calls.length, 1);
});

test("refuses an export when the trading date cannot be confirmed", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input) => {
    calls += 1;
    assert.equal(new URL(input).searchParams.get("action"), "timeline");
    return new Response("temporarily unavailable", { status: 503 });
  });

  await assert.rejects(fetchDailyTradesCsv(tradeRequest), /腾讯成交时间线请求失败/);
  assert.equal(calls, 1);
});

test("reuses the confirmed timeline for the fallback without repeating the lookup", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.searchParams.get("action") === "timeline") return new Response(matchingTimeline);
    if (url.hostname === "push2.eastmoney.com") return new Response("unavailable", { status: 503 });
    if (url.searchParams.get("action") === "data") return new Response('v_detail_data_sz000001=[0,"0/09:25:00/11.20/0.09/10/11200/B"]');
    throw new Error(`Unexpected test request: ${url}`);
  });

  const csv = await fetchDailyTradesCsv(tradeRequest);
  assert.match(csv, /2026-08-17,09:25:00,1,000001,平安银行,11\.200/);
  assert.match(csv, /腾讯公开Level-1成交明细/);
  assert.equal(calls.filter((url) => url.searchParams.get("action") === "timeline").length, 1);
  assert.equal(calls.length, 3);
});
