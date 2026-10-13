import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const layout = read("../app/layout.tsx");
const appearance = read("../app/lib/appearance.ts");
const provider = read("../app/components/AppearanceProvider.tsx");
const pages = [
  read("../app/page.tsx"),
  read("../app/components/PortfolioHome.tsx"),
  read("../app/global-markets/page.tsx"),
  read("../app/screener/page.tsx"),
];

test("restores appearance before the page is painted", () => {
  assert.match(layout, /<html lang="zh-CN" suppressHydrationWarning>/);
  assert.match(layout, /<head>[\s\S]*?<script id="appearance-bootstrap"[\s\S]*?<\/head>/);
  assert.ok(layout.indexOf("appearance-bootstrap") < layout.indexOf("<AppearanceProvider>"));
  assert.doesNotMatch(appearance, /localStorage|sessionStorage/);
  assert.match(appearance, /window\.matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(appearance, /root\.dataset\.appearance = appearance;/);
  assert.match(appearance, /root\.style\.colorScheme = appearance;/);
});

test("keeps one appearance owner across every top-level page", () => {
  for (const page of pages) {
    assert.match(page, /useAppearance\(\)/);
    assert.doesNotMatch(page, /ticklens\.appearance\.v1/);
    assert.doesNotMatch(page, /document\.documentElement\.dataset\.appearance/);
    assert.doesNotMatch(page, /useState<Appearance>/);
  }
  assert.match(provider, /const next = currentAppearance\(\) === "dark" \? "light" : "dark";/);
  assert.match(provider, /accountStorage\.setItem\(appearanceStorageKey, appearance\)/);
});

test("synchronizes account and system appearance changes", () => {
  assert.match(provider, /subscribeAccountStorageChanges\(syncStoredAppearance\)/);
  assert.match(provider, /media\.addEventListener\("change", syncSystemAppearance\)/);
  assert.match(provider, /if \(storedAppearance\(\)\) return;/);
  assert.match(provider, /unsubscribe\(\)/);
  assert.match(provider, /media\.removeEventListener\("change", syncSystemAppearance\)/);
});
