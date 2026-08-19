import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildPortfolioPredictionConclusion } from "../app/lib/portfolioPrediction.ts";

const portfolioSource = readFileSync(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8");

test("maps detailed model decisions to the four portfolio actions", () => {
  const cases = [
    ["持有观察", "持有", "hold"],
    ["等待确认", "持有", "hold"],
    ["降低仓位", "减仓", "reduce"],
    ["分批止盈", "止盈", "takeProfit"],
    ["收紧止损", "止损", "stopLoss"],
  ];

  for (const [sourceAction, action, tone] of cases) {
    const conclusion = buildPortfolioPredictionConclusion({ decisionSupport: { action: sourceAction } });
    assert.equal(conclusion.action, action);
    assert.equal(conclusion.tone, tone);
  }
});

test("portfolio rows calculate tomorrow prediction with market and news context", () => {
  assert.match(portfolioSource, /<span>明日预测结论<\/span>/);
  assert.match(portfolioSource, /buildNextDayPrediction\(candles, \{/);
  assert.match(portfolioSource, /mode: "tomorrow"/);
  assert.match(portfolioSource, /benchmarkCandles: benchmark\?\.candles \?\? \[\]/);
  assert.match(portfolioSource, /newsItems,/);
  assert.match(portfolioSource, /上涨 \{probabilityPercent\(prediction\.prediction\.upProbability\)\}/);
});
