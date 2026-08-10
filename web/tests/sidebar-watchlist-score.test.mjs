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
  assert.match(globalSource, /aria-label="全球股指实时汇总"/);
  assert.match(globalSource, /市场广度/);
  assert.match(globalSource, /上证指数/);
  assert.match(globalSource, /美股波动/);
  assert.match(globalSource, /波动焦点/);
  assert.match(appleStyles, /\.sidebar-snapshot-grid \{/);
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
