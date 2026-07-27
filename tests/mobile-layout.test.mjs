import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const appleStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");

test("shows a compact live quote in the mobile top bar after scrolling", () => {
  assert.match(pageSource, /compactQuoteVisible/);
  assert.match(pageSource, /window\.scrollY > 120/);
  assert.match(pageSource, /className="mobile-topbar-quote"/);
  assert.match(pageSource, /当前股票实时行情/);
  assert.match(appleStyles, /\.mobile-topbar-quote \{\s+display: none;/);
  assert.match(appleStyles, /@media \(max-width: 820px\)[\s\S]*?\.topbar\.is-compact-quote \.mobile-topbar-quote/);
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
