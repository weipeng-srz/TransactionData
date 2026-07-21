import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRealtimePriceRequest,
  normalizeRealtimeRequest,
  parseMinuteKlineResponse,
  parseQuoteBatchResponse,
  parseQuoteResponse,
} from "../app/lib/realtimeMarket.ts";
import { analyzeRealtimeSignals } from "../app/lib/realtimeSignals.ts";

test("normalizes supported realtime stock codes", () => {
  assert.deepEqual(normalizeRealtimeRequest({ code: " sz000001 " }), { code: "000001" });
  assert.deepEqual(normalizeRealtimeRequest({ code: "600000.SH" }), { code: "600000" });
  assert.throws(() => normalizeRealtimeRequest({ code: "PingAn" }), /6 位/);
});

test("normalizes and limits realtime alert batches", () => {
  assert.deepEqual(normalizeRealtimePriceRequest({ codes: ["sz000001", "000001", "600000.SH"] }), { codes: ["000001", "600000"] });
  assert.throws(() => normalizeRealtimePriceRequest({ codes: [] }), /1 到 30/);
  assert.throws(() => normalizeRealtimePriceRequest({ codes: ["invalid"] }), /6 位/);
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

test("parses multiple realtime quotes without discarding valid symbols", () => {
  const body = [
    'var hq_str_sz000001="平安银行,10.990,10.980,10.870,11.130,10.860,10.860,10.870,124327163,1369501332.140,771500,10.860,775800,10.850,249500,10.840,188500,10.830,277300,10.820,57700,10.870,179000,10.880,183900,10.890,105500,10.900,40500,10.910,2026-07-21,11:30:00,00";',
    'var hq_str_sh600000="浦发银行,12.000,11.900,12.100,12.200,11.800,12.090,12.100,1000,12100,100,12.090,90,12.080,80,12.070,70,12.060,60,12.050,50,12.100,40,12.110,30,12.120,20,12.130,10,12.140,2026-07-21,11:30:00,00";',
    'var hq_str_sz000002="";',
  ].join("\n");
  const quotes = parseQuoteBatchResponse(body);

  assert.deepEqual(quotes.map(({ code, price }) => ({ code, price })), [
    { code: "000001", price: 10.87 },
    { code: "600000", price: 12.1 },
  ]);
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
