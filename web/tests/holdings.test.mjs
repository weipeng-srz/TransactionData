import assert from "node:assert/strict";
import test from "node:test";
import { calculateHoldingMetrics, exportHoldingsCsv, parseHoldings, parseHoldingsCsv } from "../app/lib/holdings.ts";

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

test("exports a user-editable holdings CSV and imports it without embedded defaults", () => {
  const holdings = parseHoldings([
    { code: "000001", shares: 1000, cost: 10.25, updatedAt: "2026-08-12T10:00:00.000Z" },
  ]);
  const csv = exportHoldingsCsv(holdings, [{ code: "000001", name: "平安银行" }]);
  assert.match(csv, /^\uFEFF股票代码,股票名称,持股数量,平均成本价\r\n/);
  assert.match(csv, /000001,平安银行,1000,10\.25/);
  const imported = parseHoldingsCsv(csv, "2026-08-12T11:00:00.000Z");
  assert.deepEqual(imported.stocks, [{ code: "000001", name: "平安银行" }]);
  assert.deepEqual(imported.holdings["000001"], {
    code: "000001", shares: 1000, cost: 10.25, updatedAt: "2026-08-12T11:00:00.000Z",
  });
});

test("accepts edited CSV codes after spreadsheet software removes leading zeros", () => {
  const imported = parseHoldingsCsv("股票代码,股票名称,持股数量,平均成本价\n1,平安银行,1200,9.8\n", "2026-08-12T11:00:00.000Z");
  assert.equal(imported.stocks[0].code, "000001");
  assert.equal(imported.holdings["000001"].shares, 1200);
});

test("rejects malformed or duplicate holdings CSV rows with an actionable line number", () => {
  assert.throws(
    () => parseHoldingsCsv("股票代码,股票名称,持股数量,平均成本价\n000001,平安银行,100,10\n000001,重复,200,11\n"),
    /第 3 行股票代码 000001 重复/,
  );
});
