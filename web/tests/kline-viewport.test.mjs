import assert from "node:assert/strict";
import test from "node:test";

import {
  getKlineWheelIntent,
  klineRangeLength,
  normalizeKlineRange,
  normalizeWheelDelta,
  panKlineRange,
  rangeForLatest,
  resolveKlineDragIntent,
  wheelDeltaToKlinePan,
  zoomKlineRange,
} from "../app/lib/klineViewport.ts";

test("builds and normalizes latest K-line ranges", () => {
  assert.deepEqual(rangeForLatest(300, 60), { from: 240, to: 299 });
  assert.deepEqual(rangeForLatest(8, 60), { from: 0, to: 7 });
  assert.deepEqual(normalizeKlineRange({ from: -8, to: 900 }, 300), { from: 0, to: 299 });
});

test("zooms around the pointer anchor and keeps it stable", () => {
  const range = { from: 100, to: 199 };
  const left = zoomKlineRange({ range, total: 400, deltaY: -120, anchorRatio: 0, minVisible: 10 });
  const right = zoomKlineRange({ range, total: 400, deltaY: -120, anchorRatio: 1, minVisible: 10 });
  const middle = zoomKlineRange({ range, total: 400, deltaY: -120, anchorRatio: .5, minVisible: 10 });

  assert.equal(left.from, 100);
  assert.equal(right.to, 199);
  assert.ok(middle.from > 100 && middle.to < 199);
  assert.ok(klineRangeLength(middle) < klineRangeLength(range));
});

test("clamps zoom density and pan boundaries", () => {
  const zoomedIn = zoomKlineRange({ range: { from: 90, to: 99 }, total: 100, deltaY: -240, anchorRatio: 1, minVisible: 10 });
  const zoomedOut = zoomKlineRange({ range: { from: 80, to: 99 }, total: 100, deltaY: 10_000, anchorRatio: 1, minVisible: 10 });

  assert.equal(klineRangeLength(zoomedIn), 10);
  assert.ok(klineRangeLength(zoomedOut) > 20);
  assert.deepEqual(panKlineRange({ from: 20, to: 39 }, 100, -999), { from: 0, to: 19 });
  assert.deepEqual(panKlineRange({ from: 20, to: 39 }, 100, 999), { from: 80, to: 99 });
  assert.equal(normalizeWheelDelta(3, 1), 48);
  assert.equal(normalizeWheelDelta(1, 2, 640), 640);
});

test("keeps ordinary wheel scrolling with the page and reserves modifiers for chart navigation", () => {
  assert.equal(getKlineWheelIntent({ ctrlKey: false, metaKey: false, shiftKey: false }), "page");
  assert.equal(getKlineWheelIntent({ ctrlKey: true, metaKey: false, shiftKey: false }), "zoom");
  assert.equal(getKlineWheelIntent({ ctrlKey: false, metaKey: true, shiftKey: false }), "zoom");
  assert.equal(getKlineWheelIntent({ ctrlKey: false, metaKey: false, shiftKey: true }), "pan");
  assert.equal(getKlineWheelIntent({ ctrlKey: true, metaKey: false, shiftKey: true }), "zoom");
});

test("locks touch gestures to their first deliberate direction", () => {
  assert.equal(resolveKlineDragIntent(3, 2), "pending");
  assert.equal(resolveKlineDragIntent(12, 3), "horizontal");
  assert.equal(resolveKlineDragIntent(3, 12), "vertical");
  assert.equal(resolveKlineDragIntent(9, 9), "vertical");
});

test("converts deliberate Shift-wheel movement into bounded candle steps", () => {
  assert.equal(wheelDeltaToKlinePan(4, 60), 0);
  assert.equal(wheelDeltaToKlinePan(100, 60), 5);
  assert.equal(wheelDeltaToKlinePan(-100, 20), -2);
  assert.equal(wheelDeltaToKlinePan(Number.NaN, 60), 0);
});
