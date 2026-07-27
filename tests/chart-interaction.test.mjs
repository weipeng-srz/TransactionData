import assert from "node:assert/strict";
import test from "node:test";

import { plotIndexFromPointer } from "../app/lib/chartInteraction.ts";

const chart = {
  containerWidth: 360,
  viewBoxWidth: 720,
  plotLeft: 8,
  plotWidth: 660,
  pointCount: 60,
};

test("maps VIX hover positions against the plot area rather than the full SVG", () => {
  assert.equal(plotIndexFromPointer({ ...chart, pointerX: 0 }), 0);
  assert.equal(plotIndexFromPointer({ ...chart, pointerX: 4 }), 0);
  assert.equal(plotIndexFromPointer({ ...chart, pointerX: 169 }), 30);
  assert.equal(plotIndexFromPointer({ ...chart, pointerX: 334 }), 59);
  assert.equal(plotIndexFromPointer({ ...chart, pointerX: 360 }), 59);
});

test("keeps hover indexing safe for empty and single-point charts", () => {
  assert.equal(plotIndexFromPointer({ ...chart, pointCount: 0, pointerX: 120 }), 0);
  assert.equal(plotIndexFromPointer({ ...chart, pointCount: 1, pointerX: 300 }), 0);
  assert.equal(plotIndexFromPointer({ ...chart, containerWidth: 0, pointerX: 0 }), 0);
});
