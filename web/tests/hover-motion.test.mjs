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

test("keeps hover feedback inside card bounds across the site", () => {
  const offenders = [];

  for (const path of collectCssFiles(appDirectory)) {
    const source = readFileSync(path, "utf8");
    const hoverBlocks = source.match(/[^{}]*:hover[^{}]*\{[^{}]*\}/g) ?? [];

    for (const block of hoverBlocks) {
      if (/transform\s*:[^;]*(?:translateY\(\s*-|translate3d\([^,]+,\s*-)/.test(block)) {
        offenders.push(`${path}: ${block.trim()}`);
      }
    }
  }

  assert.deepEqual(offenders, [], "hover states must not lift cards or controls beyond clipped bounds");
});

test("retains material feedback without moving research cards", () => {
  const source = readFileSync(`${appDirectory}/apple-refinement.css`, "utf8");

  assert.match(source, /button:not\(:disabled\):hover,[\s\S]*?summary:hover \{[\s\S]*?transform: none;[\s\S]*?filter: saturate/);
  assert.match(source, /\.research-page :where\([^}]+\):hover \{[\s\S]*?box-shadow: var\(--apple-shadow-hover\);[\s\S]*?transform: none;/);
});
