import assert from "node:assert/strict";
import test from "node:test";

import { aggregateCandles, parseMarketCsv } from "../app/lib/market.ts";
import { mergeCnRealtimeDailyCandle } from "../app/lib/realtimeDailyCandle.ts";

const priorDayCsv = [
  "#META,股票代码=000001,股票名称=平安银行,流通A股本(股)=1000000,价格口径=前复权,成交数据级别=HTTPS日K聚合行情,成交时间精度=日",
  "#DAY,交易日期=2026-08-24,前复权因子=2,流通A股本(股)=1000000",
  "交易日期,成交时间,数据序号,股票代码,股票名称,原始成交价格(元),前复权成交价格(元),成交量(股),成交金额估算(元),性质,原始性质代码,交易时段,数据级别",
  "2026-08-24,09:30:00,1,000001,平安银行,20,10,100,2000,,,连续竞价,HTTPS日K聚合行情",
  "2026-08-24,15:00:00,2,000001,平安银行,20,10,100,2000,,,收盘集合竞价,HTTPS日K聚合行情",
].join("\n");

function snapshot(overrides = {}) {
  return {
    code: "000001",
    name: "平安银行",
    date: "2026-08-25",
    time: "14:49:30",
    marketStatus: "交易中",
    price: 23,
    previousClose: 20,
    open: 22,
    high: 24,
    low: 21,
    change: 3,
    changePct: 15,
    volume: 403,
    amount: 9_000,
    bids: [],
    asks: [],
    minuteCandles: [],
    source: "test",
    fetchedAt: "2026-08-25T06:49:30.000Z",
    ...overrides,
  };
}

test("adds today's forming daily candle before 14:50 Shanghai time", () => {
  const dataset = parseMarketCsv(priorDayCsv);
  const historical = aggregateCandles(dataset.rows, "000001", "1d");
  const result = mergeCnRealtimeDailyCandle(
    historical,
    dataset,
    snapshot(),
    new Date("2026-08-25T06:49:31.000Z"),
  );

  assert.equal(result.included, true);
  assert.equal(result.provisional, true);
  assert.equal(result.time, "14:49:30");
  assert.equal(result.candles.length, 2);
  assert.equal(result.candles[1].date, "2026-08-25");
  assert.equal(result.candles[1].open, 11);
  assert.equal(result.candles[1].high, 12);
  assert.equal(result.candles[1].low, 10.5);
  assert.equal(result.candles[1].close, 11.5);
  assert.equal(result.candles[1].volume, 403);
  assert.equal(result.candles[1].amount, 9_000);
  assert.equal(result.candles[1].adjustedAmount, 4_500);
  assert.ok(Math.abs(result.candles[1].turnoverPct - 0.0403) < 1e-12);
});

test("marks the 15:00 candle final and replaces an existing current-day candle", () => {
  const dataset = parseMarketCsv(priorDayCsv);
  const historical = [
    ...aggregateCandles(dataset.rows, "000001", "1d"),
    { ...aggregateCandles(dataset.rows, "000001", "1d")[0], key: "2026-08-25", label: "08-25", date: "2026-08-25", close: 9 },
  ];
  const result = mergeCnRealtimeDailyCandle(
    historical,
    dataset,
    snapshot({ time: "15:00", marketStatus: "已收盘" }),
    new Date("2026-08-25T07:00:01.000Z"),
  );

  assert.equal(result.included, true);
  assert.equal(result.provisional, false);
  assert.equal(result.candles.filter((candle) => candle.date === "2026-08-25").length, 1);
  assert.equal(result.candles.at(-1).close, 11.5);
});

test("rejects stale, pre-open, and future-dated intraday snapshots", () => {
  const dataset = parseMarketCsv(priorDayCsv);
  const historical = aggregateCandles(dataset.rows, "000001", "1d");
  const now = new Date("2026-08-25T06:49:59.000Z");

  const stale = mergeCnRealtimeDailyCandle(historical, dataset, snapshot({ date: "2026-08-24" }), now);
  const preOpen = mergeCnRealtimeDailyCandle(historical, dataset, snapshot({ time: "09:29:59" }), now);
  const future = mergeCnRealtimeDailyCandle(historical, dataset, snapshot({ time: "14:50:00" }), now);

  assert.equal(stale.candles, historical);
  assert.equal(preOpen.candles, historical);
  assert.equal(future.candles, historical);
  assert.equal(stale.included, false);
  assert.equal(preOpen.included, false);
  assert.equal(future.included, false);
});
