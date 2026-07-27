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

test("pins every market to the reviewed exchange-location coordinate", () => {
  const coordinates = new Map(
    [...GLOBAL_INDEXES, ...US_INDEXES]
      .filter((item) => item.map)
      .map((item) => [item.id, [item.map.longitude, item.map.latitude]]),
  );

  assert.deepEqual(Object.fromEntries(coordinates), {
    tsx: [-79.3841, 43.6486],
    bovespa: [-46.6356, -23.5456],
    ftse: [-0.0994, 51.5151],
    dax: [8.6777, 50.1151],
    cac: [2.3522, 48.8566],
    sensex: [72.8777, 18.9297],
    shanghai: [121.475, 31.2359],
    hsi: [114.1589, 22.2847],
    nikkei: [139.7777, 35.6827],
    kospi: [126.924, 37.5234],
    sti: [103.8507, 1.2791],
    asx: [151.2094, -33.8648],
    dow: [-74.0113, 40.7069],
  });
});
