import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { calculateIndicators, LEGACY_SIGNAL_GUIDE_POLICY } from "../app/lib/market.ts";
import { backtestGuideSignals, collectGuideSignals, resolveGuideExit } from "../app/lib/research.ts";
import { buildEvents, simulatePortfolio } from "../scripts/backtest-bs-portfolio.mjs";

function candles(length = 30) {
  return Array.from({ length }, (_, index) => ({
    key: String(index), label: String(index), date: new Date(Date.UTC(2023, 0, index + 1)).toISOString().slice(0, 10),
    time: "", open: 10, high: 10.2, low: 9.8, close: 10, volume: 10_000_000,
    amount: 100_000_000, adjustedAmount: 100_000_000, vwap: 10, turnoverPct: null, change: 0, changePct: 0,
  }));
}
function randomCandles() {
  let seed = 41, previous = 20;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  return candles(600).map((candle) => {
    const open = previous + (random() - 0.5) * 0.2;
    const close = Math.max(2, previous + (random() - 0.48) * 0.8);
    const high = Math.max(open, close) + random() * 0.3;
    const low = Math.min(open, close) - random() * 0.3;
    const volume = 100_000 + Math.floor(random() * 300_000);
    previous = close;
    return { ...candle, open, close, high, low, volume, amount: close * volume, adjustedAmount: close * volume, vwap: close };
  });
}
function withSignals(rows, entries = [[2, "buy"]]) {
  const indicators = calculateIndicators(rows);
  indicators.guidePoints.fill(null);
  for (const [index, type] of entries) indicators.guidePoints[index] = { type, score: 3, reasons: [], confidence: type === "buy" ? "standard" : "risk" };
  return indicators;
}
function security(rows, code = "600000") {
  return { quote: { code, name: "测试", symbol: `sh${code}` }, candles: rows, candlesByDate: new Map(rows.map((row) => [row.date, row])) };
}

test("v1 baseline exactly reproduces the pre-change signals", () => {
  const result = calculateIndicators(randomCandles(), LEGACY_SIGNAL_GUIDE_POLICY).guidePoints;
  assert.equal(createHash("sha256").update(JSON.stringify(result)).digest("hex"), "dfe8e51e1576095381c4b24b7237d9773fa83e39319e9c5e4648ecde1c3424ee");
});

test("v2 demotes nine-turn-dominated entries while preserving other qualifying rebounds", () => {
  const rows = randomCandles();
  const indicators = calculateIndicators(rows, { version: "v2" });
  assert.equal(calculateIndicators(rows).guidePoints[157]?.score, 4, "default keeps existing weights");
  assert.notEqual(indicators.guidePoints[98]?.confidence, "watch");
  assert.equal(indicators.guidePoints[157]?.confidence, "watch");
  assert.equal(indicators.guidePoints[157]?.score, 2);
  assert.ok(indicators.guidePoints[157]?.reasons.includes("下跌九转完成"));
  const active = indicators.guidePoints.flatMap((guide, index) => guide?.type === "buy" && guide.confidence !== "watch" ? [{ guide, index }] : []);
  assert.ok(active.length > 0, "the filter must still admit qualifying setups");
  for (const { guide } of active) {
    assert.ok(guide.score >= 3);
    assert.ok(guide.reasons.includes("RSI超卖回升") || guide.reasons.includes("BOLL下轨承接"));
  }
});

test("changing buy eligibility does not suppress S risk signals", () => {
  const rows = randomCandles();
  const normal = calculateIndicators(rows).guidePoints;
  const buysDisabled = calculateIndicators(rows, { minimumBuyScore: 99 }).guidePoints;
  const sellIndexes = (guides) => guides.flatMap((guide, index) => guide?.type === "sell" ? [index] : []);
  assert.ok(sellIndexes(normal).length > 0);
  assert.deepEqual(sellIndexes(normal), sellIndexes(buysDisabled));
});

test("adding later bars never changes confirmed historical signals", () => {
  const rows = randomCandles();
  const all = calculateIndicators(rows).guidePoints;
  for (let end = 25; end <= rows.length; end += 7) {
    assert.deepEqual(calculateIndicators(rows.slice(0, end)).guidePoints, all.slice(0, end));
  }
});

test("B/S deduplication is independent and accepts exactly three bars apart", () => {
  const rows = candles();
  const indicators = withSignals(rows, [[0, "buy"], [1, "sell"], [2, "buy"], [3, "buy"], [4, "sell"]]);
  assert.deepEqual(collectGuideSignals(indicators.guidePoints).map((signal) => signal.index), [0, 1, 3, 4]);
});

test("future entry-day volume cannot change entry cost, liquidity ranking or eligibility", () => {
  const rows = candles();
  const changed = rows.map((row, index) => index === 3 ? { ...row, volume: 100, amount: 1_000, adjustedAmount: 1_000 } : row);
  const indicators = withSignals(rows);
  const baseline = buildEvents(security(rows), indicators, "optimized")[0];
  const comparison = buildEvents(security(changed), indicators, "optimized")[0];
  assert.equal(comparison.dailyAmount, baseline.dailyAmount);
  assert.equal(comparison.costPct, baseline.costPct);
  const a = backtestGuideSignals(rows, indicators, [10], { market: "US", costModel: "liquidity" });
  const b = backtestGuideSignals(changed, indicators, [10], { market: "US", costModel: "liquidity" });
  assert.equal(a.horizons[0].averageCostPct, b.horizons[0].averageCostPct);
  const dates = rows.map((row) => row.date);
  const policy = new Map(dates.map((date) => [date, { status: "active" }]));
  assert.equal(simulatePortfolio([baseline], dates, policy, "optimized").trades, 1);
  assert.equal(simulatePortfolio([comparison], dates, policy, "optimized").trades, 1);
});

test("blocked exits are delayed and losing trades remain in realized results", () => {
  const rows = candles();
  rows[12] = { ...rows[12], open: 9, high: 9, low: 9, close: 9 };
  rows[13] = { ...rows[13], volume: 0, amount: 0, adjustedAmount: 0, close: 9 };
  rows[14] = { ...rows[14], open: 9, high: 9.2, low: 8.8, close: 9 };
  const exit = resolveGuideExit(rows, 2, 10, "buy", { market: "CN", code: "600000" });
  assert.equal(exit.index, 14);
  assert.equal(exit.delayed, true);
  const result = backtestGuideSignals(rows, withSignals(rows), [10], { market: "CN", code: "600000" }).directions.buy.horizons[0];
  assert.equal(result.samples, 1);
  assert.equal(result.delayedExits, 1);
  assert.ok(result.averageReturn < -10);
});

test("unfilled exits are explicit and keep capital occupied in the portfolio", () => {
  const rows = candles(13);
  rows[12] = { ...rows[12], volume: 0, close: 8 };
  const indicators = withSignals(rows);
  const result = backtestGuideSignals(rows, indicators, [10], { market: "CN" }).directions.buy.horizons[0];
  assert.equal(result.samples, 0);
  assert.equal(result.pendingExits, 1);
  const events = buildEvents(security(rows), indicators, "optimized");
  assert.equal(events.length, 1);
  assert.equal(events[0].netReturn, null);
  const dates = rows.map((row) => row.date);
  const portfolio = simulatePortfolio(events, dates, new Map(dates.map((date) => [date, { status: "active" }])), "optimized");
  assert.equal(portfolio.trades, 0);
  assert.equal(portfolio.openPositions, 1);
  assert.ok(portfolio.endingCapital < portfolio.initialCapital);
});

test("S exits occur on the following open without using that day's later range", () => {
  const rows = candles();
  rows[7] = { ...rows[7], open: 10.5, close: 12, high: 15, low: 1 };
  const indicators = withSignals(rows, [[2, "buy"], [6, "sell"]]);
  const options = { market: "US", exitRule: "sell-signal", roundTripCostPct: 0 };
  const exit = resolveGuideExit(rows, 2, 10, "buy", options, indicators.guidePoints);
  assert.equal(exit.index, 7);
  assert.equal(exit.price, 10.5);
  const result = backtestGuideSignals(rows, indicators, [10], options).directions.buy.horizons[0];
  assert.ok(Math.abs(result.averageReturn - 5) < 1e-8);
  assert.ok(result.worstAdverseMove > -3);
  assert.ok(result.bestFavorableMove < 6);
});

test("CN intraday exits respect T+1 while US exits can complete the same day", () => {
  const rows = candles(8).map((row, index) => ({ ...row, date: index < 6 ? "2023-01-03" : "2023-01-04", time: `10:0${index}` }));
  assert.equal(resolveGuideExit(rows, 0, 2, "buy", { market: "CN" }).index, 6);
  assert.equal(resolveGuideExit(rows, 0, 2, "buy", { market: "US" }).index, 2);
});

test("a full winning sample is not labelled weak because profit factor is undefined", () => {
  const rows = candles(100).map((row, index) => ({ ...row, open: 10 + index / 10, close: 10 + index / 10, high: 10.1 + index / 10, low: 9.9 + index / 10 }));
  const indicators = withSignals(rows, Array.from({ length: 8 }, (_, index) => [5 + index * 10, "buy"]));
  const result = backtestGuideSignals(rows, indicators, [10], { market: "US" });
  assert.equal(result.recent.status, "active");
  assert.match(result.recent.label, /仍需验证/);
});
