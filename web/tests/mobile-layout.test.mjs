import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const appleStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");
const researchNotesStyles = readFileSync(new URL("../app/features/stock/ResearchNotes.module.css", import.meta.url), "utf8");
const workspaceStyles = readFileSync(new URL("../app/components/WorkspaceTabs.module.css", import.meta.url), "utf8");
const bannerStyles = readFileSync(new URL("../app/components/SiteBanner.module.css", import.meta.url), "utf8");
const bannerSource = readFileSync(new URL("../app/components/SiteBanner.tsx", import.meta.url), "utf8");

test("keeps the shared stock banner and search touch-friendly on mobile", () => {
  assert.match(pageSource, /<SiteBanner activePage="stock"/);
  assert.match(pageSource, /currentStockCode=\{selectedCode\}/);
  assert.match(bannerStyles, /position: fixed;/);
  assert.match(bannerStyles, /\.mobileSpacer \{[\s\S]*?height: 80px;[\s\S]*?display: block;/);
  assert.match(bannerSource, /className=\{styles\.mobileSpacer\} aria-hidden="true"/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.banner \{/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?position: fixed;/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?right: var\(--site-frame-gutter, 12px\);[\s\S]*?left: var\(--site-frame-gutter, 12px\);/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?transform: none;/);
  assert.doesNotMatch(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?translate3d\(-50%/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.mobileSpacer \{[\s\S]*?height: calc\(126px \+ max\(8px, env\(safe-area-inset-top\)\)\);[\s\S]*?display: block;/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?grid-template-rows: 48px 48px;/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.search \{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?grid-row: 2;/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.navigation \{[\s\S]*?height: 48px;[\s\S]*?min-height: 48px;[\s\S]*?padding: 1px;/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.searchField \{[\s\S]*?height: 48px;[\s\S]*?min-height: 48px;/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.banner \.search input \{ min-height: 44px;[\s\S]*?font-size: 16px;/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.addButton \{ display: none; \}/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.searchField > button\[type="submit"\] \{[^}]*display: inline-flex;/);
  assert.match(bannerSource, /className=\{styles\.mobileButtonLabel\}/);
  assert.match(bannerSource, /placeholder="搜索名称 \/ 代码"/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?backdrop-filter: none;/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.suggestionActions button \{[^}]*min-height: 44px;[^}]*flex: 1;/);
});

test("keeps stock loading compact with one accessible all-screen research navigation", () => {
  assert.match(appleStyles, /@media \(max-width: 620px\)[\s\S]*?\.stock-initial-sources \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  const tabs = pageSource.indexOf('<WorkspaceTabs id="stock"');
  const header = pageSource.indexOf('<StockWorkspaceHeader');
  assert.ok(header >= 0 && tabs > header);
  assert.match(pageSource, /label="个股研究视图"/);
  assert.match(workspaceStyles, /overflow-x: auto/);
  assert.match(workspaceStyles, /min-height: 44px/);
  assert.match(workspaceStyles, /top: max\(136px/);
  assert.doesNotMatch(pageSource, /research-section-jump|滑动 ›/);
});

test("adds touch-friendly horizontal tracks only within mobile media rules", () => {
  const marker = appleStyles.indexOf("/* Mobile interaction and overflow polish. */");
  const keyframes = appleStyles.indexOf("@keyframes apple-ambient-scroll", marker);
  const mobilePolish = appleStyles.slice(marker, keyframes);

  assert.ok(marker >= 0);
  assert.match(mobilePolish, /^\/\* Mobile interaction and overflow polish\. \*\/\s+@media \(max-width: 820px\)/);
  assert.match(mobilePolish, /\.stock-score-breakdown \{[\s\S]*?overflow-x: auto;/);
  assert.match(mobilePolish, /\.finance-kpi-grid,[\s\S]*?scroll-snap-type: x mandatory;/);
  assert.match(mobilePolish, /env\(safe-area-inset-bottom\)/);
  assert.match(mobilePolish, /-webkit-overflow-scrolling: touch;/);
  assert.doesNotMatch(mobilePolish, /@media \(min-width:/);
});

test("keeps mobile touch targets large and closed action menus non-interactive", () => {
  const marker = appleStyles.indexOf("/* Mobile touch target and spacing guard. */");
  const end = appleStyles.indexOf("/* Final shell precedence", marker);
  const mobileTouchGuard = appleStyles.slice(marker, end);

  assert.ok(marker >= 0);
  assert.ok(end > marker);
  assert.match(mobileTouchGuard, /^\/\* Mobile touch target and spacing guard\. \*\/[\s\S]*?@media \(max-width: 820px\)/);
  assert.match(mobileTouchGuard, /button,\s+summary,\s+select,[\s\S]*?min-height: 44px;/);
  assert.match(mobileTouchGuard, /\.appearance-toggle,[\s\S]*?min-width: 44px;/);
  assert.match(researchNotesStyles, /\.moreActions:not\(\[open\]\) > div \{\s*display: none;/);
  assert.match(mobileTouchGuard, /\.app-sidebar \{\s+pointer-events: none;/);
  assert.match(mobileTouchGuard, /\.app-sidebar \.workspace-nav \{[\s\S]*?pointer-events: auto;/);
  assert.match(mobileTouchGuard, /\.table-wrap > table \{\s+min-width: 680px;/);
  assert.match(mobileTouchGuard, /\.recent-card \.table-wrap > table \{\s+min-width: 980px;/);
  assert.doesNotMatch(mobileTouchGuard, /@media \(min-width:/);
});

test("keeps late mobile component overrides at a 44px interactive minimum", () => {
  const marker = appleStyles.indexOf("/* Final mobile interactive hit-area guard.");
  const end = appleStyles.indexOf("@supports not", marker);
  const finalHitAreaGuard = appleStyles.slice(marker, end);

  assert.ok(marker >= 0);
  assert.ok(end > marker);
  assert.match(finalHitAreaGuard, /\.realtime-header-meta button:not\(\.icon-button\) \{\s+min-height: 44px;/);
  assert.match(researchNotesStyles, /@media \(max-width: 820px\)[\s\S]*?\.workspace button, \.moreActions summary \{ min-height: 44px;/);
  assert.match(finalHitAreaGuard, /\.kline-viewport-controls button,[\s\S]*?min-width: 44px;\s+min-height: 44px;/);
  assert.match(finalHitAreaGuard, /\.kline-viewport-controls button\.is-reset,[\s\S]*?min-width: 48px;/);
  assert.match(finalHitAreaGuard, /\.next-day-controls select \{\s+min-height: 44px;/);
  assert.match(finalHitAreaGuard, /\.news-item > a \{[\s\S]*?min-height: 44px;[\s\S]*?display: flex;/);
  assert.doesNotMatch(finalHitAreaGuard, /@media \(min-width:/);
});
