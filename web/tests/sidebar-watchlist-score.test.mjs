import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stockSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const stockHeader = readFileSync(new URL("../app/components/StockWorkspaceHeader.tsx", import.meta.url), "utf8");
const globalSource = readFileSync(new URL("../app/global-markets/page.tsx", import.meta.url), "utf8");
const globalOverview = readFileSync(new URL("../app/features/global-markets/MarketOverview.tsx", import.meta.url), "utf8");
const portfolioSource = ["../app/components/PortfolioHome.tsx", "../app/features/portfolio/PortfolioStockList.tsx", "../app/features/portfolio/types.ts"]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
const portfolioStyles = ["../app/components/PortfolioHome.module.css", "../app/features/portfolio/PortfolioStockList.module.css"]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
const stockStyles = readFileSync(new URL("../app/components/StockWorkspace.module.css", import.meta.url), "utf8");
const appleStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");

test("shows one stock quote header and retains global market summary coverage", () => {
  assert.match(stockHeader, /aria-label="个股实时汇总"/);
  assert.match(stockHeader, /aria-label="个股日内行情摘要"/);
  assert.match(stockSource, /研究评分/);
  assert.match(stockSource, /近期规则证据/);
  assert.match(stockSource, /正向规则/);
  assert.match(stockSource, /风险规则/);
  assert.doesNotMatch(stockSource, /买入信号|卖出信号/);
  for (const label of ["开盘", "最高", "最低", "成交量", "成交额", "换手率"]) {
    assert.match(stockSource, new RegExp(`label: "${label}"`));
  }
  assert.match(stockSource, /liveQuote\?\.amount \?\? latestDaily\?\.amount/);
  assert.match(stockSource, /latestDaily\?\.turnoverPct/);
  assert.match(stockSource, /label="个股研究视图"/);
  assert.doesNotMatch(stockSource, /className="app-sidebar research-sidebar"/);
  assert.equal((globalSource.match(/<MarketOverview/g) ?? []).length, 1);
  assert.doesNotMatch(globalSource, /global-sidebar-summary/);
  assert.match(globalOverview, /aria-label="全球股指实时汇总"/);
  for (const label of ["当前开市广度", "上证指数", "美股波动", "波动焦点", "覆盖指数"]) assert.match(globalOverview, new RegExp(label));
  assert.doesNotMatch(appleStyles, /\.sidebar-preview-(?:card|strip)/);
  assert.match(stockStyles, /\.quoteStats \{[^}]*flex-wrap: wrap/);
  assert.match(stockStyles, /@media \(max-width: 620px\)[\s\S]*?\.quoteStats \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
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
