import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appleStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/global-markets/global-markets.css", import.meta.url), "utf8");

test("defines readable liquid-glass surfaces for light and dark appearances", () => {
  assert.match(appleStyles, /--apple-glass: rgba\(255, 255, 255, 0\.66\)/);
  assert.match(appleStyles, /--apple-glass: rgba\(31, 31, 34, 0\.68\)/);
  assert.match(appleStyles, /backdrop-filter: blur\(26px\) saturate\(175%\)/);
  assert.match(appleStyles, /\.quote-head,/);
  assert.match(appleStyles, /\.stock-score-card \{/);
});

test("applies the shared glass treatment to global-market containers", () => {
  assert.match(globalStyles, /\.global-summary,/);
  assert.match(globalStyles, /\.global-map-card,/);
  assert.match(globalStyles, /\.global-region-card \{/);
  assert.match(globalStyles, /\.global-fear-card \{/);
  assert.match(globalStyles, /var\(--apple-glass-shadow\)/);
});
