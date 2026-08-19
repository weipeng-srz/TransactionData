import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildNextDayPrediction } from "../app/lib/nextDayPrediction.ts";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const cardSource = readFileSync(new URL("../app/components/NextDayPredictionCard.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const appleRefinementStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");

function syntheticCandles(count = 320) {
  const candles = [];
  let previousClose = 42;
  for (let index = 0; index < count; index += 1) {
    const cycle = Math.sin(index / 7) * 0.018 + Math.cos(index / 19) * 0.009;
    const drift = index % 11 === 0 ? -0.022 : 0.0018;
    const open = previousClose * (1 + Math.sin(index * 1.7) * 0.004);
    const close = previousClose * (1 + cycle + drift);
    const high = Math.max(open, close) * (1.008 + (index % 5) * 0.0015);
    const low = Math.min(open, close) * (0.992 - (index % 3) * 0.001);
    const volume = 8_000_000 * (0.76 + (index % 17) / 22 + Math.abs(cycle) * 6);
    candles.push({
      key: `2025-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`,
      label: `D${index}`,
      date: `2025-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`,
      time: "",
      open,
      high,
      low,
      close,
      volume,
      amount: close * volume,
      adjustedAmount: close * volume,
      vwap: (open + high + low + close) / 4,
      turnoverPct: 1.2,
      change: close - previousClose,
      changePct: (close / previousClose - 1) * 100,
    });
    previousClose = close;
  }
  return candles;
}

test("combines rules, analogs and walk-forward validation without leaking beyond the selected window", () => {
  const report = buildNextDayPrediction(syntheticCandles(), { window: 126, neighbors: 15 });

  assert.ok(report);
  assert.equal(report.analysisWindow, 126);
  assert.equal(report.similarDays.count, 15);
  assert.ok(report.trainingSamples <= 126);
  assert.ok(report.trainingSamples >= 100);
  assert.ok(report.prediction.upProbability >= 0 && report.prediction.upProbability <= 1);
  assert.ok(report.volumePrediction.volumeUpProbability >= 0 && report.volumePrediction.volumeUpProbability <= 1);
  assert.ok(report.prediction.expectedLowReturn <= report.prediction.expectedOpenGap);
  assert.ok(report.prediction.expectedHighReturn >= report.prediction.expectedOpenGap);
  assert.ok(report.prediction.q25 <= report.prediction.median);
  assert.ok(report.prediction.median <= report.prediction.q75);
  assert.equal(report.distribution.reduce((sum, item) => sum + item.count, 0), 15);
  assert.ok(Math.abs(report.weights.rule + report.weights.analog + report.weights.ml + report.weights.panel - 1) < 1e-9);
  assert.equal(report.modelValidation.panelEnabled, false);
  assert.equal(report.weights.panel, 0);
  assert.equal(report.scenarios.length, 3);
  assert.ok(Math.abs(report.scenarios.reduce((sum, scenario) => sum + scenario.probability, 0) - 1) < 1e-9);
  assert.ok(report.signal.dataSufficiency >= 30 && report.signal.dataSufficiency <= 90);
  assert.ok(report.similarDays.upRateInterval95[0] <= report.similarDays.upRate);
  assert.ok(report.similarDays.upRateInterval95[1] >= report.similarDays.upRate);
  assert.ok(report.modelValidation.brierScore == null || report.modelValidation.brierScore >= 0);
  assert.ok(report.modelValidation.baselineBrierScore == null || report.modelValidation.baselineBrierScore >= 0);
  if (report.modelValidation.mlEnabled) assert.ok(report.modelValidation.brierScore < report.modelValidation.baselineBrierScore);
});

test("adapts sample and neighbor counts to shorter histories", () => {
  const report = buildNextDayPrediction(syntheticCandles(78), { window: 60, neighbors: 30 });

  assert.ok(report);
  assert.equal(report.analysisWindow, 60);
  assert.equal(report.similarDays.count, 30);
  assert.ok(report.trainingSamples <= 60);
  assert.ok(report.modelValidation.validationSamples >= 0);
  assert.ok(Number.isFinite(report.volumePrediction.expectedVolume));
});

test("keeps today mode leakage-free and lets tomorrow mode use the current partial session", () => {
  const candles = syntheticCandles();
  const previousClose = candles.at(-1).close;
  const snapshot = {
    code: "600000",
    name: "测试股票",
    date: "2025-12-13",
    time: "10:30:00",
    marketStatus: "交易中",
    price: previousClose * 1.024,
    previousClose,
    open: previousClose * 1.006,
    high: previousClose * 1.031,
    low: previousClose * 0.998,
    change: previousClose * 0.024,
    changePct: 2.4,
    volume: 3_600_000,
    amount: 3_600_000 * previousClose * 1.018,
    bids: [],
    asks: [],
    minuteCandles: [],
    source: "test",
    fetchedAt: "2025-12-13T02:30:00.000Z",
  };
  const changedSnapshot = { ...snapshot, price: previousClose * 0.94, low: previousClose * 0.92, changePct: -6 };
  const today = buildNextDayPrediction(candles, { mode: "today", realtimeSnapshot: snapshot, market: "CN" });
  const changedToday = buildNextDayPrediction(candles, { mode: "today", realtimeSnapshot: changedSnapshot, market: "CN" });
  const tomorrow = buildNextDayPrediction(candles, { mode: "tomorrow", realtimeSnapshot: snapshot, market: "CN" });

  assert.ok(today && changedToday && tomorrow);
  assert.equal(today.asOf, candles.at(-1).date);
  assert.equal(today.target.date, snapshot.date);
  assert.equal(today.target.usesCurrentSession, false);
  assert.equal(today.prediction.upProbability, changedToday.prediction.upProbability);
  assert.equal(today.technicalState.return1d, changedToday.technicalState.return1d);
  assert.equal(tomorrow.asOf, snapshot.date);
  assert.equal(tomorrow.target.usesCurrentSession, true);
  assert.equal(tomorrow.target.isPartialSession, true);
  assert.ok(tomorrow.target.sessionProgress > 0 && tomorrow.target.sessionProgress < 1);
  assert.equal(tomorrow.trainingSamples, today.trainingSamples);
  assert.ok(Math.abs(tomorrow.technicalState.return1d - 0.024) < 1e-9);
  assert.equal(tomorrow.volumePrediction.currentVolume, snapshot.volume);
});

test("integrates same-market history and only news available at the prediction cutoff", () => {
  const candles = syntheticCandles();
  const benchmarkCandles = syntheticCandles(321).map((candle) => ({
    ...candle,
    open: candle.open * 90,
    high: candle.high * 90,
    low: candle.low * 90,
    close: candle.close * 90,
  }));
  const previousClose = candles.at(-1).close;
  const realtimeSnapshot = {
    code: "600000", name: "测试股票", date: "2025-12-13", time: "14:00:00", marketStatus: "交易中",
    price: previousClose * 1.01, previousClose, open: previousClose, high: previousClose * 1.02, low: previousClose * 0.99,
    change: previousClose * 0.01, changePct: 1, volume: 7_000_000, amount: 7_000_000 * previousClose,
    bids: [], asks: [], minuteCandles: [], source: "test", fetchedAt: "2025-12-13T06:00:00.000Z",
  };
  const newsItems = [{
    code: "600000", stockName: "测试股票", portal: "财经", channel: "股票", media: "测试媒体",
    publishedAt: "2025-12-13 09:00:00", relevance: 0.95, sentiment: "正面", sentimentScore: 0.9,
    positiveTerms: ["增长"], negativeTerms: [], title: "测试利好", summary: "", url: "https://example.com/a", fetchedAt: "2025-12-13T09:10:00Z",
  }];
  const today = buildNextDayPrediction(candles, { mode: "today", realtimeSnapshot, benchmarkCandles, benchmarkName: "沪深300", newsItems });
  const tomorrow = buildNextDayPrediction(candles, { mode: "tomorrow", realtimeSnapshot, benchmarkCandles, benchmarkName: "沪深300", newsItems });

  assert.ok(today && tomorrow);
  assert.equal(today.externalContext.news.itemCount, 0);
  assert.equal(today.prediction.contextAdjustment, 0);
  assert.equal(today.modelValidation.panelEnabled, true);
  assert.equal(today.modelValidation.panelWeight, 0.75);
  assert.ok(today.modelValidation.panelProbability > 0 && today.modelValidation.panelProbability < 1);
  assert.ok(Number.isFinite(today.modelValidation.regimeLogitAdjustment));
  assert.equal(tomorrow.modelValidation.panelEnabled, false);
  assert.equal(tomorrow.modelValidation.regimeLogitAdjustment, 0);
  assert.equal(tomorrow.externalContext.market.available, true);
  assert.equal(tomorrow.externalContext.market.name, "沪深300");
  assert.equal(tomorrow.externalContext.market.fresh, true);
  assert.equal(tomorrow.externalContext.news.itemCount, 1);
  assert.ok(tomorrow.prediction.contextAdjustment > 0 && tomorrow.prediction.contextAdjustment <= 0.05);
  assert.ok(tomorrow.signal.decisionConfidence >= 20 && tomorrow.signal.decisionConfidence <= 88);
  assert.equal(tomorrow.modelValidation.version, "ensemble-v2.2-regime");
});

test("returns no prediction when daily history cannot support labels and indicators", () => {
  assert.equal(buildNextDayPrediction(syntheticCandles(28)), null);
});

test("keeps next-day analysis independent and directly after the daily B/S backtest", () => {
  const workspaceIndex = pageSource.indexOf('<section className="workspace-grid"');
  const analysisRailIndex = pageSource.indexOf("<aside", workspaceIndex);
  const backtestIndex = pageSource.indexOf("<SignalBacktestCard", workspaceIndex);
  const analysisRailEndIndex = pageSource.indexOf("</aside>", backtestIndex);
  const workspaceEndIndex = pageSource.indexOf("</section>", analysisRailEndIndex);
  const predictionIndex = pageSource.indexOf("<NextDayPredictionCard", workspaceIndex);

  assert.ok(workspaceIndex >= 0);
  assert.ok(analysisRailIndex > workspaceIndex);
  assert.ok(backtestIndex > analysisRailIndex);
  assert.ok(analysisRailEndIndex > backtestIndex);
  assert.ok(workspaceEndIndex > analysisRailEndIndex);
  assert.ok(predictionIndex > workspaceEndIndex);
  assert.doesNotMatch(pageSource, /className="recent-card"/);
  assert.doesNotMatch(pageSource, /RECENT BARS|最近 K 线/);
  assert.match(globalStyles, /\.backtest-card\s*\{[^}]*grid-row:\s*4/s);
  assert.doesNotMatch(globalStyles, /\.next-day-card\s*\{[^}]*grid-row:/s);
});

test("uses the shared card theme without the prediction grid overlay", () => {
  assert.match(appleRefinementStyles, /\.next-day-card\s*\{[^}]*border:\s*1px solid var\(--apple-border\)[^}]*background:\s*var\(--apple-surface\)[^}]*box-shadow:\s*var\(--apple-shadow-card\)/s);
  assert.match(appleRefinementStyles, /\.next-day-card\s*\{[^}]*margin-top:\s*var\(--section-gap\)/s);
  assert.match(appleRefinementStyles, /\.next-day-card::before\s*\{[^}]*display:\s*none/s);
  assert.match(appleRefinementStyles, /\.next-day-grade,[\s\S]*?background:\s*color-mix\(in srgb, var\(--apple-surface-soft\) 78%, transparent\)/);
});

test("describes prediction quality without presenting heuristic sufficiency as certainty", () => {
  assert.match(cardSource, /统计今日 \/ 明日概率实验/);
  assert.match(cardSource, /数据充分度/);
  assert.match(cardSource, /决策可信度/);
  assert.match(cardSource, /Brier Score/);
  assert.match(cardSource, /相似日胜率 95% 区间/);
  assert.match(cardSource, /预测今日/);
  assert.match(cardSource, /预测明日/);
  assert.match(cardSource, /大盘与消息面验证/);
  assert.match(cardSource, /仓位与退出纪律/);
  assert.doesNotMatch(cardSource, /分析置信度|AI 隔日交易概率分析/);
});

test("keeps scenario cards clear of the preceding divider in every style layer", () => {
  for (const source of [globalStyles, appleRefinementStyles]) {
    const rules = [...source.matchAll(/\.next-day-scenarios\s*\{([^}]*)\}/gs)];
    assert.ok(rules.length > 0);
    for (const [, declarations] of rules) {
      assert.doesNotMatch(declarations, /padding:\s*0(?:\s|;)/);
    }
  }

  assert.match(appleRefinementStyles, /\.next-day-scenarios\s*\{[^}]*padding:\s*18px 20px/s);
  assert.match(appleRefinementStyles, /\.next-day-similar-table,\s*\.next-day-method\s*\{[^}]*margin:\s*0 20px 18px/s);
  assert.match(appleRefinementStyles, /@media \(max-width: 560px\)[\s\S]*?\.next-day-scenarios\s*\{[^}]*padding:\s*15px/s);
  assert.match(appleRefinementStyles, /@media \(max-width: 560px\)[\s\S]*?\.next-day-similar-table,\s*\.next-day-method\s*\{[^}]*margin:\s*0 15px 15px/s);
});

test("keeps the position decision card clear of the prediction hero divider", () => {
  assert.match(globalStyles, /\.next-day-decision\s*\{[^}]*margin:\s*18px 22px 0/s);
  assert.match(appleRefinementStyles, /\.next-day-decision\s*\{[^}]*margin:\s*18px 20px 0/s);
  assert.match(appleRefinementStyles, /@media \(max-width: 560px\)[\s\S]*?\.next-day-decision\s*\{[^}]*margin:\s*15px 15px 0/s);
});
