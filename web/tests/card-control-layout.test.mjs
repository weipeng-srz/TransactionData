import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const portfolioSource = read("../app/components/PortfolioHome.tsx");
const portfolioStyles = read("../app/components/PortfolioHome.module.css");
const bannerStyles = read("../app/components/SiteBanner.module.css");
const beginnerStyles = read("../app/components/BeginnerGuideCard.module.css");
const viewModeStyles = read("../app/components/ViewModeSwitch.module.css");
const backtestStyles = read("../app/components/SignalBacktestCard.module.css");

test("keeps mobile banner controls inside a container sized for 44px touch targets", () => {
  const mobile = bannerStyles.slice(bannerStyles.indexOf("@media (max-width: 820px)"));
  assert.match(mobile, /grid-template-rows: 48px;/);
  assert.match(mobile, /\.searchField \{[\s\S]*?height: 48px;[\s\S]*?min-height: 48px;/);
  assert.match(mobile, /\.searchField > button\[type="submit"\] \{[^}]*min-height: 44px;/);
  assert.match(mobile, /\.navigation a \{[^}]*min-height: 44px;/);
  assert.match(mobile, /\.iconButton \{ width: 48px; height: 48px; min-height: 48px;/);
  assert.doesNotMatch(mobile, /\.searchField \{[^}]*height: 40px;/);
});

test("keeps banner and stock-list borders crisp without a top highlight", () => {
  const bannerStart = bannerStyles.indexOf(".banner {");
  const bannerBlock = bannerStyles.slice(bannerStart, bannerStyles.indexOf("\n}", bannerStart) + 2);
  const watchlistStart = portfolioStyles.indexOf(".watchlistCard {");
  const watchlistBlock = portfolioStyles.slice(watchlistStart, portfolioStyles.indexOf("\n}", watchlistStart) + 2);

  assert.match(bannerBlock, /border: 1px solid var\(--apple-border-strong\);/);
  assert.match(watchlistBlock, /border: 1px solid var\(--portfolio-border-strong\);/);
  assert.doesNotMatch(bannerBlock, /box-shadow:[^;]*inset 0 1px/);
  assert.doesNotMatch(watchlistBlock, /box-shadow:[^;]*inset 0 1px/);
});

test("provides consistent focus, pressed and reduced-motion control states", () => {
  assert.match(bannerStyles, /\.brand:focus-visible,[\s\S]*?\.iconButton:focus-visible/);
  assert.match(bannerStyles, /\.addButton:active:not\(:disabled\),[\s\S]*?scale\(\.98\)/);
  assert.match(viewModeStyles, /\.switch button:hover:not\(\[aria-pressed="true"\]\)/);
  assert.match(viewModeStyles, /\.switch button:active/);
  assert.match(beginnerStyles, /\.profile button:focus-visible,[\s\S]*?\.glossary summary:focus-visible/);
  assert.match(beginnerStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(backtestStyles, /\.costControl input:focus-visible/);
  assert.match(portfolioStyles, /\.page :where\(button, a, select, input\):focus-visible/);
  assert.match(portfolioStyles, /\.page button:not\(:disabled\):active/);
});

test("keeps portfolio actions touch-safe without nesting interactive controls", () => {
  assert.doesNotMatch(portfolioSource, /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
  const mobile = portfolioStyles.slice(portfolioStyles.indexOf("@media (max-width: 820px)"));
  assert.match(portfolioSource, /<select aria-label="自选股排序"/);
  assert.doesNotMatch(mobile, /\.listActions label \{ display: none; \}/);
  assert.match(mobile, /\.listActions label \{ min-height: 44px;[^}]*display: flex;[^}]*grid-column: 1 \/ -1;/);
  assert.match(mobile, /\.listActions select \{ min-width: 0; min-height: 44px; flex: 1; \}/);
  assert.match(mobile, /\.listActions > button \{ min-height: 44px;/);
  assert.match(mobile, /\.signalActions button \{ min-height: 44px;/);
  assert.match(mobile, /\.rowActions button \{ width: 44px; height: 44px;/);
  assert.match(mobile, /\.stockIdentity \{ min-height: 44px;/);
});

test("supports keyboard and touch operation for portfolio overlays", () => {
  assert.match(portfolioSource, /<form[\s\S]*?role="dialog"[\s\S]*?onSubmit=\{\(event\) => \{ event\.preventDefault\(\); savePosition\(\); \}\}/);
  assert.match(portfolioSource, /event\.key === "Escape"[\s\S]*?setEditor\(null\)/);
  assert.match(portfolioSource, /event\.key === "Tab"[\s\S]*?querySelectorAll<HTMLElement>\(dialogFocusableSelector\)/);
  assert.match(portfolioSource, /const currentIndex = focusableElements\.findIndex[\s\S]*?const nextIndex = event\.shiftKey/);
  assert.match(portfolioSource, /currentIndex <= 0 \? focusableElements\.length - 1 : currentIndex - 1/);
  assert.match(portfolioSource, /currentIndex < 0 \|\| currentIndex === focusableElements\.length - 1 \? 0 : currentIndex \+ 1/);
  assert.match(portfolioSource, /event\.preventDefault\(\);[\s\S]*?focusableElements\[nextIndex\]\?\.focus\(\)/);
  assert.match(portfolioSource, /event\.key === "Enter" && event\.target instanceof HTMLInputElement[\s\S]*?savePosition\(\)/);
  assert.match(portfolioSource, /editorRestoreFocusRef\.current = document\.activeElement instanceof HTMLElement/);
  assert.match(portfolioSource, /positionEditorInitialFocusRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(portfolioSource, /restoreTarget\?\.isConnected[\s\S]*?restoreTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.match(portfolioSource, /className=\{styles\.saveButton\} type="submit"/);
  assert.match(portfolioSource, /onPointerUp=\{\(event\) => \{[\s\S]*?event\.pointerType !== "touch"[\s\S]*?showDetails\(\)/);
  assert.match(portfolioStyles, /max-height: min\(720px, calc\(100dvh - 48px\)\);/);
  assert.match(portfolioStyles, /overscroll-behavior: contain;/);
});
