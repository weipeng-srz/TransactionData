import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { compactNumber, formatNumber } from "../app/lib/market.ts";

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

const chartRequire = createRequire(import.meta.url);
const compiledChart = ts.transpileModule(chartSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function mountHoverChart(candles, range = { from: 0, to: candles.length - 1 }) {
  const slots = [];
  const hoveredIndexes = [];
  let cursor = 0;
  const hooks = {
    memo: component => component,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(create, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || dependencies.some((dependency, i) => !Object.is(dependency, previous.dependencies[i]))) {
        slots[index] = { dependencies, value: create() };
      }
      return slots[index].value;
    },
    useCallback: callback => callback,
    // These tests exercise rendered tooltip state; canvas painting and DOM observers are not mounted.
    useEffect() {},
  };
  const modules = {
    react: hooks,
    "./KlineViewportControls": { __esModule: true, default: () => null },
    "../lib/klineViewport": {},
    "../lib/market": { compactNumber, formatNumber },
  };
  const sandbox = { exports: {}, require: name => modules[name] ?? chartRequire(name) };
  vm.runInNewContext(compiledChart, sandbox);
  let props = {
    appearance: "light", candles, range, resetVisible: 120,
    indicators: { guidePoints: [] }, overlays: {}, lowerIndicator: "VOL",
    events: [], annotations: [], onRangeChange() {}, onHover: index => hoveredIndexes.push(index),
  };
  const render = (nextProps = {}) => {
    props = { ...props, ...nextProps };
    cursor = 0;
    return sandbox.exports.default(props);
  };
  return {
    render,
    hoveredIndexes,
    press(key) {
      let prevented = false;
      findChartNode(render(), node => node.type === "canvas").props.onKeyDown({
        key, preventDefault() { prevented = true; },
      });
      assert.equal(prevented, true);
      return render();
    },
  };
}

function findChartNode(tree, matches) {
  if (Array.isArray(tree)) return tree.map(child => findChartNode(child, matches)).find(Boolean);
  if (!tree || typeof tree !== "object") return undefined;
  return matches(tree) ? tree : findChartNode(tree.props?.children, matches);
}

function chartNodeText(node) {
  if (Array.isArray(node)) return node.map(chartNodeText).join("");
  if (node == null || typeof node === "boolean") return "";
  return typeof node === "object" ? chartNodeText(node.props?.children) : String(node);
}

function dailyCandlesForHover(closes) {
  return closes.map((close, index) => {
    const date = `2026-10-${String(index + 1).padStart(2, "0")}`;
    return {
      key: date, label: date.slice(5), date, time: "", open: close, high: close, low: close, close,
      volume: 100, amount: 1000, adjustedAmount: 1000, vwap: 10,
      turnoverPct: null, change: 0, changePct: 0,
    };
  });
}

function readChangeToLatest(tree) {
  const tooltip = findChartNode(tree, node => node.props?.role === "tooltip");
  assert.ok(tooltip, "keyboard navigation should show the real chart tooltip");
  const metric = findChartNode(tooltip, node => node.props?.className === "chart-day-return");
  if (!metric) return null;
  const value = findChartNode(metric, node => node.type === "dd");
  return {
    label: chartNodeText(findChartNode(metric, node => node.type === "dt")),
    value: chartNodeText(value),
    tone: value.props.className,
  };
}

test("daily hover compares against the complete series even when the latest candle is outside the viewport", () => {
  const chart = mountHoverChart(dailyCandlesForHover([100, 110, 125]), { from: 0, to: 1 });
  const metric = readChangeToLatest(chart.press("ArrowLeft"));
  assert.deepEqual(chart.hoveredIndexes, [0]);
  assert.deepEqual(metric, { label: "距今涨跌幅截至 2026-10-03", value: "+25.00%", tone: "is-up" });
});

test("daily hover shows negative returns and a neutral zero for the latest candle", () => {
  const chart = mountHoverChart(dailyCandlesForHover([100, 80]));
  assert.equal(readChangeToLatest(chart.press("ArrowLeft")).value, "-20.00%");
  assert.equal(readChangeToLatest(chart.render()).tone, "is-down");
  assert.deepEqual(readChangeToLatest(chart.press("ArrowRight")), {
    label: "距今涨跌幅截至 2026-10-02", value: "0.00%", tone: "",
  });
});

test("daily hover treats invalid, non-positive, and overflowing price comparisons as unavailable", () => {
  const invalidPrices = [0, -1, NaN, Infinity, -Infinity, null, undefined];
  const cases = invalidPrices.flatMap(price => [[price, 100], [100, price]]);
  cases.push([0, 0], [Number.MIN_VALUE, Number.MAX_VALUE]);
  for (const closes of cases) {
    const chart = mountHoverChart(dailyCandlesForHover(closes));
    const metric = readChangeToLatest(chart.press("ArrowLeft"));
    assert.equal(metric.value, "—", `unavailable comparison for closes ${closes.map(String).join(", ")}`);
    assert.equal(metric.tone, "");
  }
});

test("intraday hover does not show the daily change-to-latest metric", () => {
  const candles = dailyCandlesForHover([100, 120]).map((candle, index) => ({
    ...candle, time: `09:${30 + index}:00`,
  }));
  assert.equal(readChangeToLatest(mountHoverChart(candles).press("ArrowLeft")), null);
});

test("daily hover recomputes when the latest price updates without another hover event", () => {
  const candles = dailyCandlesForHover([100, 110, 125]);
  const chart = mountHoverChart(candles, { from: 0, to: 1 });
  assert.equal(readChangeToLatest(chart.press("ArrowLeft")).value, "+25.00%");
  const refreshed = candles.map((candle, index) => index === 2 ? { ...candle, close: 80 } : candle);
  assert.deepEqual(readChangeToLatest(chart.render({ candles: refreshed })), {
    label: "距今涨跌幅截至 2026-10-03", value: "-20.00%", tone: "is-down",
  });
  assert.deepEqual(chart.hoveredIndexes, [0]);
});
