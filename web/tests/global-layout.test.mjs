import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/global-markets/page.tsx", import.meta.url), "utf8");

test("renders the A-share board before the global map and loads the map as an image", () => {
  const aSharePosition = pageSource.indexOf('className="global-a-share-board"');
  const mapPosition = pageSource.indexOf('className="global-map-card"');

  assert.ok(aSharePosition >= 0);
  assert.ok(mapPosition > aSharePosition);
  assert.match(pageSource, /<img className="global-map-land" src="\/world-map-robinson\.svg"/);
  assert.match(pageSource, /<MarketMapMarker/);
  assert.doesNotMatch(pageSource, /global-map-region-label/);
  assert.doesNotMatch(pageSource, /<button[^>]+global-map-marker/);
  assert.doesNotMatch(pageSource, /global-marker-dot/);
});
