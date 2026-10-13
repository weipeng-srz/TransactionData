import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const marketChart = readFileSync(new URL("../app/components/MarketChart.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const appleStyles = readFileSync(new URL("../app/apple.css", import.meta.url), "utf8");

test("keeps every persistent main-chart control outside the K-line canvas", () => {
  const dockStart = marketChart.indexOf('<div className="market-chart-control-dock">');
  const stageStart = marketChart.indexOf('<div className={`chart-stage');
  const stageEnd = marketChart.indexOf("\n      </div>\n    </div>", stageStart);

  assert.ok(dockStart >= 0 && stageStart > dockStart && stageEnd > stageStart);
  const stage = marketChart.slice(stageStart, stageEnd);
  assert.doesNotMatch(stage, /KlineViewportControls|chart-nudge|chart-hint/);
  assert.match(marketChart.slice(dockStart, stageStart), /KlineViewportControls className="is-inline"/);
  assert.match(globalStyles, /\.chart-nudge \{[\s\S]*?position: static;/);
  assert.match(appleStyles, /\.kline-viewport-controls\.is-inline \{ position: static; \}/);
});

test("keeps the detached chart controls responsive and visible", () => {
  assert.match(globalStyles, /\.market-chart-control-dock \{[\s\S]*?display: flex;[\s\S]*?justify-content: space-between;/);
  assert.match(globalStyles, /\.market-chart-control-actions \{[\s\S]*?flex: 0 0 auto;[\s\S]*?gap: 8px;/);
  assert.match(globalStyles, /\.chart-nudge:hover,[\s\S]*?\.chart-nudge:focus-visible/);
});
