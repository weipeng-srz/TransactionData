import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchRealtimeSnapshot,
  normalizeRealtimeRequest,
  parseEastmoneyMinuteResponse,
  parseMinuteKlineResponse,
  parseQuoteResponse,
  parseTencentQuoteResponse,
} from "../app/lib/realtimeMarket.ts";
import { analyzeRealtimeSignals } from "../app/lib/realtimeSignals.ts";

test("normalizes supported realtime stock codes", () => {
  assert.deepEqual(normalizeRealtimeRequest({ code: " sz000001 " }), { code: "000001" });
  assert.deepEqual(normalizeRealtimeRequest({ code: "600000.SH" }), { code: "600000" });
  assert.throws(() => normalizeRealtimeRequest({ code: "PingAn" }), /6 位/);
});

test("parses realtime quote and five-level order book", () => {
  const quote = 'var hq_str_sz000001="平安银行,10.990,10.980,10.870,11.130,10.860,10.860,10.870,124327163,1369501332.140,771500,10.860,775800,10.850,249500,10.840,188500,10.830,277300,10.820,57700,10.870,179000,10.880,183900,10.890,105500,10.900,40500,10.910,2026-07-21,11:30:00,00";';
  const snapshot = parseQuoteResponse(quote);

  assert.equal(snapshot.name, "平安银行");
  assert.equal(snapshot.price, 10.87);
  assert.equal(snapshot.date, "2026-07-21");
  assert.equal(snapshot.time, "11:30:00");
  assert.deepEqual(snapshot.bids[0], { level: 1, volume: 771500, price: 10.86 });
  assert.deepEqual(snapshot.asks[0], { level: 1, volume: 57700, price: 10.87 });
  assert.equal(snapshot.bids.length, 5);
  assert.equal(snapshot.asks.length, 5);
});

test("parses JSONP minute candles and rejects malformed payloads", () => {
  const jsonp = 'ticklens=([{"day":"2026-07-21 09:31:00","open":"10.990","high":"11.010","low":"10.980","close":"11.000","volume":"100000","amount":"1100000"},{"day":"2026-07-21 09:32:00","open":"11.000","high":"11.020","low":"10.990","close":"11.010","volume":"120000","amount":"1321200"}]);';
  const candles = parseMinuteKlineResponse(jsonp);

  assert.equal(candles.length, 2);
  assert.deepEqual(candles[0], {
    time: "2026-07-21 09:31:00",
    open: 10.99,
    high: 11.01,
    low: 10.98,
    close: 11,
    volume: 100000,
    amount: 1100000,
  });
  assert.throws(() => parseMinuteKlineResponse("not jsonp"), /异常内容/);
});

test("parses Tencent quote and Eastmoney minute fallback payloads", () => {
  const fields = Array(40).fill("");
  Object.assign(fields, {
    1: "浦发银行",
    2: "600000",
    3: "9.28",
    4: "9.19",
    5: "9.19",
    6: "1109627",
    9: "9.28",
    10: "1854",
    19: "9.29",
    20: "921",
    30: "20260729161433",
    33: "9.35",
    34: "9.17",
    35: "9.28/1109627/1031569486",
  });
  const quote = parseTencentQuoteResponse(`v_sh600000="${fields.join("~")}";`);
  const candles = parseEastmoneyMinuteResponse(JSON.stringify({
    data: {
      klines: [
        "2026-07-29 09:31,9.19,9.24,9.25,9.17,18810,17340147.00,0.87,0.54,0.05,0.01",
      ],
    },
  }));

  assert.equal(quote.name, "浦发银行");
  assert.equal(quote.price, 9.28);
  assert.equal(quote.date, "2026-07-29");
  assert.equal(quote.time, "16:14:33");
  assert.equal(quote.volume, 110962700);
  assert.equal(quote.amount, 1031569486);
  assert.deepEqual(quote.bids[0], { level: 1, price: 9.28, volume: 185400 });
  assert.deepEqual(quote.asks[0], { level: 1, price: 9.29, volume: 92100 });
  assert.deepEqual(candles[0], {
    time: "2026-07-29 09:31:00",
    open: 9.19,
    high: 9.25,
    low: 9.17,
    close: 9.24,
    volume: 1881000,
    amount: 17340147,
  });
});

test("keeps Tencent STAR Market quote volume in shares while order-book sizes remain lots", () => {
  const fields = Array(80).fill("");
  Object.assign(fields, {
    1: "寒武纪",
    2: "688256",
    3: "1050.49",
    4: "1162.50",
    5: "1130.56",
    6: "15746396",
    9: "1050.00",
    10: "14",
    19: "1050.49",
    20: "4",
    30: "20260819153458",
    33: "1138.00",
    34: "1038.39",
    35: "1050.49/15746396/17003021919",
    38: "2.51",
    72: "628292969",
  });

  const quote = parseTencentQuoteResponse(`v_sh688256="${fields.join("~")}";`);

  assert.equal(quote.volume, 15_746_396);
  assert.deepEqual(quote.bids[0], { level: 1, price: 1050, volume: 1_400 });
  assert.deepEqual(quote.asks[0], { level: 1, price: 1050.49, volume: 400 });
});

test("falls back after Sina returns 403 and coalesces concurrent refreshes", async () => {
  const originalFetch = globalThis.fetch;
  const fields = Array(40).fill("");
  Object.assign(fields, {
    1: "PFBank",
    2: "600000",
    3: "9.28",
    4: "9.19",
    5: "9.19",
    6: "1109627",
    9: "9.28",
    10: "1854",
    19: "9.29",
    20: "921",
    30: "20260729143000",
    33: "9.35",
    34: "9.17",
    35: "9.28/1109627/1031569486",
  });
  let requestCount = 0;
  globalThis.fetch = async (input) => {
    requestCount += 1;
    const url = String(input);
    if (url.includes("sina.")) return new Response("", { status: 403 });
    if (url.includes("qt.gtimg.cn")) return new Response(`v_sh600000="${fields.join("~")}";`);
    if (url.includes("push2his.eastmoney.com")) {
      return Response.json({ data: { klines: ["2026-07-29 14:30,9.27,9.28,9.29,9.27,100,92800.00"] } });
    }
    return new Response("", { status: 500 });
  };

  try {
    const [first, second] = await Promise.all([
      fetchRealtimeSnapshot("600000"),
      fetchRealtimeSnapshot("600000"),
    ]);
    assert.equal(first.price, 9.28);
    assert.equal(first.minuteCandles.length, 1);
    assert.match(first.source, /自动降级/);
    assert.deepEqual(second, first);
    assert.equal(requestCount, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("builds realtime B/S guide points and marks the forming candle", () => {
  const candles = Array.from({ length: 112 }, (_, index) => {
    const open = 10 + Math.max(0, index - 1) * 0.01;
    const close = 10 + index * 0.01;
    const volume = 100000 + (index % 7) * 20000;
    return {
      time: `10:${String(index % 60).padStart(2, "0")}`,
      open,
      high: close + 0.03,
      low: open - 0.03,
      close,
      volume,
      amount: close * volume,
    };
  });
  const analysis = analyzeRealtimeSignals(candles, "2026-07-21");

  assert.ok(analysis.signalCount > 0);
  assert.equal(analysis.guidePoints.length, candles.length);
  assert.equal(analysis.latestSignal?.guide.type, "sell");
  assert.equal(analysis.latestSignal?.guide.provisional, true);
  assert.match(analysis.latestSignal?.guide.reasons.join(" ") ?? "", /九转/);
});
