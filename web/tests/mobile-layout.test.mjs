import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const appleStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");
const bannerStyles = readFileSync(new URL("../app/components/SiteBanner.module.css", import.meta.url), "utf8");

test("keeps the shared stock banner and search touch-friendly on mobile", () => {
  assert.match(pageSource, /<SiteBanner activePage="stock"/);
  assert.match(pageSource, /currentStockCode=\{selectedCode\}/);
  assert.match(bannerStyles, /position: sticky;/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.banner \{/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.searchField \{[\s\S]*?min-height: 44px;/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?\.suggestionActions button \{ flex: 1;/);
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
  assert.match(mobileTouchGuard, /\.research-more-actions:not\(\[open\]\) > div \{\s+display: none !important;/);
  assert.match(mobileTouchGuard, /\.app-sidebar \{\s+pointer-events: none;/);
  assert.match(mobileTouchGuard, /\.app-sidebar \.workspace-nav \{[\s\S]*?pointer-events: auto;/);
  assert.match(mobileTouchGuard, /\.table-wrap > table \{\s+min-width: 680px;/);
  assert.match(mobileTouchGuard, /\.recent-card \.table-wrap > table \{\s+min-width: 980px;/);
  assert.doesNotMatch(mobileTouchGuard, /@media \(min-width:/);
});
