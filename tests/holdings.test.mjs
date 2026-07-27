import assert from "node:assert/strict";
import test from "node:test";
import { calculateHoldingMetrics, parseHoldings } from "../app/lib/holdings.ts";

test("calculateHoldingMetrics returns market value and profit percentage", () => {
  assert.deepEqual(calculateHoldingMetrics(1000, 10, 12.5), {
    costValue: 10_000,
    marketValue: 12_500,
    profit: 2_500,
    profitPct: 25,
  });
});

test("parseHoldings keeps valid stock records and rejects malformed values", () => {
  const holdings = parseHoldings([
    { code: "000001", shares: 1000, cost: 10.25, updatedAt: "2026-07-24T10:00:00.000Z" },
    { code: "600000", shares: 0, cost: 12, updatedAt: "2026-07-24T10:00:00.000Z" },
    { code: "invalid", shares: 200, cost: 8, updatedAt: "2026-07-24T10:00:00.000Z" },
  ]);
  assert.deepEqual(Object.keys(holdings), ["000001"]);
  assert.equal(holdings["000001"].shares, 1000);
});

test("calculateHoldingMetrics rejects incomplete position inputs", () => {
  assert.equal(calculateHoldingMetrics(0, 10, 12), null);
  assert.equal(calculateHoldingMetrics(100, 0, 12), null);
  assert.equal(calculateHoldingMetrics(100, 10, null), null);
});
