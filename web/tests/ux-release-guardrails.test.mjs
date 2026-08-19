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

test("keeps global stylesheet overrides within the release budget", () => {
  const files = ["../app/globals.css", "../app/apple.css", "../app/apple-refinement.css", "../app/global-markets/global-markets.css"];
  const importantCount = files.reduce((total, path) => total + (readFileSync(new URL(path, import.meta.url), "utf8").match(/!important/g)?.length ?? 0), 0);
  assert.ok(importantCount <= 195, `expected at most 195 !important declarations, received ${importantCount}`);
});
