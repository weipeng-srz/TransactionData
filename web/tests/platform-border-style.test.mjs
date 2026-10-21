import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const appleStyles = read("../app/apple-refinement.css");
const globalStyles = read("../app/global-markets/global-markets.css");
const portfolioStyles = read("../app/components/PortfolioHome.module.css");
const screenerStyles = read("../app/screener/screener.module.css");
const bannerStyles = read("../app/components/SiteBanner.module.css");

test("defines one responsive border scale for the platform", () => {
  assert.match(appleStyles, /--platform-border-width: 1px;/);
  assert.match(appleStyles, /--platform-border-style: solid;/);
  assert.match(appleStyles, /--platform-panel-radius: 28px;/);
  assert.match(appleStyles, /--platform-inset-radius: 18px;/);
  assert.match(appleStyles, /@media \(max-width: 820px\)[\s\S]*?--platform-panel-radius: 20px;[\s\S]*?--platform-inset-radius: 16px;/);
  assert.match(appleStyles, /--apple-border: var\(--platform-border-color\);/);
  assert.match(appleStyles, /--apple-border-strong: var\(--platform-border-strong\);/);
});

test("applies the shared frame to research and global market surfaces", () => {
  assert.match(appleStyles, /\.app-sidebar,[\s\S]*?\.stock-initial-card \{[\s\S]*?border-width: var\(--platform-border-width\);[\s\S]*?border-radius: var\(--platform-panel-radius\);/);
  assert.match(globalStyles, /\.global-shanghai-chart-stage \{[\s\S]*?border: var\(--platform-border-width\) var\(--platform-border-style\) var\(--platform-border-color\);[\s\S]*?border-radius: var\(--platform-inset-radius\);/);
  assert.match(globalStyles, /\.global-fear-chart-stage \{[\s\S]*?border: var\(--platform-border-width\) var\(--platform-border-style\) var\(--platform-border-color\);/);
});

test("keeps portfolio, screener, and banner surfaces on the same border system", () => {
  assert.match(portfolioStyles, /--portfolio-border: var\(--platform-border-color\);/);
  assert.match(portfolioStyles, /\.watchlistCard \{[\s\S]*?border-radius: var\(--platform-panel-radius\);/);
  assert.match(screenerStyles, /\.featuredSection,[\s\S]*?border: var\(--platform-border-width\) var\(--platform-border-style\) var\(--platform-border-color\);[\s\S]*?border-radius: var\(--platform-panel-radius\);/);
  assert.match(bannerStyles, /\.banner \{[\s\S]*?border-radius: var\(--platform-inset-radius\);/);
});
