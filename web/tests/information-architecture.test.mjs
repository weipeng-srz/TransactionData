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

test("portfolio groups overview, decisions, and watchlist while keeping workbench evidence reachable", () => {
  assert.match(portfolioSource, /useState<"overview" \| "decisions" \| "watchlist">\("overview"\)/);
  assert.match(portfolioSource, /aria-label="投资组合信息分组"/);
  assert.match(portfolioSource, /data-active=\{mobileChapter === "watchlist"\}/);
  assert.match(workbenchSource, /useState<"priority" \| "evidence" \| "discovery">\("priority"\)/);
  assert.match(workbenchSource, /aria-label="决策工作台信息分组"/);
  assert.match(workbenchSource, /data-active=\{mobileChapter === "evidence"\}/);
});

test("stock research splits long professional content into focused mobile layers", () => {
  assert.match(stockSource, /useState<"overview" \| "live" \| "chart" \| "forecast" \| "tools" \| "financials" \| "news">\("overview"\)/);
  assert.match(stockSource, /aria-label="选择研究信息层"/);
  for (const chapter of ["overview", "live", "chart", "forecast", "tools", "financials", "news"]) {
    assert.match(stockSource, new RegExp(`data-active=\\{mobileChapter === "${chapter}"\\}|value="${chapter}"`));
  }
  assert.match(stockSource, /prefers-reduced-motion: reduce/);
});

test("financial dashboard progressively reveals summary, trends, and detailed conclusions", () => {
  assert.match(financialSource, /useState<"summary" \| "trends" \| "details">\("summary"\)/);
  assert.match(financialSource, /aria-label="财务信息分组"/);
  assert.match(financialSource, /finance-chart-grid platform-mobile-visibility/);
  assert.match(financialSource, /data-active=\{mobileChapter === "details"\}/);
});

test("global markets groups overview, trend, map, and regions on compact screens", () => {
  assert.match(globalSource, /useState<"overview" \| "trend" \| "map" \| "regions">\("overview"\)/);
  assert.match(globalSource, /aria-label="选择全球市场信息层"/);
  assert.match(globalSource, /data-active=\{mobileChapter === "map"\}/);
  assert.match(globalSource, /data-active=\{mobileChapter === "regions"\}/);
});

test("screener keeps the full desktop table and batches only mobile candidate cards", () => {
  assert.match(screenerSource, /useState<"shortlist" \| "pool" \| "structure">\("shortlist"\)/);
  assert.match(screenerSource, /const mobileVisibleStocks = visibleStocks\.slice\(0, mobileVisibleStockCount\)/);
  assert.match(screenerSource, /<tbody>\{visibleStocks\.map/);
  assert.match(screenerSource, /\{mobileVisibleStocks\.map/);
  assert.match(screenerSource, /再显示 \{Math\.min\(4, visibleStocks\.length - mobileVisibleStocks\.length\)\} 只/);
  assert.match(screenerStyles, /\.mobilePoolPager \{ display: none; \}/);
  assert.match(screenerStyles, /@media \(max-width: 760px\)[\s\S]*\.mobilePoolPager \{[\s\S]*display: flex;/);
});

test("screener keeps the decision path compact and progressively reveals secondary controls", () => {
  assert.match(screenerSource, /<h1 className="sr-only">智能选股<\/h1>/);
  assert.doesNotMatch(screenerSource, /<h1 id="screener-title">/);
  assert.match(screenerSource, /className=\{styles\.commandBar\}[\s\S]*aria-label="智能选股视图与行情操作"/);
  assert.match(screenerSource, /<details className=\{styles\.informationDisclosure\}>[\s\S]*数据覆盖与模型审计/);
  assert.match(screenerSource, /<details className=\{styles\.advancedFilters\}>[\s\S]*更多筛选与方案/);
  assert.match(screenerStyles, /\.informationDisclosure,[\s\S]*\.poolDisclosure,[\s\S]*\.advancedFilters \{/);
  assert.match(screenerStyles, /\.informationDisclosure > summary,[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto 28px;/);
  assert.match(screenerStyles, /\.advancedFilterGrid \{ display: flex;[\s\S]*flex-wrap: wrap;/);
});
