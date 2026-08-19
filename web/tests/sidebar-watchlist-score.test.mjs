import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stockSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const globalSource = readFileSync(new URL("../app/global-markets/page.tsx", import.meta.url), "utf8");
const portfolioSource = readFileSync(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8");
const portfolioStyles = readFileSync(new URL("../app/components/PortfolioHome.module.css", import.meta.url), "utf8");
const appleStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");

test("shows live stock and global market summaries at the top of each sidebar", () => {
  assert.match(stockSource, /aria-label="个股实时汇总"/);
  assert.match(stockSource, /实时价格/);
  assert.match(stockSource, /研究评分/);
  assert.match(stockSource, /近期规则证据/);
  assert.match(stockSource, /正向规则/);
  assert.match(stockSource, /风险规则/);
  assert.doesNotMatch(stockSource, /买入信号|卖出信号/);
  assert.match(stockSource, /个股日内行情摘要/);
  assert.match(stockSource, /快速定位/);
  assert.match(globalSource, /aria-label="全球股指实时汇总"/);
  assert.match(globalSource, /市场广度/);
  assert.match(globalSource, /上证指数/);
  assert.match(globalSource, /美股波动/);
  assert.match(globalSource, /波动焦点/);
  assert.match(globalSource, /全球市场覆盖摘要/);
  assert.match(appleStyles, /\.sidebar-preview-card/);
  assert.match(appleStyles, /\.sidebar-preview-strip/);
});

test("calculates watchlist predictions and reveals their detail on hover or focus", () => {
  assert.match(portfolioSource, /score: StockScoreReport \| null/);
  assert.match(portfolioSource, /buildStockScore\(\{/);
  assert.match(portfolioSource, /prediction: NextDayPredictionReport \| null/);
  assert.match(portfolioSource, /buildNextDayPrediction\(candles, \{/);
  assert.match(portfolioSource, /prediction=\{quote\.prediction\}/);
  assert.match(portfolioSource, /scoreReport=\{quote\.score\}/);
  assert.match(portfolioSource, /onMouseEnter=\{showDetails\}/);
  assert.match(portfolioSource, /onFocusCapture=\{showDetails\}/);
  assert.match(portfolioSource, /role="tooltip"/);
  assert.match(portfolioSource, /prediction\.decisionSupport\.checks\.map/);
  assert.match(portfolioStyles, /\.scorePopover \{/);
  assert.match(portfolioStyles, /html\[data-appearance="dark"\]\) \.scorePopover/);
  assert.match(portfolioStyles, /\.predictionMetrics \{/);
});

test("shows four decision-oriented prediction conclusions in every watchlist row", () => {
  assert.match(portfolioSource, /<span>明日预测结论<\/span>/);
  assert.match(portfolioSource, /<option value="signal">证据状态<\/option>/);
  assert.match(portfolioSource, /buildPortfolioPredictionConclusion\(prediction\)/);
  assert.match(portfolioSource, /上涨 \{probabilityPercent\(prediction\.prediction\.upProbability\)\}/);
  assert.doesNotMatch(portfolioSource, /B\/S 建议|模型建议/);
  assert.match(portfolioSource, />完整预测<\/button>/);
  assert.match(portfolioSource, /hasHolding \? "调持仓" : "记持仓"/);
  assert.match(portfolioStyles, /\.signalActions \{/);
  assert.match(portfolioStyles, /\.predictionTakeProfit \.signalMark/);
  assert.match(portfolioStyles, /\.predictionStopLoss \.signalMark/);
});

test("prioritizes decision data and labels estimated daily capital flow", () => {
  assert.match(portfolioSource, /<span>资金净流（本币）<\/span>/);
  assert.match(portfolioSource, /<option value="capital">资金强度（百分比）<\/option>/);
  assert.match(portfolioSource, /activeNetAmount/);
  assert.match(portfolioSource, /formatCapitalAmount\(intent\.activeNetAmount, currency\)/);
  assert.match(portfolioSource, /主动买卖估算/);
  assert.match(portfolioSource, /量价模型估算/);
  assert.match(portfolioSource, /置信 \{intent\.confidence\}%/);
  assert.match(portfolioStyles, /\.capitalCell \{/);
  assert.match(portfolioStyles, /border-radius: 12px;/);
  assert.match(portfolioStyles, /border: 1px solid var\(--portfolio-border-strong\);/);
});
