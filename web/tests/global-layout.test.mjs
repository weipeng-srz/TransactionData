import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/global-markets/page.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/global-markets/global-markets.css", import.meta.url), "utf8");

test("renders the A-share board before the global map and loads the map as an image", () => {
  const aSharePosition = pageSource.indexOf('className="global-a-share-board"');
  const shanghaiChartPosition = pageSource.indexOf("<ShanghaiIndexPanel");
  const mapPosition = pageSource.indexOf('className="global-map-card"');

  assert.ok(aSharePosition >= 0);
  assert.ok(shanghaiChartPosition > aSharePosition);
  assert.ok(mapPosition > shanghaiChartPosition);
  assert.ok(mapPosition > aSharePosition);
  assert.match(pageSource, /<img className="global-map-land" src="\/world-map-robinson\.svg"/);
  assert.match(pageSource, /<MarketMapMarker/);
  assert.doesNotMatch(pageSource, /global-map-region-label/);
  assert.doesNotMatch(pageSource, /<button[^>]+global-map-marker/);
  assert.doesNotMatch(pageSource, /global-marker-dot/);
});

test("shows Shanghai Composite candles, whole-market turnover states and volume analysis", () => {
  assert.match(pageSource, /上证指数日 K 与沪深两市成交额/);
  assert.match(pageSource, /实心放量 \/ 斜纹缩量 \/ 虚线20日均额/);
  assert.match(pageSource, /上证与深证综指成交额按日求和/);
  assert.match(pageSource, /analyzeShanghaiIndexHistory/);
  assert.match(pageSource, /onPointerLeave=\{\(\) => \{ if \(!dragRef\.current\) setHoverIndex\(null\); \}\}/);
  assert.match(pageSource, /activeX < width \/ 2 \? "is-edge-end" : "is-edge-start"/);
  assert.match(pageSource, /<KlineViewportControls/);
  assert.match(pageSource, /zoomKlineRange/);
  assert.match(pageSource, /panKlineRange/);
  assert.match(pageSource, /onDoubleClick=/);
  assert.match(globalStyles, /\.shanghai-amount-bar\.is-contract/);
  assert.match(globalStyles, /shanghai-volume-contraction/);
  assert.match(globalStyles, /\.global-shanghai-tooltip\.is-edge-start/);
});

test("shows VIX coordinates only while the pointer is inside the chart", () => {
  assert.match(pageSource, /onPointerLeave=\{\(\) => \{ if \(!dragRef\.current\) setHoverIndex\(null\); \}\}/);
  assert.match(pageSource, /hoverIndex == null \|\| !visible\.length \? null/);
  assert.doesNotMatch(pageSource, /fear-crosshair-point/);
  assert.doesNotMatch(globalStyles, /\.fear-crosshair-point/);
});
