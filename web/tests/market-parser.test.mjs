import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateCandles,
  analyzeKlineConclusion,
  analyzeMarketIntent,
  calculateIndicators,
  parseMarketCsv,
} from "../app/lib/market.ts";

test("parses compact metadata-first backward-adjusted CSV", () => {
  const csv = [
    "#META,股票代码=002747,流通A股本(股)=782404628,流通股本生效日=2026-03-09,价格口径=后复权",
    "交易日期,成交时间,成交价格(元),成交量(股),性质",
    "2026-07-10,09:25:00,250.835,1888200,中性盘",
    "2026-07-10,09:30:00,251.830,493800,买盘",
  ].join("\n");

  const dataset = parseMarketCsv(csv);
  assert.deepEqual(dataset.codes, ["002747"]);
  assert.equal(dataset.rows.length, 2);
  assert.deepEqual(dataset.stockNames, {});
  assert.equal(dataset.listedAShares, 782404628);
  assert.equal(dataset.shareCapitalDate, "2026-03-09");
  assert.equal(dataset.priceBasis, "后复权");
  assert.match(dataset.dataLevel, /后复权/);
  assert.equal(dataset.rows[1].status, "买盘");
  assert.match(dataset.amountBasis, /代理/);

  const candles = aggregateCandles(dataset.rows, "002747", "1d");
  assert.equal(candles.length, 1);
  assert.equal(candles[0].open, 250.835);
  assert.equal(candles[0].close, 251.83);
  assert.equal(candles[0].volume, 2382000);
});

test("parses enriched daily context and calculates real-amount behavior proxy", () => {
  const csv = [
    "#META,股票代码=002747,股票名称=埃斯顿,流通A股本(股)=1000000,流通股本生效日=2026-07-01,价格口径=前复权,成交数据级别=Level-1历史分笔,成交时间精度=分钟,数据序号口径=文件内单日顺序,成交金额口径=原始成交价×成交量",
    "#DAY,交易日期=2026-07-09,前复权因子=1.2500000000,流通A股本(股)=900000,流通股本生效日=2026-06-30,,,,,",
    "#DAY,交易日期=2026-07-10,前复权因子=1.0000000000,流通A股本(股)=1000000,流通股本生效日=2026-07-01,,,,,",
    "交易日期,成交时间,数据序号,原始成交价格(元),前复权成交价格(元),成交量(股),成交金额(元),性质,原始性质代码,交易时段",
    "2026-07-09,15:00:00,1,12.500,10.000,1000,12500.000,中性盘,2,收盘集合竞价",
    "2026-07-10,09:30:00,1,10.000,10.000,1000,10000.000,买盘,0,连续竞价",
    "2026-07-10,10:00:00,2,10.200,10.200,2000,20400.000,买盘,0,连续竞价",
    "2026-07-10,14:45:00,3,10.100,10.100,1000,10100.000,卖盘,1,连续竞价",
    "2026-07-10,15:05:00,4,10.100,10.100,100,1010.000,其他,8,盘后交易",
  ].join("\n");

  const dataset = parseMarketCsv(csv);
  assert.equal(dataset.rows.length, 5);
  assert.equal(dataset.stockNames["002747"], "埃斯顿");
  assert.equal(dataset.rows[0].rawPrice, 12.5);
  assert.equal(dataset.rows[0].price, 10);
  assert.equal(dataset.rows[1].amount, 10000);
  assert.equal(dataset.rows[1].listedAShares, 1000000);
  assert.equal(dataset.quality.dailyContextCoverage, 1);
  assert.equal(dataset.amountBasis, "原始成交价×成交量");

  const candles = aggregateCandles(dataset.rows, "002747", "1d");
  assert.equal(candles.length, 2);
  assert.equal(candles[1].amount, 41510);
  assert.ok(Math.abs(candles[1].turnoverPct - 0.41) < 1e-12);
  assert.ok(Math.abs(candles[1].vwap - 10.124390243902439) < 1e-12);

  const intent = analyzeMarketIntent(dataset, "002747", "2026-07-10");
  assert.ok(intent);
  assert.equal(intent.activeNetAmount, 20300);
  assert.equal(intent.tailNetRatio, -100);
  assert.ok(intent.confidence >= 20 && intent.confidence <= 68);
  assert.match(intent.warnings.join(" "), /Level-1/);
});

test("falls back to a disclosed daily price-volume behavior proxy", () => {
  const csv = [
    "#META,股票代码=000001,股票名称=平安银行,价格口径=前复权,成交数据级别=HTTPS日K聚合行情,成交时间精度=日,成交金额口径=典型价格×成交量代理",
    "交易日期,成交时间,股票代码,股票名称,前复权成交价格(元),成交量(股),成交金额估算(元),性质,交易时段,数据级别",
    "2026-07-20,09:30:00,000001,平安银行,10.00,250000,2500000,,连续竞价,HTTPS日K聚合行情",
    "2026-07-20,10:30:00,000001,平安银行,10.30,250000,2575000,,连续竞价,HTTPS日K聚合行情",
    "2026-07-20,14:00:00,000001,平安银行,9.90,250000,2475000,,连续竞价,HTTPS日K聚合行情",
    "2026-07-20,15:00:00,000001,平安银行,10.25,250000,2562500,,连续竞价,HTTPS日K聚合行情",
  ].join("\n");
  const dataset = parseMarketCsv(csv);
  const intent = analyzeMarketIntent(dataset, "000001", "2026-07-20");
  assert.ok(intent);
  assert.equal(intent.basis, "daily-price-volume");
  assert.ok(intent.activeNetAmount > 0);
  assert.match(intent.warnings.join(" "), /不等于真实主力净流入/);
});

test("calculates nine-turn completion, composite guide and K-line conclusion", () => {
  const candles = Array.from({ length: 20 }, (_, index) => {
    const close = 10 + index * 0.2;
    return {
      key: `2026-06-${String(index + 1).padStart(2, "0")}`,
      label: `06-${String(index + 1).padStart(2, "0")}`,
      date: `2026-06-${String(index + 1).padStart(2, "0")}`,
      time: "",
      open: close - 0.08,
      high: close + 0.12,
      low: close - 0.15,
      close,
      volume: 100_000 + index * 5_000,
      amount: close * (100_000 + index * 5_000),
      adjustedAmount: close * (100_000 + index * 5_000),
      vwap: close - 0.02,
      turnoverPct: 0.5,
      change: index === 0 ? 0 : 0.2,
      changePct: index === 0 ? 0 : (0.2 / (close - 0.2)) * 100,
    };
  });

  const indicators = calculateIndicators(candles);
  assert.deepEqual(indicators.nineTurn[12], { count: 9, direction: "sell", completed: true });
  assert.equal(indicators.guidePoints[12]?.type, "sell");
  assert.ok((indicators.guidePoints[12]?.score ?? 0) >= 3);
  assert.equal(indicators.volumeMa5[4], 110_000);

  const conclusion = analyzeKlineConclusion(candles, indicators, 19);
  assert.ok(conclusion);
  assert.equal(conclusion.tone, "up");
  assert.match(conclusion.summary, /结构偏强/);
  assert.ok(conclusion.support < conclusion.resistance);
  assert.ok((conclusion.atr ?? 0) > 0);
});
