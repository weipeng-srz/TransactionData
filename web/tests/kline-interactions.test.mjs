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
    assert.match(source, /getKlineWheelIntent/);
    assert.match(source, /normalizeWheelDelta/);
    assert.match(source, /panKlineRange/);
    assert.match(source, /resolveKlineDragIntent/);
    assert.match(source, /wheelDeltaToKlinePan/);
    assert.match(source, /zoomKlineRange/);
    assert.match(source, /onDoubleClick=/);
    assert.match(source, /onLostPointerCapture=/);
  }

  assert.equal((globalCharts.match(/<KlineViewportControls/g) ?? []).length, 2);
  assert.equal((globalCharts.match(/onWheel=/g) ?? []).length, 2);
});

test("lets ordinary wheel events scroll the page before chart code can cancel them", () => {
  for (const source of [marketChart, realtimeChart, globalCharts]) {
    const handlers = source.match(/onWheel=\{\(event\) => \{[\s\S]*?\n\s*\}\}/g) ?? [];
    assert.ok(handlers.length > 0);
    for (const handler of handlers) {
      const pageReturn = handler.indexOf('if (wheelIntent === "page") return;');
      const cancellation = handler.indexOf("event.preventDefault()");
      assert.ok(pageReturn >= 0 && cancellation > pageReturn);
    }
  }
});

test("uses an eight-pixel touch direction lock and leaves pinch zoom to the browser", () => {
  const combined = `${marketChart}\n${realtimeChart}\n${globalCharts}`;
  assert.equal((combined.match(/resolveKlineDragIntent\(/g) ?? []).length, 4);
  assert.equal((combined.match(/touchAction:\s*"pan-y pinch-zoom"/g) ?? []).length, 4);
  assert.equal((combined.match(/event\.pointerType === "touch" \? "pending" : "horizontal"/g) ?? []).length, 4);
});

test("shows minute-chart instructions that match the guarded wheel behavior", () => {
  assert.doesNotMatch(realtimeChart, />滚轮缩放 · 横向拖拽/);
  assert.match(realtimeChart, /普通滚轮滚页面/);
  assert.match(realtimeChart, /Ctrl\/⌘ \+ 滚轮缩放/);
  assert.match(realtimeChart, /Shift \+ 滚轮\/横拖平移/);
});

test("keeps K-line stages draggable without stealing vertical touch scrolling", () => {
  assert.match(`${appleStyles}\n${refinementStyles}`, /touch-action:\s*pan-y/);
  assert.match(globalStyles, /touch-action:\s*pan-y/);
  assert.match(`${appleStyles}\n${refinementStyles}\n${globalStyles}`, /cursor:\s*grabbing/);
});
