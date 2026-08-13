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
  assert.match(stockSource, /最新 B\/S/);
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

test("calculates watchlist scores and reveals their detail on hover or focus", () => {
  assert.match(portfolioSource, /score: StockScoreReport \| null/);
  assert.match(portfolioSource, /buildStockScore\(\{/);
  assert.match(portfolioSource, /<WatchlistScoreBadge report=\{quote\.score\}/);
  assert.match(portfolioSource, /onMouseEnter=\{showDetails\}/);
  assert.match(portfolioSource, /onFocusCapture=\{showDetails\}/);
  assert.match(portfolioSource, /role="tooltip"/);
  assert.match(portfolioSource, /report\.dimensions\.map/);
  assert.match(portfolioStyles, /\.scorePopover \{/);
  assert.match(portfolioStyles, /html\[data-appearance="dark"\]\) \.scorePopover/);
  assert.match(portfolioStyles, /\.scoreDimensions \{/);
});

test("shows actionable B/S suggestions in every watchlist row", () => {
  assert.match(portfolioSource, /<span>B\/S 建议<\/span>/);
  assert.match(portfolioSource, /<option value="signal">B\/S 建议<\/option>/);
  assert.match(portfolioSource, /signalMark = tone === "buy" \? "B" : tone === "sell" \? "S" : "—"/);
  assert.match(portfolioSource, />查看依据<\/button>/);
  assert.match(portfolioSource, /hasHolding \? "调持仓" : "记持仓"/);
  assert.match(portfolioStyles, /\.signalActions \{/);
  assert.match(portfolioStyles, /\.scoreBuy \.signalMark/);
  assert.match(portfolioStyles, /\.scoreSell \.signalMark/);
});

test("prioritizes decision data and labels estimated daily capital flow", () => {
  assert.match(portfolioSource, /<span>资金净流<\/span>/);
  assert.match(portfolioSource, /<option value="capital">资金净流<\/option>/);
  assert.match(portfolioSource, /activeNetAmount/);
  assert.match(portfolioSource, /主动买卖估算/);
  assert.match(portfolioSource, /量价模型估算/);
  assert.match(portfolioSource, /置信 \{intent\.confidence\}%/);
  assert.match(portfolioStyles, /\.capitalCell \{/);
  assert.match(portfolioStyles, /border-radius: 12px;/);
  assert.match(portfolioStyles, /border: 1px solid var\(--portfolio-border-strong\);/);
});
