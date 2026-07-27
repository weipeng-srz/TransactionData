import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appleStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/global-markets/global-markets.css", import.meta.url), "utf8");
const appleGlassBlock = appleStyles.slice(appleStyles.indexOf("/* Desktop liquid-glass surface system."));
const globalGlassBlock = globalStyles.slice(globalStyles.indexOf("/* Desktop liquid-glass refinement."));

test("defines readable liquid-glass surfaces for light and dark appearances", () => {
  assert.match(appleStyles, /--apple-glass: rgba\(255, 255, 255, 0\.66\)/);
  assert.match(appleStyles, /--apple-glass: rgba\(31, 31, 34, 0\.68\)/);
  assert.match(appleStyles, /--apple-glass-border: rgba\(67, 72, 82, 0\.13\)/);
  assert.match(appleStyles, /--apple-glass-border: rgba\(255, 255, 255, 0\.15\)/);
  assert.match(appleStyles, /backdrop-filter: blur\(26px\) saturate\(175%\)/);
  assert.match(appleStyles, /\.quote-head,/);
  assert.match(appleStyles, /\.stock-score-card \{/);
  assert.doesNotMatch(appleGlassBlock, /inset 0 1px/);
});

test("applies the shared glass treatment to global-market containers", () => {
  assert.match(globalStyles, /\.global-summary,/);
  assert.match(globalStyles, /\.global-map-card,/);
  assert.match(globalStyles, /\.global-region-card \{/);
  assert.match(globalStyles, /\.global-fear-card \{/);
  assert.match(globalStyles, /var\(--apple-glass-shadow\)/);
  assert.doesNotMatch(globalGlassBlock, /inset 0 1px/);
});
