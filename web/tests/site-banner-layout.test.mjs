import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bannerSource = readFileSync(new URL("../app/components/SiteBanner.tsx", import.meta.url), "utf8");
const bannerStyles = readFileSync(new URL("../app/components/SiteBanner.module.css", import.meta.url), "utf8");
const portfolioSource = readFileSync(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8");
const stockSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const globalSource = readFileSync(new URL("../app/global-markets/page.tsx", import.meta.url), "utf8");

test("uses one shared banner for portfolio, stock and global pages", () => {
  assert.match(portfolioSource, /<SiteBanner[\s\S]*?activePage="portfolio"/);
  assert.match(stockSource, /<SiteBanner[\s\S]*?activePage="stock"/);
  assert.match(globalSource, /<SiteBanner[\s\S]*?activePage="global"/);
  assert.match(bannerSource, /自选首页/);
  assert.match(bannerSource, /个股研究/);
  assert.match(bannerSource, /全球股指/);
  assert.match(bannerSource, /aria-label="添加自选股"/);
  assert.match(bannerSource, /切换个股/);
});

test("keeps the banner geometry and search outline consistent", () => {
  assert.match(bannerStyles, /\.banner \{[\s\S]*?width: min\(calc\(100% - 32px\), 1600px\);/);
  assert.match(bannerStyles, /position: sticky;[\s\S]*?top: 12px;/);
  assert.match(bannerStyles, /\.searchField \{[\s\S]*?border: 1px solid color-mix/);
  assert.match(bannerStyles, /\.searchField:focus-within \{[\s\S]*?border-color:[\s\S]*?72%/);
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
