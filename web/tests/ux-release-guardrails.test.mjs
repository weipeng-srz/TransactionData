import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publicStockLookupError, stockLookupUnavailableMessage, stockNotFoundMessage } from "../app/lib/stockLookupError.ts";
import { resolveStoredViewMode } from "../app/lib/viewMode.ts";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const globalSource = readFileSync(new URL("../app/global-markets/page.tsx", import.meta.url), "utf8");
const bannerSource = readFileSync(new URL("../app/components/SiteBanner.tsx", import.meta.url), "utf8");
const beginnerSource = readFileSync(new URL("../app/components/BeginnerGuideCard.tsx", import.meta.url), "utf8");
const backtestSource = readFileSync(new URL("../app/components/SignalBacktestCard.tsx", import.meta.url), "utf8");
const researchDockSource = readFileSync(new URL("../app/components/ResearchDock.tsx", import.meta.url), "utf8");
const financialDashboardSource = readFileSync(new URL("../app/components/FinancialDashboard.tsx", import.meta.url), "utf8");
const portfolioHomeSource = readFileSync(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8");
const appleRefinementStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");

test("defaults first-time users to the basic view while preserving an explicit professional choice", () => {
  assert.equal(resolveStoredViewMode(null), "basic");
  assert.equal(resolveStoredViewMode("basic"), "basic");
  assert.equal(resolveStoredViewMode("pro"), "pro");
  assert.equal(resolveStoredViewMode("unknown"), "basic");
  assert.match(pageSource, /useState<ViewMode>\("basic"\)/);
  assert.match(pageSource, /<ViewModeSwitch value=\{viewMode\} onChange=\{setViewMode\}/);
  assert.match(pageSource, /localStorage\.setItem\(viewModeStorageKey, viewMode\)/);
});

test("gives novice users progressive disclosure, suitability context and an invalidation check", () => {
  assert.match(pageSource, /viewMode === "basic" \? \([\s\S]*?<BeginnerGuideCard/);
  assert.match(pageSource, /viewMode === "pro" \? <NextDayPredictionCard/);
  assert.match(beginnerSource, /今天先看三件事/);
  assert.match(beginnerSource, /风险承受能力/);
  assert.match(beginnerSource, /当前判断可能失效/);
  assert.match(beginnerSource, /观察模式 · 不连接交易账户/);
  assert.match(beginnerSource, /B \/ S[\s\S]*VWAP[\s\S]*VaR \/ ES[\s\S]*AUC/);
  assert.match(pageSource, /viewMode === "pro" \? <RealtimeTradingPanel/);
  assert.match(pageSource, /viewMode === "pro" \? <ResearchDock/);
  assert.match(pageSource, /viewMode === "basic" \? visibleNews\.slice\(0, 3\)/);
  assert.match(appleRefinementStyles, /\.view-basic \.finance-filter-bar,[\s\S]*?\.view-basic \.finance-detail-card \{ display: none; \}/);
  assert.match(appleRefinementStyles, /\.view-basic \.finance-kpi-grid > :nth-child\(n \+ 5\) \{ display: none; \}/);
});

test("keeps the basic analysis prompt readable on wide desktop layouts", () => {
  assert.match(appleRefinementStyles, /\.view-basic \.analysis-rail \{\s*grid-template-columns: minmax\(0, 2fr\) minmax\(300px, 1fr\);/);
  assert.match(appleRefinementStyles, /\.view-basic \.analysis-rail > \.conclusion-card \{\s*grid-column: auto !important;/);
  assert.match(appleRefinementStyles, /\.view-basic \.analysis-rail > \.basic-next-step-card \{[\s\S]*?grid-column: auto;[\s\S]*?grid-row: 1;/);
});

test("uses the full prediction row for the analog distribution on desktop", () => {
  assert.match(appleRefinementStyles, /@media \(min-width: 901px\) \{[\s\S]*?\.next-day-distribution \{\s*grid-column: 1 \/ -1;/);
  assert.match(appleRefinementStyles, /\.next-day-distribution \.distribution-bars \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?grid-template-rows: repeat\(3, auto\);[\s\S]*?grid-auto-flow: column;/);
});

test("returns a unified cross-market search error without hiding upstream outages", () => {
  assert.equal(publicStockLookupError([new Error("没有找到沪深 A 股")]).message, stockNotFoundMessage);
  assert.equal(publicStockLookupError([new Error("Failed to fetch")]).message, stockLookupUnavailableMessage);
  assert.match(bannerSource, /publicStockLookupError\(\[cnReason, usReason\]\)/);
  assert.doesNotMatch(bannerSource, /throw cnReason/);
});

test("keeps a single page heading on loaded stock and global routes", () => {
  assert.match(pageSource, /<h1>\{selectedName \|\| selectedCode\}<\/h1>/);
  assert.match(globalSource, /<h1 className="sr-only">全球市场<\/h1>/);
  assert.match(pageSource, /document\.title = `\$\{selectedName[\s\S]*?\$\{selectedCode\} · TrendSight`/);
  assert.match(globalSource, /document\.title = "全球市场 · TrendSight"/);
});

test("makes backtest costs and corporate-action price basis explicit", () => {
  assert.match(backtestSource, /回测单次往返交易摩擦百分比/);
  assert.match(backtestSource, /手续费、税费与滑点合计假设/);
  assert.match(backtestSource, /价格口径/);
  assert.match(pageSource, /roundTripCostPct/);
});

test("disables the annotation action until the user enters meaningful text", () => {
  assert.match(researchDockSource, /<button type="button" disabled=\{!annotation\.trim\(\)\}[\s\S]*?>记录<\/button>/);
});

test("keeps an investor thesis, counter-evidence, invalidation and review checklist per stock", () => {
  assert.match(researchDockSource, /投资论点与反证/);
  assert.match(researchDockSource, /核心论点/);
  assert.match(researchDockSource, /反方证据/);
  assert.match(researchDockSource, /失效条件/);
  assert.match(researchDockSource, /下次复核日期/);
  assert.match(researchDockSource, /ticklens\.investment-memo\.v1/);
});

test("adds same-market peer comparison without cross-currency amount comparisons", () => {
  assert.match(financialDashboardSource, /同业横比与披露时间线/);
  assert.match(financialDashboardSource, /仅比较同一市场的增长率、利润率、资本结构与估值倍数/);
  assert.match(financialDashboardSource, /不比较跨币种绝对金额/);
  assert.match(financialDashboardSource, /一致预期修正[\s\S]*?明确留空/);
});

test("keeps FX conversion opt-in with an explicit source and update time", () => {
  assert.match(portfolioHomeSource, /ticklens\.fx-preference\.v1/);
  assert.match(portfolioHomeSource, /人民币折算视图/);
  assert.match(portfolioHomeSource, /默认仍按人民币与美元分别统计/);
  assert.match(portfolioHomeSource, /来源：用户输入 · 更新/);
});

test("restores saved comparison benchmarks only within the selected market", () => {
  assert.match(pageSource, /function benchmarkMatchesMarket/);
  assert.match(pageSource, /benchmarkMatchesMarket\(state\.benchmarkCode, selectedMarket\)/);
  assert.match(pageSource, /benchmarkMatchesMarket\(sharedBenchmark, sharedMarket\)/);
});

test("keeps global stylesheet overrides within the release budget", () => {
  const files = ["../app/globals.css", "../app/apple.css", "../app/apple-refinement.css", "../app/global-markets/global-markets.css"];
  const importantCount = files.reduce((total, path) => total + (readFileSync(new URL(path, import.meta.url), "utf8").match(/!important/g)?.length ?? 0), 0);
  assert.ok(importantCount <= 195, `expected at most 195 !important declarations, received ${importantCount}`);
});
