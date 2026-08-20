import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bannerSource = readFileSync(new URL("../app/components/SiteBanner.tsx", import.meta.url), "utf8");
const commandPaletteSource = readFileSync(new URL("../app/components/CommandPalette.tsx", import.meta.url), "utf8");
const bannerStyles = readFileSync(new URL("../app/components/SiteBanner.module.css", import.meta.url), "utf8");
const appleStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");
const portfolioStyles = readFileSync(new URL("../app/components/PortfolioHome.module.css", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/global-markets/global-markets.css", import.meta.url), "utf8");
const portfolioSource = readFileSync(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8");
const stockSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const globalSource = readFileSync(new URL("../app/global-markets/page.tsx", import.meta.url), "utf8");

test("uses one shared banner for portfolio, stock and global pages", () => {
  assert.match(portfolioSource, /<SiteBanner[\s\S]*?activePage="portfolio"/);
  assert.match(stockSource, /<SiteBanner[\s\S]*?activePage="stock"/);
  assert.match(globalSource, /<SiteBanner[\s\S]*?activePage="global"/);
  assert.match(bannerSource, />自选<\/Link>/);
  assert.match(bannerSource, />全球<\/Link>/);
  assert.doesNotMatch(bannerSource, />个股研究<\/Link>/);
  assert.match(bannerSource, /aria-label="添加自选股"/);
  assert.match(bannerSource, /切换个股/);
  assert.match(bannerSource, /activePage === "stock" && onOpenPortfolio/);
  assert.match(bannerSource, /aria-label="TrendSight 自选股首页"[\s\S]*?onClick=\{openPortfolioClick\}/);
  assert.match(stockSource, /onOpenPortfolio=\{onBackHome\}/);
});

test("keeps the banner geometry and search outline consistent", () => {
  const mediumStart = bannerStyles.indexOf("@media (max-width: 1280px)");
  const mobileStart = bannerStyles.indexOf("@media (max-width: 820px)", mediumStart);
  const mediumStyles = bannerStyles.slice(mediumStart, mobileStart);

  assert.ok(mediumStart >= 0);
  assert.ok(mobileStart > mediumStart);
  assert.match(appleStyles, /--site-frame-max: 1600px;/);
  assert.match(appleStyles, /--site-frame-inset: 40px;/);
  assert.match(appleStyles, /@media \(max-width: 820px\)[\s\S]*?--site-frame-inset: 24px;/);
  assert.match(bannerStyles, /\.banner \{[\s\S]*?width: min\(calc\(100% - var\(--site-frame-inset, 40px\)\), var\(--site-frame-max, 1600px\)\);/);
  assert.match(portfolioStyles, /\.content \{[\s\S]*?width: min\(calc\(100% - var\(--site-frame-inset, 40px\)\), var\(--site-frame-max, 1600px\)\);/);
  assert.match(appleStyles, /@media \(min-width: 821px\)[\s\S]*?\.research-page > \.app-shell,[\s\S]*?\.global-page > \.app-shell \{[\s\S]*?width: min\(calc\(100% - var\(--site-frame-inset\)\), var\(--site-frame-max\)\);[\s\S]*?padding: 18px 0 48px !important;/);
  assert.match(appleStyles, /@media \(max-width: 820px\)[\s\S]*?\.research-page > \.app-shell,[\s\S]*?\.global-page > \.app-shell \{[\s\S]*?padding: 12px var\(--site-frame-gutter\) 24px !important;/);
  assert.match(globalStyles, /Final frame guard: keep the global content aligned with the shared banner[\s\S]*?padding: 12px var\(--site-frame-gutter, 12px\) 24px !important;/);
  assert.match(bannerStyles, /position: fixed;[\s\S]*?top: 12px;[\s\S]*?left: 50%;/);
  assert.match(bannerStyles, /transform: translateX\(-50%\);/);
  assert.match(bannerStyles, /\.mobileSpacer \{[\s\S]*?height: 80px;[\s\S]*?display: block;/);
  assert.match(mediumStyles, /\.mobileSpacer \{ height: 138px; \}/);
  assert.match(bannerStyles, /\.searchField \{[\s\S]*?border: 1px solid color-mix/);
  assert.match(bannerStyles, /\.banner \.search input \{[\s\S]*?font-size: 12px;/);
  assert.match(bannerStyles, /\.searchField:focus-within \{[\s\S]*?border-color:[\s\S]*?72%/);
  assert.match(mediumStyles, /grid-template-rows: 48px 48px;/);
  assert.match(mediumStyles, /\.navigation \{ height: 48px; min-height: 48px; padding: 1px;/);
  assert.match(mediumStyles, /\.navigation a \{ min-height: 44px; \}/);
  assert.match(mediumStyles, /\.searchField \{ height: 48px; min-height: 48px; padding-block: 1px; \}/);
  assert.match(mediumStyles, /\.iconButton \{ width: 48px; height: 48px; min-height: 48px; \}/);
});

test("keeps the fixed search outside the document flow while preserving its space", () => {
  assert.match(bannerSource, /searchRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(bannerStyles, /\.banner \{[\s\S]*?overflow-anchor: none;/);
  assert.match(commandPaletteSource, /inputRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(commandPaletteSource, /previousFocusRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test("limits sidebars to in-page stock and global index navigation", () => {
  assert.match(stockSource, /className="app-sidebar research-sidebar"/);
  assert.match(stockSource, /aria-label="个股信息章节导航"/);
  assert.doesNotMatch(stockSource, /<MarketScopeSwitch/);
  assert.doesNotMatch(stockSource, /sidebar-recents/);

  assert.match(globalSource, /aria-label="全球市场汇总"/);
  assert.match(globalSource, /aria-label="全球股指快速导航"/);
  for (const anchor of ["global-overview", "a-share-indexes", "shanghai-index", "global-map", "us-indexes", "americas-indexes", "europe-indexes", "asia-indexes"]) {
    assert.match(globalSource, new RegExp(anchor));
  }
  assert.doesNotMatch(globalSource, /<MarketScopeSwitch/);
});

test("uses a unified liquid-glass sidebar instead of stacked hard outlines", () => {
  const marker = appleStyles.indexOf("/* Unified liquid-glass sidebars shared by stock and global pages. */");
  const end = appleStyles.indexOf("@media (min-width: 821px) and (max-width: 1180px)", marker);
  const sidebarStyles = appleStyles.slice(marker, end);

  assert.ok(marker >= 0);
  assert.ok(end > marker);
  assert.match(sidebarStyles, /\.research-sidebar\.app-sidebar,[\s\S]*?border-radius: 22px;[\s\S]*?var\(--apple-glass-shadow\)/);
  assert.match(sidebarStyles, /\.sidebar-preview-card \{[\s\S]*?border-color: transparent;[\s\S]*?border-radius: 17px;/);
  assert.match(sidebarStyles, /\.sidebar-preview-metrics \{[\s\S]*?gap: 0;[\s\S]*?border-radius: 13px;/);
  assert.match(sidebarStyles, /\.workspace-nav \{[\s\S]*?border-radius: 17px;[\s\S]*?var\(--apple-glass-soft\)/);
});
