import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const marketChart = readFileSync(new URL("../app/components/MarketChart.tsx", import.meta.url), "utf8");
const realtimeChart = readFileSync(new URL("../app/components/RealtimeTradingPanel.tsx", import.meta.url), "utf8");
const globalCharts = readFileSync(new URL("../app/global-markets/page.tsx", import.meta.url), "utf8");
const appleStyles = readFileSync(new URL("../app/apple.css", import.meta.url), "utf8");
const refinementStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/global-markets/global-markets.css", import.meta.url), "utf8");

test("uses the shared continuous viewport interaction across every K-line chart", () => {
  for (const source of [marketChart, realtimeChart, globalCharts]) {
    assert.match(source, /KlineViewportControls/);
    assert.match(source, /normalizeWheelDelta/);
    assert.match(source, /panKlineRange/);
    assert.match(source, /zoomKlineRange/);
    assert.match(source, /onDoubleClick=/);
    assert.match(source, /onLostPointerCapture=/);
  }

  assert.equal((globalCharts.match(/<KlineViewportControls/g) ?? []).length, 2);
  assert.equal((globalCharts.match(/onWheel=/g) ?? []).length, 2);
});

test("keeps K-line stages draggable without stealing vertical touch scrolling", () => {
  assert.match(`${appleStyles}\n${refinementStyles}`, /touch-action:\s*pan-y/);
  assert.match(globalStyles, /touch-action:\s*pan-y/);
  assert.match(`${appleStyles}\n${refinementStyles}\n${globalStyles}`, /cursor:\s*grabbing/);
});
