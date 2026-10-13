import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { stockRouteKey } from "../app/lib/security.ts";

// Render the actual presentation components without bundler-specific CSS loading.
function loadView(name) {
  const source = readFileSync(new URL(`../app/features/screener/${name}.tsx`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require(module) {
      if (module === "react/jsx-runtime") return jsxRuntime;
      if (module === "next/link") return { default: (props) => React.createElement("a", props) };
      if (module.endsWith("security")) return { stockRouteKey };
      if (module.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => key }) };
      throw new Error(`Unexpected view dependency: ${module}`);
    },
  });
  return exports.default;
}

const ResearchPoolView = loadView("ResearchPoolView");
const StrategyEvidenceView = loadView("StrategyEvidenceView");
const entries = Array.from({ length: 30 }, (_, index) => ({
  market: "CN", symbol: String(index + 1).padStart(6, "0"), name: `观察记录${index + 1}`,
  sector: "测试行业", risk: 40, score: 70, addedAt: "2026-10-09T08:00:00.000Z",
}));
const poolProps = { entries, averageRisk: 40, sector: "测试行业", dateLabel: () => "10月9日", onOpen: () => false };

function descendants(node, predicate) {
  if (!node || typeof node !== "object") return [];
  const children = React.Children.toArray(node.props?.children);
  return [...(predicate(node) ? [node] : []), ...children.flatMap((child) => descendants(child, predicate))];
}

test("research pool renders every saved entry including the ninth and thirtieth without a feed", () => {
  const html = renderToStaticMarkup(React.createElement(ResearchPoolView, poolProps));
  assert.equal((html.match(/<a /g) ?? []).length, 30);
  for (const index of [9, 30]) {
    assert.match(html, new RegExp(`观察记录${index}<`));
    assert.ok(html.includes(`href="/?stock=${String(index).padStart(6, "0")}"`));
  }
  assert.match(html, /线索保留 30 天/);
  assert.match(html, /平均风险/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("saved observations retain their market in direct research links", () => {
  const usEntry = { ...entries[0], market: "US", symbol: "BRK.B", name: "Berkshire" };
  const html = renderToStaticMarkup(React.createElement(ResearchPoolView, { ...poolProps, entries: [usEntry] }));
  assert.ok(html.includes(`href="/?stock=${encodeURIComponent(stockRouteKey({ code: usEntry.symbol, market: usEntry.market }))}"`));
});

test("pool opens a current-feed drawer when available and otherwise leaves its direct link usable", () => {
  for (const available of [true, false]) {
    let selected;
    let prevented = false;
    const tree = ResearchPoolView({ ...poolProps, onOpen: (entry) => { selected = entry; return available; } });
    const links = descendants(tree, (node) => typeof node.props?.href === "string");
    links[29].props.onClick({ preventDefault() { prevented = true; } });
    assert.equal(selected, entries[29]);
    assert.equal(prevented, available);
  }
});

test("empty pool explains its own lifecycle without a request-dependent loading gate", () => {
  const html = renderToStaticMarkup(React.createElement(ResearchPoolView, { ...poolProps, entries: [] }));
  assert.match(html, /从候选卡片或机会详情加入/);
  assert.doesNotMatch(html, /平均风险|NaN|<a /);
});

test("strategy evidence keeps observed metrics, negative returns and methodology access", () => {
  const item = { strategy: "趋势突破", sampleSize: 17, winRate1D: 52.9, medianReturn1D: -0.2, averageReturn3D: 1.2, averageMfe3D: 2.4, averageMae3D: -1.5, window: "最近90日", methodology: "真实信号" };
  let selected;
  const props = { items: [item], onMethod: (value) => { selected = value; }, formatReturn: (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`, returnClass: (value) => value < 0 ? "fall" : "rise" };
  const html = renderToStaticMarkup(React.createElement(StrategyEvidenceView, props));
  assert.match(html, /17 次样本/);
  assert.match(html, /52\.9%/);
  assert.match(html, /-0\.20%/);
  assert.match(html, /\+2\.40% \/ -1\.50%/);
  descendants(StrategyEvidenceView(props), (node) => node.type === "button")[0].props.onClick();
  assert.equal(selected, item);
  const empty = renderToStaticMarkup(React.createElement(StrategyEvidenceView, { ...props, items: [] }));
  assert.match(empty, /不会生成模拟胜率/);
});
