import assert from "node:assert/strict";
import test from "node:test";

import { GLOBAL_INDEXES } from "../app/lib/globalIndexes.ts";
import { projectRobinsonPoint } from "../app/lib/robinsonProjection.ts";
import { US_INDEXES } from "../app/lib/usMarketIndexes.ts";

test("projects exchange coordinates into the exact Robinson map viewBox", () => {
  assert.deepEqual(projectRobinsonPoint(0, 0), { x: 0, y: -0, left: 50, top: 50 });

  const newYork = projectRobinsonPoint(-74.006, 40.7128);
  assert.ok(newYork.left > 30 && newYork.left < 34);
  assert.ok(newYork.top > 24 && newYork.top < 28);

  const shanghai = projectRobinsonPoint(121.4737, 31.2304);
  assert.ok(shanghai.left > 81 && shanghai.left < 84);
  assert.ok(shanghai.top > 30 && shanghai.top < 34);

  const sydney = projectRobinsonPoint(151.2093, -33.8688);
  assert.ok(sydney.left > 88 && sydney.left < 91);
  assert.ok(sydney.top > 68 && sydney.top < 73);
});

test("keeps every mapped market inside the visible land projection", () => {
  const definitions = [...GLOBAL_INDEXES, ...US_INDEXES].filter((item) => item.map);
  assert.equal(definitions.length, 13);

  for (const definition of definitions) {
    const point = projectRobinsonPoint(definition.map.longitude, definition.map.latitude);
    assert.ok(point.left > 8 && point.left < 92, `${definition.name} horizontal position drifted`);
    assert.ok(point.top > 12 && point.top < 82, `${definition.name} vertical position drifted`);
  }
});
