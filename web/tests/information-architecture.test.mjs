import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appleStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");
const stockSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const portfolioSource = readFileSync(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8");
const workbenchSource = readFileSync(new URL("../app/components/PortfolioWorkbenchSummary.tsx", import.meta.url), "utf8");
const financialSource = readFileSync(new URL("../app/components/FinancialDashboard.tsx", import.meta.url), "utf8");
const globalSource = readFileSync(new URL("../app/global-markets/page.tsx", import.meta.url), "utf8");
const screenerSource = readFileSync(new URL("../app/screener/page.tsx", import.meta.url), "utf8");
const screenerStyles = readFileSync(new URL("../app/screener/screener.module.css", import.meta.url), "utf8");

test("uses one Apple-style mobile chapter control without removing desktop content", () => {
  assert.match(appleStyles, /\.platform-mobile-chapter \{ display: contents; \}/);
  assert.match(appleStyles, /@media \(max-width: 820px\)[\s\S]*\.platform-mobile-chapter\[data-active="false"\][\s\S]*display: none !important/);
  assert.match(appleStyles, /\.platform-mobile-section-nav button\[aria-pressed="true"\]/);
  assert.match(appleStyles, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*\.platform-mobile-section-nav/);
  assert.match(appleStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.platform-mobile-section-nav button/);
});

test("portfolio defaults to watchlist and keeps independent holdings and earnings collection", () => {
  assert.match(portfolioSource, /useWorkspaceView\(portfolioViews, "watchlist"/);
  assert.match(portfolioSource, /label="工作台视图"/);
  for (const view of ["watchlist", "holdings", "earnings", "review"]) assert.match(portfolioSource, new RegExp(`id: "${view}"`));
  assert.match(portfolioSource, /usePortfolioEarningsRecorder\(holdings, quotes, hydrated\)/);
  assert.match(portfolioSource, /portfolioStocks.filter\(\(stock\) => holdings\[stockStorageKey\(stock\)\]\)/);
  assert.match(workbenchSource, /aria-label="决策工作台信息分组"/);
});

test("stock research keeps all six views mounted and reachable in both depth modes", () => {
  assert.match(stockSource, /useWorkspaceView\(stockViews, "overview", "tab"/);
  assert.match(stockSource, /label="个股研究视图"/);
  for (const view of ["overview", "market", "financials", "news", "models", "notes"]) assert.match(stockSource, new RegExp(`view="${view}" active=\{stockView\}`));
  for (const component of ["RealtimeTradingPanel", "NextDayPredictionCard", "StockReviewEntry", "AdvancedResearch", "SignalBacktestCard"]) {
    assert.match(stockSource, new RegExp(`<${component}`));
    assert.doesNotMatch(stockSource, new RegExp(`viewMode === "pro" \\? <${component}`));
  }
});

test("financial views are reachable at every viewport and evidence reveals its owning view", () => {
  assert.match(financialSource, /useWorkspaceView\(financialViews, "summary", "finance"/);
  assert.match(financialSource, /label="财务信息分组"/);
  for (const view of ["summary", "trends", "details"]) assert.match(financialSource, new RegExp(`view="${view}" active=\{financialView\}`));
  assert.match(financialSource, /setFinancialView\(item.target === "finance-valuation" \? "summary" : "trends"\)/);
  assert.match(financialSource, /requestAnimationFrame/);
});

test("global markets shares four persistent views across screen sizes", () => {
  assert.match(globalSource, /useWorkspaceView\(globalViews, "overview", "view", globalAnchors\)/);
  assert.match(globalSource, /label="全球市场视图"/);
  for (const view of ["overview", "regions", "trend", "map"]) assert.match(globalSource, new RegExp(`view="${view}" active=\\{globalView\\}`));
  assert.doesNotMatch(globalSource, /mobileChapter|platform-mobile-(chapter|visibility)/);
});

test("screener keeps the full desktop table and batches only mobile candidate cards", () => {
  assert.match(screenerSource, /useWorkspaceView\(screenerViews, "candidates", "view", screenerAnchors\)/);
  for (const view of ["candidates", "pool", "evidence"]) assert.match(screenerSource, new RegExp(`view="${view}" active=\\{screenerView\\}`));
  assert.doesNotMatch(screenerSource, /platform-mobile-(chapter|visibility|section-nav)/);
  assert.match(screenerSource, /const mobileVisibleStocks = visibleStocks\.slice\(0, mobileVisibleStockCount\)/);
  assert.match(screenerSource, /<tbody>\{visibleStocks\.map/);
  assert.match(screenerSource, /\{mobileVisibleStocks\.map/);
  assert.match(screenerSource, /再显示 \{Math\.min\(4, visibleStocks\.length - mobileVisibleStocks\.length\)\} 只/);
  assert.match(screenerStyles, /\.mobilePoolPager \{ display: none; \}/);
  assert.match(screenerStyles, /@media \(max-width: 760px\)[\s\S]*\.mobilePoolPager \{[\s\S]*display: flex;/);
});

test("screener keeps the decision path compact and progressively reveals secondary controls", () => {
  assert.match(screenerSource, /<h1>智能选股<\/h1>/);
  assert.doesNotMatch(screenerSource, /<h1 id="screener-title">/);
  assert.match(screenerSource, /className=\{styles\.commandBar\}[\s\S]*aria-label="智能选股视图与行情操作"/);
  assert.match(screenerSource, /<details className=\{styles\.informationDisclosure\}>[\s\S]*数据覆盖与模型审计/);
  assert.match(screenerSource, /<details className=\{styles\.advancedFilters\}>[\s\S]*更多筛选与方案/);
  assert.match(screenerStyles, /\.informationDisclosure,[\s\S]*\.poolDisclosure,[\s\S]*\.advancedFilters \{/);
  assert.match(screenerStyles, /\.informationDisclosure > summary,[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto 28px;/);
  assert.match(screenerStyles, /\.advancedFilterGrid \{ display: flex;[\s\S]*flex-wrap: wrap;/);
});
