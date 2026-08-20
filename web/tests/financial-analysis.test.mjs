import assert from "node:assert/strict";
import test from "node:test";

import { buildFinancialAnalysis } from "../app/lib/financialAnalysis.ts";

const dates = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"];

function payload(rows) {
  return { success: true, result: { data: rows } };
}

const income = payload([
  ["2025-03-31", 100, 60, 10, 8, 12, 5],
  ["2025-06-30", 220, 128, 25, 20, 30, 11],
  ["2025-09-30", 360, 207, 45, 37, 55, 18],
  ["2025-12-31", 520, 296, 70, 60, 88, 27],
  ["2026-03-31", 150, 90, 20, 18, 26, 7],
].map(([date, revenue, cost, profit, deduct, operatingProfit, research]) => ({
  REPORT_DATE: `${date} 00:00:00`,
  NOTICE_DATE: `${date} 00:00:00`,
  TOTAL_OPERATE_INCOME: revenue,
  OPERATE_COST: cost,
  PARENT_NETPROFIT: profit,
  DEDUCT_PARENT_NETPROFIT: deduct,
  OPERATE_PROFIT: operatingProfit,
  RESEARCH_EXPENSE: research,
})));

const cashflow = payload([
  ["2025-03-31", 5, -4, 8, 2],
  ["2025-06-30", 18, -9, 12, 5],
  ["2025-09-30", 36, -16, 20, 9],
  ["2025-12-31", 80, -25, 30, 14],
  ["2026-03-31", 25, -7, 10, 4],
].map(([date, cfo, investing, financing, capex]) => ({
  REPORT_DATE: `${date} 00:00:00`,
  NETCASH_OPERATE: cfo,
  NETCASH_INVEST: investing,
  NETCASH_FINANCE: financing,
  CONSTRUCT_LONG_ASSET: capex,
})));

const balance = payload(dates.map((date, index) => ({
  REPORT_DATE: `${date} 00:00:00`,
  ACCOUNTS_RECE: [50, 55, 60, 70, 90][index],
  INVENTORY: [40, 44, 48, 52, 60][index],
  CONTRACT_LIAB: [10, 12, 15, 18, 25][index],
  GOODWILL: 5,
  FIXED_ASSET: [80, 84, 88, 94, 105][index],
  CIP: [8, 9, 12, 15, 20][index],
  MONETARYFUNDS: [30, 34, 38, 42, 50][index],
  SHORT_LOAN: [20, 21, 22, 25, 30][index],
  LONG_LOAN: 10,
  TOTAL_ASSETS: [300, 320, 340, 370, 430][index],
  TOTAL_LIABILITIES: [100, 108, 116, 130, 150][index],
  TOTAL_PARENT_EQUITY: [200, 212, 224, 240, 300][index],
})));

const indicators = payload(dates.map((date) => ({
  REPORT_DATE: `${date} 00:00:00`,
  REPORT_DATE_NAME: `${date.slice(0, 4)}Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`,
  LD: 2,
  SD: 1.4,
  ZCFZL: 35,
  YSZKZZTS: 42,
  CHZZTS: 58,
  ROEJQ: 8,
  ROIC: 7,
})));

test("converts cumulative A-share statements into single-quarter and TTM metrics", () => {
  const analysis = buildFinancialAnalysis({ income, balance, cashflow, indicators });
  assert.equal(analysis.periods.length, 5);
  const q1_2026 = analysis.periods[0];
  const q4_2025 = analysis.periods[1];
  const q2_2025 = analysis.periods[3];

  assert.equal(q2_2025.single.revenue, 120);
  assert.equal(q2_2025.single.parentNetProfit, 15);
  assert.equal(q4_2025.single.revenue, 160);
  assert.equal(q4_2025.single.operatingCashFlow, 44);
  assert.equal(q1_2026.ttm.revenue, 570);
  assert.equal(q1_2026.ttm.parentNetProfit, 80);
  assert.equal(q1_2026.singleYoY.revenue, 50);
  assert.equal(q1_2026.singleYoY.parentNetProfit, 100);
  assert.equal(q1_2026.single.freeCashFlow, 21);
  assert.equal(q1_2026.single.cashCoverage, 1.25);
  assert.equal(q1_2026.ttm.roe, 32);
});

test("keeps balance-sheet metrics as period-end values and compares them year over year", () => {
  const analysis = buildFinancialAnalysis({ income, balance, cashflow, indicators });
  const latest = analysis.periods[0];
  assert.equal(latest.balance.accountsReceivable, 90);
  assert.equal(latest.balance.interestBearingDebt, 40);
  assert.equal(latest.balance.netDebt, -10);
  assert.equal(latest.balanceYoY.accountsReceivable, 80);
  assert.equal(latest.balanceYoY.debtAssetRatio, 0);
});

test("does not present a positive cash-coverage multiple when net profit is negative", () => {
  const lossIncome = structuredClone(income);
  lossIncome.result.data[4].PARENT_NETPROFIT = -20;
  const lossCashflow = structuredClone(cashflow);
  lossCashflow.result.data[4].NETCASH_OPERATE = -25;
  const analysis = buildFinancialAnalysis({ income: lossIncome, balance, cashflow: lossCashflow, indicators });
  assert.equal(analysis.periods[0].single.cashCoverage, null);
  assert.ok(analysis.periods[0].qualityFlags.some((flag) => flag.key === "cash-coverage-loss"));
});

test("flags ROE that is mathematically valid but distorted by a thin equity base", () => {
  const thinBalance = structuredClone(balance);
  thinBalance.result.data[0].TOTAL_PARENT_EQUITY = 2;
  thinBalance.result.data[4].TOTAL_PARENT_EQUITY = 2;
  const analysis = buildFinancialAnalysis({ income, balance: thinBalance, cashflow, indicators });
  assert.ok(analysis.periods[0].qualityFlags.some((flag) => flag.key === "roe-thin-equity"));
});

test("accepts the operating-income field used by insurer statements", () => {
  const insurerIncome = structuredClone(income);
  for (const row of insurerIncome.result.data) {
    row.OPERATE_INCOME = row.TOTAL_OPERATE_INCOME;
    delete row.TOTAL_OPERATE_INCOME;
  }
  const insurerIndicators = structuredClone(indicators);
  for (const row of insurerIndicators.result.data) row.ORG_TYPE = "保险";
  const analysis = buildFinancialAnalysis({ income: insurerIncome, balance, cashflow, indicators: insurerIndicators });
  assert.equal(analysis.periods[0].cumulative.revenue, 150);
  assert.equal(analysis.periods[0].single.cashCoverage, null);
  assert.ok(analysis.periods[0].qualityFlags.some((flag) => flag.key === "cash-coverage-financial"));
});
