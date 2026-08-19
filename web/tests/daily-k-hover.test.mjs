import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chartSource = readFileSync(new URL("../app/components/MarketChart.tsx", import.meta.url), "utf8");
const chartStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");

test("shows complete daily candle basics in the chart hover tooltip", () => {
  assert.match(chartSource, /id="chart-day-tooltip"/);
  assert.match(chartSource, /role="tooltip"/);
  assert.match(chartSource, /悬停或使用左右方向键可逐根查看开高低收、成交量与成交额/);
  assert.match(chartSource, /event\.key === "Escape"[\s\S]*?setHover\(null\);[\s\S]*?onHover\(null\);/);
  for (const label of ["开盘", "最高", "最低", "收盘", "成交量", "成交额", "均价", "换手率"]) {
    assert.match(chartSource, new RegExp(`<dt>${label}<\\/dt>`));
  }
  assert.match(chartSource, /compactNumber\(hoveredCandle\.volume\)/);
  assert.match(chartSource, /compactNumber\(hoveredCandle\.amount\)/);
  assert.match(chartSource, /formatNumber\(hoveredCandle\.changePct, 2\)/);
  assert.match(chartSource, /const rangeSignature = `\$\{range\.from\}:\$\{range\.to\}:\$\{candles\.length\}:\$\{candles\[range\.from\]\?\.key \?\? ""\}:\$\{candles\[range\.to\]\?\.key \?\? ""\}`;/);
  assert.match(chartSource, /const rangeEpoch = useMemo\(\(\) => Symbol\(`market-chart-range:\$\{rangeSignature\}`\), \[rangeSignature\]\);/);
  assert.match(chartSource, /hover\.rangeEpoch === rangeEpoch[\s\S]*?hover\.index >= range\.from/);
  assert.match(chartSource, /if \(hover\.rangeEpoch !== rangeEpoch \|\| !candles\[hover\.index\]\) onHover\(null\);/);
  assert.match(chartSource, /if \(hover\?\.rangeEpoch === rangeEpoch && hover\.index === index\) \{[\s\S]*?crossedMidline[\s\S]*?return;/);
  assert.match(chartSource, /const current = hover\?\.rangeEpoch === rangeEpoch \? hover\.index : range\.to;/);
  assert.match(chartSource, /style=\{hover\.x < size\.width \/ 2 \? \{ right: size\.width < 420 \? 84 : 112 \} : \{ left: 44 \}\}/);
  assert.match(chartSource, /candles\.length \? `当前显示第 \$\{range\.from \+ 1\} 到 \$\{range\.to \+ 1\} 根` : "暂无可显示 K 线"/);
});

test("keeps the daily tooltip readable without intercepting chart gestures", () => {
  assert.match(chartStyles, /\.chart-float\.chart-day-tooltip \{[\s\S]*?width: min\(264px, calc\(100% - 96px\)\);[\s\S]*?top: 60px;[\s\S]*?display: grid;[\s\S]*?pointer-events: none;/);
  assert.match(chartStyles, /\.chart-day-stats \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(chartStyles, /\.chart-day-stats > div:nth-last-child\(-n \+ 2\) \{ border-bottom: 0; \}/);
  assert.match(chartStyles, /@media \(max-width: 820px\) \{[\s\S]*?\.chart-float\.chart-day-tooltip \{ top: 68px; \}/);
  assert.doesNotMatch(chartSource, /style=\{\{[^}]*top:/);
  assert.match(chartSource, /onPointerMove=\{\(event\) => \{[\s\S]*?updateHover\(event\.clientX, event\.clientY\)/);
  assert.match(chartSource, /setHover\(null\);[\s\S]*?onHover\(null\);/);
  assert.match(chartSource, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"[\s\S]*?if \(!candles\.length\) return;/);
  assert.match(chartSource, /if \(visible\.length === 0\) \{[\s\S]*?layoutRef\.current = null;/);
  assert.match(chartSource, /width: Math\.max\(1, entry\.contentRect\.width\), height: Math\.max\(1, entry\.contentRect\.height\)/);
  assert.doesNotMatch(chartSource, /width: Math\.max\(320, entry\.contentRect\.width\)/);
});
