import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appDirectory = fileURLToPath(new URL("../app", import.meta.url));

function collectCssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collectCssFiles(path);
    return entry.isFile() && entry.name.endsWith(".css") ? [path] : [];
  });
}

test("keeps any remaining card hover lift shallow and above adjacent borders", () => {
  const unsafeLifts = [];

  for (const path of collectCssFiles(appDirectory)) {
    const source = readFileSync(path, "utf8");
    const hoverBlocks = source.match(/[^{}]*:hover[^{}]*\{[^{}]*\}/g) ?? [];

    for (const block of hoverBlocks) {
      if (/transform\s*:[^;]*(?:translateY\(\s*-|translate3d\([^,]+,\s*-)/.test(block)) {
        unsafeLifts.push(`${path}: ${block.trim()}`);
      }
      if (/transform\s*:\s*translate3d\(0,\s*var\(--apple-hover-lift(?:,\s*-2px)?\),\s*0\)/.test(block)) {
        assert.match(block, /position:\s*relative;/);
        assert.match(block, /z-index:\s*1;/);
      }
    }
  }

  const sharedMotion = readFileSync(`${appDirectory}/apple-refinement.css`, "utf8");
  assert.match(sharedMotion, /--apple-hover-lift:\s*-2px;/);
  assert.deepEqual(unsafeLifts, [], "card lift must use the shared, bounded motion token");
  const globalStyles = readFileSync(`${appDirectory}/global-markets/global-markets.css`, "utf8");
  assert.doesNotMatch(globalStyles, /var\(--apple-hover-lift\)/, "market data surfaces remain stationary on hover");
});

test("limits card lift to precise pointers and removes it for reduced motion", () => {
  const files = [
    "screener/screener.module.css",
    "components/PortfolioHome.module.css",
    "components/PortfolioWorkbenchSummary.module.css",
    "components/BeginnerGuideCard.module.css",
  ];

  for (const file of files) {
    const source = readFileSync(`${appDirectory}/${file}`, "utf8");
    assert.match(source, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?transform:\s*translate3d\(0,\s*var\(--apple-hover-lift/);
    assert.match(source, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transform:\s*none;/);
  }

  const source = readFileSync(`${appDirectory}/apple-refinement.css`, "utf8");

  assert.match(source, /button:not\(:disabled\):hover,[\s\S]*?summary:hover \{[\s\S]*?transform: none;[\s\S]*?filter: saturate/);
  assert.match(source, /\.research-page :where\([^}]+\):hover \{[^}]*box-shadow: none;[^}]*transform: none;/);
  assert.doesNotMatch(source, /\.research-page :where\([^}]+\):hover \{[^}]*var\(--apple-hover-lift\)/);
});
