import assert from "node:assert/strict";
import test from "node:test";

import { mergeClosedCnRealtimeDay } from "../app/lib/closedMarketDay.ts";
import { aggregateCandles, parseMarketCsv } from "../app/lib/market.ts";

const priorDayCsv = [
  "#META,股票代码=000001,股票名称=平安银行,流通A股本(股)=1000000,价格口径=前复权,成交数据级别=HTTPS日K聚合行情,成交时间精度=日",
  "#DAY,交易日期=2026-08-17,前复权因子=2,流通A股本(股)=1000000",
  "交易日期,成交时间,数据序号,股票代码,股票名称,原始成交价格(元),前复权成交价格(元),成交量(股),成交金额估算(元),性质,原始性质代码,交易时段,数据级别",
  "2026-08-17,09:30:00,1,000001,平安银行,20,10,100,2000,,,连续竞价,HTTPS日K聚合行情",
  "2026-08-17,15:00:00,2,000001,平安银行,20,10,100,2000,,,收盘集合竞价,HTTPS日K聚合行情",
].join("\n");

function snapshot(overrides = {}) {
  return {
    code: "000001",
    name: "平安银行",
    date: "2026-08-18",
    time: "15:00:00",
    marketStatus: "已收盘",
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
    fetchedAt: "2026-08-18T07:00:00.000Z",
    ...overrides,
  };
}

test("adds the finalized current trading day at the 15:00 Shanghai close", () => {
  const dataset = parseMarketCsv(priorDayCsv);
  const merged = mergeClosedCnRealtimeDay(dataset, snapshot(), new Date("2026-08-18T07:00:00.000Z"));
  const candles = aggregateCandles(merged.rows, "000001", "1d");

  assert.equal(candles.length, 2);
  assert.equal(candles[1].date, "2026-08-18");
  assert.equal(candles[1].open, 11);
  assert.equal(candles[1].high, 12);
  assert.equal(candles[1].low, 10.5);
  assert.equal(candles[1].close, 11.5);
  assert.equal(candles[1].volume, 403);
  assert.equal(candles[1].amount, 9_000);
  assert.equal(merged.dailyContexts["2026-08-18"].adjustmentFactor, 2);
});

test("does not treat an unfinished or stale snapshot as a finalized daily candle", () => {
  const dataset = parseMarketCsv(priorDayCsv);
  const beforeClose = mergeClosedCnRealtimeDay(dataset, snapshot(), new Date("2026-08-18T06:59:59.000Z"));
  const unfinished = mergeClosedCnRealtimeDay(dataset, snapshot({ time: "14:59:59" }), new Date("2026-08-18T07:01:00.000Z"));
  const stale = mergeClosedCnRealtimeDay(dataset, snapshot({ date: "2026-08-17" }), new Date("2026-08-18T07:01:00.000Z"));

  assert.equal(beforeClose, dataset);
  assert.equal(unfinished, dataset);
  assert.equal(stale, dataset);
});

test("replaces an already-present current daily aggregate instead of duplicating it", () => {
  const dataset = parseMarketCsv(`${priorDayCsv}\n2026-08-18,15:00:00,1,000001,平安银行,21,10.5,100,2100,,,收盘集合竞价,HTTPS日K聚合行情`);
  const merged = mergeClosedCnRealtimeDay(dataset, snapshot(), new Date("2026-08-18T07:05:00.000Z"));
  const currentRows = merged.rows.filter((row) => row.date === "2026-08-18");
  const candles = aggregateCandles(merged.rows, "000001", "1d");

  assert.equal(currentRows.length, 4);
  assert.equal(candles.length, 2);
  assert.equal(candles[1].close, 11.5);
});

test("leaves true Level-1 datasets untouched", () => {
  const dataset = parseMarketCsv(priorDayCsv.replaceAll("HTTPS日K聚合行情", "Level-1历史分笔"));
  const merged = mergeClosedCnRealtimeDay(dataset, snapshot(), new Date("2026-08-18T07:05:00.000Z"));

  assert.equal(merged, dataset);
});
