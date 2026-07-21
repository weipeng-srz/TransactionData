import assert from "node:assert/strict";
import test from "node:test";

import {
  backtestGuideSignals,
  buildChartEvents,
  calculateRiskMetrics,
  evaluatePriceAlerts,
  parsePriceAlerts,
  parseWatchlist,
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

test("builds news, report and dividend events for the selected stock", () => {
  const events = buildChartEvents([
    { code: "000001", stockName: "平安银行", portal: "", channel: "", media: "", publishedAt: "2026-06-10 09:00", relevance: 1, sentiment: "正面", sentimentScore: 0.5, positiveTerms: [], negativeTerms: [], title: "测试新闻", summary: "", url: "https://example.com", fetchedAt: "" },
  ], {
    code: "000001",
    name: "平安银行",
    reports: [{ reportDate: "2026-03-31", noticeDate: "2026-04-20", periodLabel: "2026一季报", reportType: "定期报告", revenue: 1, revenueYoY: 2, netProfit: 1, netProfitYoY: 3, basicEps: null, bookValuePerShare: null, operatingCashFlowPerShare: null, roe: null, roa: null, grossMargin: null, netMargin: null, debtAssetRatio: null }],
    snapshot: { asOfDate: "", industry: "", closePrice: null, totalMarketCap: null, floatMarketCap: null, totalShares: null, peTtm: null, peStatic: null, pb: null, psTtm: null, pcfTtm: null, peg: null, dividendYieldTtm: null, cashDividendPerShareTtm: null, dividendPaymentsTtm: 0, latestDividendProfile: "10派1元", latestDividendDate: "2026-05-20" },
    analysis: { periods: [], latestReportDate: "", sourceScope: "" }, source: "测试", fetchedAt: "",
  }, "000001");
  assert.deepEqual(events.map((event) => event.kind), ["report", "dividend", "news"]);
});

test("validates persisted watchlist and price alerts before use", () => {
  const watchlist = parseWatchlist([{ code: "000001", name: "平安银行", price: "12.3" }, { code: "bad", name: "坏数据" }]);
  assert.equal(watchlist.length, 1);
  assert.equal(watchlist[0].price, 12.3);

  const alerts = parsePriceAlerts([{ id: "a", code: "000001", name: "平安银行", direction: "above", target: 12, createdAt: "", triggeredAt: "" }]);
  const checked = evaluatePriceAlerts(alerts, "000001", 12.5, "2026-07-20T12:00:00.000Z");
  assert.equal(checked[0].triggeredAt, "2026-07-20T12:00:00.000Z");
});
