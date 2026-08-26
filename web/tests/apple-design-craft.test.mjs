import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const researchStyles = read("../app/apple-refinement.css");
const portfolioStyles = read("../app/components/PortfolioHome.module.css");
const bannerStyles = read("../app/components/SiteBanner.module.css");
const screenerStyles = read("../app/screener/screener.module.css");
const globalStyles = read("../app/global-markets/global-markets.css");
const platformStyles = [researchStyles, portfolioStyles, bannerStyles, screenerStyles, globalStyles];

test("uses one optical type, focus, and motion language across the platform", () => {
  assert.match(researchStyles, /--apple-display-font:/);
  assert.match(researchStyles, /--apple-focus-ring:/);
  assert.match(researchStyles, /--apple-press-scale: 0\.97;/);
  assert.match(researchStyles, /font-optical-sizing: auto;/);

  for (const styles of platformStyles) {
    assert.match(styles, /focus-visible/);
    assert.match(styles, /var\(--apple-motion-fast\)/);
    assert.match(styles, /scale\(var\(--apple-press-scale/);
  }
});

test("keeps translucency on structural surfaces and supports reduced transparency", () => {
  assert.match(bannerStyles, /@media \(min-width: 821px\)[\s\S]*?backdrop-filter: blur\(30px\) saturate\(175%\)/);
  assert.match(portfolioStyles, /\.watchlistCard,[\s\S]*?backdrop-filter: blur\(24px\) saturate\(155%\)/);
  assert.match(screenerStyles, /\.featuredSection,[\s\S]*?backdrop-filter: blur\(24px\) saturate\(155%\)/);
  assert.match(globalStyles, /\.global-summary,[\s\S]*?backdrop-filter: blur\(24px\) saturate\(155%\)/);

  for (const styles of platformStyles) {
    assert.match(styles, /prefers-reduced-transparency: reduce/);
    assert.match(styles, /backdrop-filter: none/);
  }
});

test("preserves touch accessibility and calm reduced-motion fallbacks", () => {
  assert.match(researchStyles, /@media \(pointer: coarse\)[\s\S]*?min-height: 44px/);
  assert.match(portfolioStyles, /@media \(max-width: 820px\)[\s\S]*?min-height: 44px/);
  assert.match(bannerStyles, /@media \(max-width: 820px\)[\s\S]*?min-height: 44px/);
  assert.match(screenerStyles, /@media \(max-width: 820px\)[\s\S]*?min-height: 44px/);
  assert.match(globalStyles, /@media \(max-width: 820px\)[\s\S]*?min-height: 44px/);

  for (const styles of platformStyles) {
    assert.match(styles, /prefers-reduced-motion: reduce/);
  }
});
