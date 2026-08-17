import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildNextDayPrediction } from "../app/lib/nextDayPrediction.ts";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

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
  assert.ok(Math.abs(report.weights.rule + report.weights.analog + report.weights.ml - 1) < 1e-9);
  assert.equal(report.scenarios.length, 3);
  assert.ok(Math.abs(report.scenarios.reduce((sum, scenario) => sum + scenario.probability, 0) - 1) < 1e-9);
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

test("returns no prediction when daily history cannot support labels and indicators", () => {
  assert.equal(buildNextDayPrediction(syntheticCandles(28)), null);
});

test("places next-day analysis directly above the daily B/S backtest and removes the bottom K-line table", () => {
  const workspaceIndex = pageSource.indexOf('<section className="workspace-grid"');
  const predictionIndex = pageSource.indexOf("<NextDayPredictionCard", workspaceIndex);
  const backtestIndex = pageSource.indexOf("<SignalBacktestCard", workspaceIndex);

  assert.ok(workspaceIndex >= 0);
  assert.ok(predictionIndex > workspaceIndex);
  assert.ok(backtestIndex > predictionIndex);
  assert.doesNotMatch(pageSource, /className="recent-card"/);
  assert.doesNotMatch(pageSource, /RECENT BARS|最近 K 线/);
  assert.match(globalStyles, /\.next-day-card\s*\{[^}]*grid-row:\s*4/s);
  assert.match(globalStyles, /\.backtest-card\s*\{[^}]*grid-row:\s*5/s);
});
