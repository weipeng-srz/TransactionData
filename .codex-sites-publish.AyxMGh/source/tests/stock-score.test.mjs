import assert from "node:assert/strict";
import test from "node:test";

import { emptyFinancialDataset } from "../app/lib/financials.ts";
import { aggregateCandles, calculateIndicators, createDemoDataset } from "../app/lib/market.ts";
import { backtestGuideSignals } from "../app/lib/research.ts";
import { buildStockScore } from "../app/lib/stockScore.ts";

const dataset = createDemoDataset();
const code = dataset.codes[0];
const candles = aggregateCandles(dataset.rows, code, "1d");
const indicators = calculateIndicators(candles);
const backtest = backtestGuideSignals(candles, indicators);

function financials({ positive }) {
  const result = emptyFinancialDataset();
  result.code = code;
  result.snapshot = {
    ...result.snapshot,
    peTtm: positive ? 10 : 70,
    pb: positive ? 1.1 : 9,
    psTtm: positive ? 1.2 : 14,
    peg: positive ? 0.9 : 4,
    peTtmPercentile: positive ? 18 : 92,
    pbPercentile: positive ? 22 : 90,
    psTtmPercentile: positive ? 20 : 88,
    dividendYieldTtm: positive ? 4.2 : 0,
  };
  result.holderStructure = {
    ...result.holderStructure,
    institutionalRatio: positive ? 38 : 4,
    institutionalChangePp: positive ? 2.2 : -2.5,
  };
  result.analysis.periods = [{
    ttm: {
      roe: positive ? 22 : -4,
      roic: positive ? 17 : -2,
      grossMargin: positive ? 42 : 4,
      netMargin: positive ? 18 : -8,
      cashCoverage: positive ? 1.35 : 0.05,
    },
    ttmYoY: {
      revenue: positive ? 28 : -26,
      parentNetProfit: positive ? 38 : -48,
      deductNetProfit: positive ? 34 : -52,
    },
  }];
  return result;
}

function input(positive) {
  return {
    candles,
    indicators,
    currentPrice: candles.at(-1)?.close ?? null,
    intent: {
      score: positive ? 3.2 : -3.2,
      label: positive ? "偏主动拉升（代理）" : "偏主动压制（代理）",
      activeNetRatio: positive ? 24 : -26,
      largeNetRatio: positive ? 20 : -24,
      closeVsVwapPct: positive ? 1.8 : -2,
    },
    financials: financials({ positive }),
    newsItems: Array.from({ length: 6 }, (_, index) => ({
      sentiment: positive ? "正面" : "负面",
      sentimentScore: positive ? 0.72 - index * 0.02 : -0.72 + index * 0.02,
    })),
    risk: {
      annualizedVolatility: positive ? 18 : 72,
      maxDrawdown: positive ? -8 : -48,
      currentDrawdown: positive ? -1 : -22,
      sharpe: positive ? 1.6 : -0.8,
    },
    backtest,
    dataQuality: { ...dataset.quality, duplicateRate: positive ? 0 : 0.09, warnings: positive ? [] : ["异常一", "异常二", "异常三"] },
  };
}

test("builds exactly eight auditable dimensions and separates strong from weak evidence", () => {
  const strong = buildStockScore(input(true));
  const weak = buildStockScore(input(false));

  assert.equal(strong.dimensions.length, 8);
  assert.deepEqual(strong.dimensions.map((item) => item.key), ["trend", "momentum", "capital", "profitability", "growth", "valuation", "sentiment", "risk"]);
  assert.ok(strong.score > weak.score + 25);
  assert.ok(strong.dimensions.every((item) => item.score >= 0 && item.score <= 100));
  assert.ok(strong.dimensions.every((item) => item.reasons.length > 0));
  assert.equal(strong.signal.tone, "buy");
  assert.equal(weak.signal.tone, "sell");
});

test("keeps missing inputs neutral and exposes low coverage", () => {
  const empty = buildStockScore({
    candles: [],
    indicators: calculateIndicators([]),
    currentPrice: null,
    intent: null,
    financials: emptyFinancialDataset(),
    newsItems: [],
    risk: {
      samples: 0,
      totalReturn: null,
      annualizedReturn: null,
      annualizedVolatility: null,
      downsideVolatility: null,
      maxDrawdown: null,
      currentDrawdown: null,
      sharpe: null,
      sortino: null,
      valueAtRisk95: null,
      expectedShortfall95: null,
      benchmarkReturn: null,
      excessReturn: null,
      beta: null,
      alphaAnnualized: null,
      correlation: null,
    },
    backtest: { totalSignals: 0, buySignals: 0, sellSignals: 0, skippedSignals: 0, roundTripCostPct: .25, executionModel: "", horizons: [] },
    dataQuality: { ambiguousDuplicates: 0, duplicateRate: 0, zeroVolumeRows: 0, sideCoverage: 0, dailyContextCoverage: 0, warnings: [] },
  });

  assert.ok(empty.coverage < 35);
  assert.equal(empty.signal.tone, "hold");
  assert.equal(empty.dimensions.find((item) => item.key === "trend")?.score, 50);
});
