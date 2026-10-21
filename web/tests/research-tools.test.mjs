import assert from "node:assert/strict";
import test from "node:test";

import {
  backtestGuideSignals,
  buildChartEvents,
  calculateRiskMetrics,
  estimateLiquidityRoundTripCostPct,
  resolveCnPriceLimitPct,
} from "../app/lib/research.ts";

const candles = Array.from({ length: 30 }, (_, index) => ({
  key: `2026-06-${String(index + 1).padStart(2, "0")}`,
  label: `06-${String(index + 1).padStart(2, "0")}`,
  date: `2026-06-${String(index + 1).padStart(2, "0")}`,
  time: "",
  open: 10 + index,
  high: 10.2 + index,
  low: 9.8 + index,
  close: 10 + index,
  volume: 1000,
  amount: 10000,
  adjustedAmount: 10000,
  vwap: 10 + index,
  turnoverPct: 0.1,
  change: index ? 1 : 0,
  changePct: index ? 100 / (9 + index) : 0,
}));

const emptyNumbers = () => Array(candles.length).fill(0);
const emptyNullable = () => Array(candles.length).fill(null);
const guidePoints = Array(candles.length).fill(null);
guidePoints[2] = { type: "buy", score: 3, reasons: ["测试"] };
guidePoints[4] = { type: "buy", score: 2, reasons: ["连续同向信号"] };
guidePoints[7] = { type: "buy", score: 2, reasons: ["弱B观察"], confidence: "watch" };
guidePoints[10] = { type: "sell", score: 3, reasons: ["测试"] };
const indicators = {
  ma5: emptyNullable(), ma10: emptyNullable(), ma20: emptyNullable(),
  ema12: emptyNumbers(), ema26: emptyNumbers(), bollUpper: emptyNullable(), bollMid: emptyNullable(), bollLower: emptyNullable(),
  macdDif: emptyNumbers(), macdDea: emptyNumbers(), macdHist: emptyNumbers(), rsi: emptyNullable(),
  k: emptyNumbers(), d: emptyNumbers(), j: emptyNumbers(), vwap: emptyNumbers(), volumeMa5: emptyNullable(), volumeMa10: emptyNullable(),
  atr14: emptyNullable(), nineTurn: Array(candles.length).fill(null), guidePoints,
};

test("backtests de-duplicated B/S guide signals across multiple horizons", () => {
  const result = backtestGuideSignals(candles, indicators);
  assert.equal(result.totalSignals, 2);
  assert.equal(result.buySignals, 1);
  assert.equal(result.sellSignals, 1);
  assert.equal(result.horizons[0].samples, 2);
  assert.equal(result.horizons[0].winRate, 50);
  assert.ok(result.horizons[0].worstAdverseMove < 0);
  assert.equal(result.horizons[2].samples, 1);
  assert.match(result.executionModel, /后一根K线开盘/);
  assert.equal(result.roundTripCostPct, 0.25);
  assert.ok(result.horizons[0].winRateLow <= result.horizons[0].winRate);
  assert.ok(result.horizons[0].winRateHigh >= result.horizons[0].winRate);
  assert.equal(result.directions.buy.signalCount, 1);
  assert.equal(result.directions.sell.signalCount, 1);
  assert.equal(result.directions.buy.tradable, true);
  assert.equal(result.directions.sell.tradable, false);
  assert.ok(result.recent.label);
});

test("uses board-aware price limits and liquidity-sensitive transaction costs", () => {
  assert.equal(resolveCnPriceLimitPct("600000", "2026-08-01"), 9.8);
  assert.equal(resolveCnPriceLimitPct("300001", "2026-08-01"), 19.8);
  assert.equal(resolveCnPriceLimitPct("300001", "2020-08-01"), 9.8);
  assert.equal(resolveCnPriceLimitPct("688001", "2026-08-01"), 19.8);
  assert.equal(resolveCnPriceLimitPct("830001", "2026-08-01"), 29.8);
  assert.equal(resolveCnPriceLimitPct("600000", "2025-08-01", "*ST测试"), 4.8);

  const liquid = { ...candles[0], amount: 1_000_000_000, adjustedAmount: 1_000_000_000 };
  const illiquid = { ...candles[0], amount: 5_000_000, adjustedAmount: 5_000_000 };
  assert.ok(estimateLiquidityRoundTripCostPct(illiquid, 80_000, 0.25) > estimateLiquidityRoundTripCostPct(liquid, 80_000, 0.25));

  const result = backtestGuideSignals(candles, indicators, [5], {
    code: "300001",
    market: "CN",
    costModel: "liquidity",
    positionValue: 80_000,
  });
  assert.equal(result.costModel, "liquidity");
  assert.ok((result.directions.buy.horizons[0].averageCostPct ?? 0) > 0.25);
});

test("calculates portfolio-style risk and benchmark-relative metrics", () => {
  const benchmark = candles.map((candle, index) => ({ ...candle, close: 10 + index * 0.5 }));
  const risk = calculateRiskMetrics(candles, benchmark);
  assert.ok(risk.totalReturn > 0);
  assert.ok(risk.annualizedVolatility >= 0);
  assert.ok(risk.maxDrawdown <= 0);
  assert.ok(risk.excessReturn > 0);
  assert.ok(risk.beta != null);
});

function riskSeries(prices) {
  return prices.map(([date, close]) => ({ ...candles[0], key: date, date, close }));
}

test("compares stock and benchmark returns over their common dates", () => {
  const stock = riskSeries([["2024-01-03", 100], ["2024-01-04", 110], ["2024-01-05", 121]]);
  const benchmark = riskSeries([["2024-01-01", 50], ["2024-01-02", 80], ["2024-01-03", 100], ["2024-01-04", 110], ["2024-01-05", 121], ["2024-01-06", 150]]);
  const risk = calculateRiskMetrics(stock, benchmark);
  assert.ok(Math.abs(risk.totalReturn - 21) < 1e-9);
  assert.ok(Math.abs(risk.benchmarkReturn - 21) < 1e-9);
  assert.ok(Math.abs(risk.excessReturn) < 1e-9);
});

test("uses matched stock returns for excess return and alpha when the benchmark is shorter", () => {
  const stock = riskSeries([["2024-01-01", 50], ["2024-01-02", 100], ["2024-01-03", 110], ["2024-01-04", 104.5], ["2024-01-05", 125.4], ["2024-01-06", 150]]);
  const risk = calculateRiskMetrics(stock, stock.slice(1, -1));
  assert.equal(risk.totalReturn, 200, "standalone stock return keeps the full history");
  assert.ok(Math.abs(risk.benchmarkReturn - 25.4) < 1e-9);
  assert.ok(Math.abs(risk.excessReturn) < 1e-9);
  assert.ok(Math.abs(risk.beta - 1) < 1e-9);
  assert.ok(Math.abs(risk.alphaAnnualized) < 1e-9);
  assert.ok(Math.abs(risk.correlation - 1) < 1e-9);
});

test("returns unavailable relative metrics when there is no shared period", () => {
  const stock = riskSeries([["2024-01-03", 100], ["2024-01-04", 110]]);
  for (const benchmark of [[], riskSeries([["2024-01-01", 10], ["2024-01-02", 20]]), riskSeries([["2024-01-02", 20], ["2024-01-03", 100]])]) {
    const risk = calculateRiskMetrics(stock, benchmark);
    assert.ok(risk.totalReturn > 0);
    for (const key of ["benchmarkReturn", "excessReturn", "beta", "alphaAnnualized", "correlation"]) assert.equal(risk[key], null, key);
  }
});

test("matches both interval dates for beta across stock trading gaps", () => {
  const benchmark = riskSeries([["2024-01-01", 100], ["2024-01-02", 115], ["2024-01-03", 121], ["2024-01-04", 115], ["2024-01-05", 130], ["2024-01-06", 126]]);
  const stock = benchmark.filter((candle) => ["2024-01-01", "2024-01-03", "2024-01-04", "2024-01-06"].includes(candle.date));
  const risk = calculateRiskMetrics(stock, benchmark);
  assert.ok(Math.abs(risk.beta - 1) < 1e-9);
  assert.ok(Math.abs(risk.alphaAnnualized) < 1e-9);
  assert.ok(Math.abs(risk.correlation - 1) < 1e-9);
});

test("does not substitute a different benchmark start date when an endpoint is missing", () => {
  const stock = riskSeries([["2024-01-01", 100], ["2024-01-02", 110], ["2024-01-03", 120], ["2024-01-04", 130], ["2024-01-05", 125]]);
  const benchmark = stock.filter((candle) => candle.date !== "2024-01-02");
  const risk = calculateRiskMetrics(stock, benchmark);
  assert.ok(Math.abs(risk.beta - 1) < 1e-9);
  assert.ok(Math.abs(risk.alphaAnnualized) < 1e-9);
  assert.equal(risk.correlation, null, "only two complete return intervals remain");
});

test("builds news, report and dividend events for the selected stock", () => {
  const events = buildChartEvents([
    { code: "000001", stockName: "平安银行", portal: "", channel: "", media: "", publishedAt: "2026-06-10 09:00", relevance: 1, sentiment: "正面", sentimentScore: 0.5, positiveTerms: [], negativeTerms: [], title: "测试新闻", summary: "", url: "https://example.com", fetchedAt: "" },
  ], {
    code: "000001",
    name: "平安银行",
    reports: [{ reportDate: "2026-03-31", noticeDate: "2026-04-20", periodLabel: "2026一季报", reportType: "定期报告", revenue: 1, revenueYoY: 2, netProfit: 1, netProfitYoY: 3, basicEps: null, bookValuePerShare: null, operatingCashFlowPerShare: null, roe: null, roa: null, grossMargin: null, netMargin: null, debtAssetRatio: null }],
    snapshot: { asOfDate: "", industry: "", closePrice: null, totalMarketCap: null, floatMarketCap: null, totalShares: null, peTtm: null, peStatic: null, pb: null, psTtm: null, pcfTtm: null, peg: null, dividendYieldTtm: null, cashDividendPerShareTtm: null, dividendPaymentsTtm: 0, latestDividendProfile: "10派1元", latestDividendDate: "2026-05-20" },
    holderStructure: { asOfDate: "", reportLabel: "", institutionalRatio: null, retailProxyRatio: null, previousInstitutionalRatio: null, institutionalChangePp: null, topThreeInstitutionalRatio: null, institutionCount: 0, topInstitutions: [], analysis: "" },
    analysis: { periods: [], latestReportDate: "", sourceScope: "" }, source: "测试", fetchedAt: "",
  }, "000001");
  assert.deepEqual(events.map((event) => event.kind), ["report", "dividend", "news"]);
});
