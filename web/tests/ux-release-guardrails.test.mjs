import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publicStockLookupError, stockLookupUnavailableMessage, stockNotFoundMessage } from "../app/lib/stockLookupError.ts";
import { resolveStoredViewMode } from "../app/lib/viewMode.ts";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const stockHeaderSource = readFileSync(new URL("../app/components/StockWorkspaceHeader.tsx", import.meta.url), "utf8");
const globalSource = readFileSync(new URL("../app/global-markets/page.tsx", import.meta.url), "utf8");
const bannerSource = readFileSync(new URL("../app/components/SiteBanner.tsx", import.meta.url), "utf8");
const beginnerSource = readFileSync(new URL("../app/components/BeginnerGuideCard.tsx", import.meta.url), "utf8");
const backtestSource = readFileSync(new URL("../app/components/SignalBacktestCard.tsx", import.meta.url), "utf8");
const researchDockSource = readFileSync(new URL("../app/components/ResearchDock.tsx", import.meta.url), "utf8");
const financialDashboardSource = readFileSync(new URL("../app/components/FinancialDashboard.tsx", import.meta.url), "utf8");
const portfolioHomeSource = readFileSync(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8");
const stockWorkspaceStyles = readFileSync(new URL("../app/components/StockWorkspace.module.css", import.meta.url), "utf8");
const appleRefinementStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");

test("defaults first-time users to the basic view while preserving an explicit professional choice", () => {
  assert.equal(resolveStoredViewMode(null), "basic");
  assert.equal(resolveStoredViewMode("basic"), "basic");
  assert.equal(resolveStoredViewMode("pro"), "pro");
  assert.equal(resolveStoredViewMode("unknown"), "basic");
  assert.match(pageSource, /useState<ViewMode>\("basic"\)/);
  assert.match(stockHeaderSource, /<ViewModeSwitch value=\{viewMode\} onChange=\{onViewModeChange\}/);
  assert.doesNotMatch(pageSource, /setMobileChapter/);
  assert.match(pageSource, /onViewModeChange=\{setViewMode\}/);
  assert.match(pageSource, /accountStorage\.setItem\(viewModeStorageKey, viewMode\)/);
});

test("gives novice users progressive disclosure, suitability context and an invalidation check", () => {
  assert.match(pageSource, /viewMode === "basic" \? \([\s\S]*?<BeginnerGuideCard/);
  assert.match(pageSource, /<NextDayPredictionCard/);
  assert.doesNotMatch(pageSource, /viewMode === "pro" \? <NextDayPredictionCard/);
  assert.match(beginnerSource, /今天先看三件事/);
  assert.match(beginnerSource, /风险承受能力/);
  assert.match(beginnerSource, /当前判断可能失效/);
  assert.match(beginnerSource, /观察模式 · 不连接交易账户/);
  assert.match(beginnerSource, /B \/ S[\s\S]*VWAP[\s\S]*VaR \/ ES[\s\S]*AUC/);
  assert.match(pageSource, /<RealtimeTradingPanel/);
  assert.doesNotMatch(pageSource, /viewMode === "pro" \? <RealtimeTradingPanel/);
  assert.match(pageSource, /<StockReviewEntry/);
  assert.doesNotMatch(pageSource, /viewMode === "pro" \? <StockReviewEntry/);
  assert.match(pageSource, /viewMode === "basic" && !newsExpanded \? visibleNews\.slice\(0, 3\)/);
  // Density preferences must not make an explicitly selected financial view empty.
  assert.doesNotMatch(appleRefinementStyles, /\.view-basic \.finance-(?:filter-bar|chart-grid|signal-card|detail-card)[^{]*\{[^}]*display:\s*none/);
  assert.doesNotMatch(appleRefinementStyles, /\.view-basic \.finance-kpi-grid > :nth-child\(n \+ 5\) \{ display: none; \}/);
});

test("keeps the analysis readable within the active workspace without legacy rail overrides", () => {
  assert.match(stockWorkspaceStyles, /\.analysis \{[^}]*min-width: 0;[^}]*display: grid/);
  assert.match(stockWorkspaceStyles, /\.analysis > :global\(\.conclusion-card\) \{ min-width: 0; \}/);
  assert.match(stockWorkspaceStyles, /\.market \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(appleRefinementStyles, /\.analysis-rail|\.basic-next-step-card/);
});

test("uses the full prediction row for the analog distribution on desktop", () => {
  assert.match(appleRefinementStyles, /@media \(min-width: 901px\) \{[\s\S]*?\.next-day-distribution \{\s*grid-column: 1 \/ -1;/);
  assert.match(appleRefinementStyles, /\.next-day-distribution \.distribution-bars \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?grid-template-rows: repeat\(3, auto\);[\s\S]*?grid-auto-flow: column;/);
});

test("returns a unified cross-market search error without hiding upstream outages", () => {
  assert.equal(publicStockLookupError([new Error("没有找到沪深 A 股")]).message, stockNotFoundMessage);
  assert.equal(publicStockLookupError([new Error("Failed to fetch")]).message, stockLookupUnavailableMessage);
  assert.match(bannerSource, /publicStockLookupError\(\[cnReason, usReason\]\)/);
  assert.match(bannerSource, /if \(signal\?\.aborted\) throw cnReason;/);
  const activeRequestSource = bannerSource.replace(/if \(signal\?\.aborted\) throw cnReason;/g, "");
  assert.doesNotMatch(activeRequestSource, /throw cnReason/, "only canceled requests may bypass public error mapping");
});

test("keeps a single page heading on loaded stock and global routes", () => {
  assert.match(stockHeaderSource, /<h1>\{name\}<\/h1>/);
  assert.match(globalSource, /<h1>全球市场<\/h1>/);
  assert.match(pageSource, /document\.title = `\$\{selectedName[\s\S]*?\$\{selectedCode\} · TrendSight`/);
  assert.match(globalSource, /document\.title = "全球市场 · TrendSight"/);
});

test("makes backtest costs and corporate-action price basis explicit", () => {
  assert.match(backtestSource, /回测单次往返交易摩擦百分比/);
  assert.match(backtestSource, /手续费、税费与滑点合计假设/);
  assert.match(backtestSource, /价格口径/);
  assert.match(pageSource, /roundTripCostPct/);
  assert.match(backtestSource, /B 点 · 可交易方向/);
  assert.match(backtestSource, /S 点 · 仅风险提示/);
  assert.match(backtestSource, /流动性模型/);
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

test("separates A-share and US returns before presenting one CNY total", () => {
  assert.match(portfolioHomeSource, /ticklens\.fx-preference\.v1/);
  assert.match(portfolioHomeSource, /A 股与美股先按原币核算，再统一折算为人民币/);
  assert.match(portfolioHomeSource, /title: "A 股"[\s\S]*?title: "美股"/);
  assert.match(portfolioHomeSource, /人民币总计/);
  assert.match(portfolioHomeSource, /const rateSource = preference\.updatedAt \? "用户输入" : "默认设定"/);
  assert.match(portfolioHomeSource, /汇率来源：\{rateSource\} · 更新/);
  assert.match(portfolioHomeSource, /仅影响展示，不改写原始持仓/);
});

test("restores saved comparison benchmarks only within the selected market", () => {
  assert.match(pageSource, /function benchmarkMatchesMarket/);
  assert.match(pageSource, /benchmarkMatchesMarket\(benchmarks\[selectedMarket\], selectedMarket\)/);
  assert.match(pageSource, /benchmarkMatchesMarket\(sharedBenchmark, sharedMarket\)/);
});

test("keeps global stylesheet overrides within the release budget", () => {
  const files = ["../app/globals.css", "../app/apple.css", "../app/apple-refinement.css", "../app/global-markets/global-markets.css"];
  const importantCount = files.reduce((total, path) => total + (readFileSync(new URL(path, import.meta.url), "utf8").match(/!important/g)?.length ?? 0), 0);
  assert.ok(importantCount <= 195, `expected at most 195 !important declarations, received ${importantCount}`);
});
