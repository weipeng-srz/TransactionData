import assert from "node:assert/strict";
import test from "node:test";
import { buildHoldingRiskPlan, holdingRiskStatus } from "../app/lib/holdingRisk.ts";

const holding = { code: "000001", shares: 100, cost: 10, updatedAt: "2026-06-01T00:00:00Z" };
const candles = Array.from({ length: 25 }, (_, index) => {
  const date = `2026-06-${String(index + 1).padStart(2, "0")}`;
  return { key: date, label: date, date, time: "", open: 10, high: 10.5, low: 9.5, close: 10, volume: 1000, amount: 10000, adjustedAmount: 10000, vwap: 10, turnoverPct: null, change: 0, changePct: 0 };
});
const input = { holding, code: "000001", market: "CN", candles, priceBasis: "不复权", now: new Date("2026-07-01T10:00:00Z") };

test("holding risk reuses ATR and support to produce cost-anchored levels and percentage points", () => {
  const plan = buildHoldingRiskPlan(input);
  assert.equal(plan.state, "ready");
  assert.equal(plan.atr, 1);
  assert.equal(plan.stopLoss, 9);
  assert.equal(plan.takeProfit, 13);
  assert.ok(Math.abs(plan.stopLossPct - -10) < 1e-10);
  assert.ok(Math.abs(plan.takeProfitPct - 30) < 1e-10);
  assert.equal(plan.riskRewardRatio, 3);
  assert.deepEqual(plan.lines.map((line) => line.price), [10, 13, 9]);
});

test("nearby resistance lowers the profit target while stop tightening retains an ATR buffer", () => {
  const rising = candles.map((candle) => ({ ...candle, open: 11.5, close: 11.5, low: 11, high: 12 }));
  const plan = buildHoldingRiskPlan({ ...input, candles: rising });
  assert.equal(plan.atr, 1);
  assert.equal(plan.takeProfit, 12);
  assert.equal(plan.stopLoss, 9.5);
  assert.equal(plan.riskRewardRatio, 4);
});

test("only the active security's valid saved holding receives reference levels", () => {
  assert.equal(buildHoldingRiskPlan({ ...input, holding: null }), null);
  assert.equal(buildHoldingRiskPlan({ ...input, code: "600000" }), null);
  assert.equal(buildHoldingRiskPlan({ ...input, market: "US" }), null);
  for (const patch of [{ shares: 0 }, { shares: 1.5 }, { cost: NaN }, { cost: Infinity }, { cost: 0 }]) {
    assert.equal(buildHoldingRiskPlan({ ...input, holding: { ...holding, ...patch } }), null);
  }
});

test("raw position prices and adjusted chart prices use the explicit daily factor", () => {
  const plan = buildHoldingRiskPlan({ ...input, holding: { ...holding, cost: 20 }, priceBasis: "前复权", chartAdjustmentFactor: 2 });
  assert.equal(plan.state, "ready");
  assert.equal(plan.cost, 20);
  assert.equal(plan.atr, 2);
  assert.equal(plan.stopLoss, 18);
  assert.equal(plan.takeProfit, 26);
  assert.deepEqual(plan.lines.map((line) => line.price), [10, 13, 9]);
  assert.equal(holdingRiskStatus(plan, 20).tone, "neutral");
  assert.equal(holdingRiskStatus(plan, 17).tone, "risk");
});

test("unknown or backward price bases and missing factors never mix cost with chart prices", () => {
  for (const priceBasis of ["", "后复权", "未知"]) {
    const plan = buildHoldingRiskPlan({ ...input, priceBasis });
    assert.equal(plan.state, "unavailable");
    assert.deepEqual(plan.lines, []);
  }
  for (const chartAdjustmentFactor of [undefined, 0, -1, NaN, Infinity]) {
    const plan = buildHoldingRiskPlan({ ...input, priceBasis: "前复权", chartAdjustmentFactor });
    assert.equal(plan.state, "unavailable");
    assert.deepEqual(plan.lines, []);
  }
});

test("short, invalid or flat daily data does not invent recommended exit prices", () => {
  const variants = [
    candles.slice(-19),
    candles.map((candle) => ({ ...candle, high: 10, low: 10 })),
    candles.map((candle, index) => index === 24 ? { ...candle, close: 0 } : candle),
    candles.map((candle, index) => index === 24 ? { ...candle, high: NaN } : candle),
    candles.map((candle, index) => index === 24 ? { ...candle, high: 9 } : candle),
  ];
  for (const series of variants) {
    const plan = buildHoldingRiskPlan({ ...input, candles: series });
    assert.equal(plan.state, "unavailable");
    assert.equal(plan.stopLoss, null);
    assert.equal(plan.takeProfit, null);
    assert.equal(plan.lines.length, 1);
  }
});

test("partial-day updates and live price changes cannot move an intraday stop", () => {
  const options = { ...input, provisionalDate: "2026-06-25" };
  const plan = buildHoldingRiskPlan(options);
  const changed = buildHoldingRiskPlan({ ...options, candles: candles.map((candle, index) => index === 24 ? { ...candle, high: 30, low: 1, close: 2 } : candle) });
  assert.deepEqual(changed, plan);
  assert.equal(plan.asOf, "2026-06-24");
  assert.equal(holdingRiskStatus(plan, 10).tone, "neutral");
  assert.equal(holdingRiskStatus(plan, 8).tone, "risk");
  assert.equal(plan.stopLoss, 9);
});

test("China's in-progress date is excluded without a realtime snapshot", () => {
  const beforeClose = buildHoldingRiskPlan({ ...input, now: new Date("2026-06-25T06:30:00Z") });
  const afterClose = buildHoldingRiskPlan({ ...input, now: new Date("2026-06-25T07:01:00Z") });
  assert.equal(beforeClose.asOf, "2026-06-24");
  assert.equal(afterClose.asOf, "2026-06-25");
});

test("US in-progress dates use New York time and support the actual US feed price basis", () => {
  const usInput = { ...input, code: "AAPL", market: "US", priceBasis: "新浪美股日K", holding: { ...holding, code: "AAPL", market: "US", currency: "USD" } };
  const beforeClose = buildHoldingRiskPlan({ ...usInput, now: new Date("2026-06-25T19:30:00Z") });
  const afterClose = buildHoldingRiskPlan({ ...usInput, now: new Date("2026-06-25T20:01:00Z") });
  assert.equal(beforeClose.state, "ready");
  assert.equal(beforeClose.asOf, "2026-06-24");
  assert.equal(afterClose.asOf, "2026-06-25");
});

test("prices at exit thresholds trigger inclusive status and invalid prices stay pending", () => {
  const plan = buildHoldingRiskPlan(input);
  assert.equal(holdingRiskStatus(plan, plan.stopLoss).tone, "risk");
  assert.equal(holdingRiskStatus(plan, plan.takeProfit).tone, "profit");
  for (const currentPrice of [null, 0, NaN, Infinity, -10]) {
    assert.equal(holdingRiskStatus(plan, currentPrice).label, "等待有效现价");
  }
});

test("existing underwater positions keep the cost anchor and show a breached stop", () => {
  const plan = buildHoldingRiskPlan({ ...input, holding: { ...holding, cost: 20 } });
  assert.equal(plan.stopLoss, 18);
  assert.equal(plan.takeProfit, 23);
  assert.equal(holdingRiskStatus(plan, 10).tone, "risk");
});

test("excessive ATR relative to acquisition cost produces an unavailable state", () => {
  const plan = buildHoldingRiskPlan({ ...input, holding: { ...holding, cost: 1 } });
  assert.equal(plan.state, "unavailable");
  assert.equal(plan.stopLoss, null);
  assert.match(plan.reason, /波动/);
});
