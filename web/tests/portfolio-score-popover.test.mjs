import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/features/portfolio/PortfolioStockList.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(`${source}\nexport { WatchlistScoreBadge };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function mountBadge(mobile) {
  const slots = [];
  let cursor = 0;
  let focused = 0;
  const trigger = { focus: options => { assert.equal(options.preventScroll, true); focused++; } };
  const anchor = { getBoundingClientRect: () => ({ left: 24, top: 560, bottom: 610 }), querySelector: () => trigger };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial ?? anchor };
      return slots[index];
    },
    useId: () => "test-prediction",
  };
  const modules = {
    react: hooks,
    "react-dom": { createPortal: node => node },
    "../../lib/market": { formatNumber: value => String(value) },
    "../../lib/holdings": {}, "../../lib/security": {}, "../../lib/portfolioPresentation": {},
    "../../lib/portfolioPrediction": { buildPortfolioPredictionConclusion: () => ({ tone: "hold", action: "持有观察", mark: "B" }) },
    "./formatting": { probabilityPercent: value => `${value * 100}%`, signedPercent: value => `${value}%` },
    "./PortfolioStockList.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
  };
  const sandbox = {
    exports: {}, require: name => modules[name] ?? require(name), document: { body: {} },
    window: { innerWidth: mobile ? 320 : 1440, innerHeight: 680, matchMedia: () => ({ matches: mobile }) },
  };
  vm.runInNewContext(code, sandbox);
  const prediction = {
    target: { label: "明日" }, prediction: { upProbability: .6, expectedCloseReturn: .01 },
    signal: { decisionConfidence: 70, ensembleAgreement: .7 },
    decisionSupport: { summary: "样本说明", takeProfitReference: 12, riskReference: 9, checks: ["风险口径"] },
    externalContext: { market: { available: true }, news: { itemCount: 1 } }, modelValidation: {},
    asOf: "2026-10-13", asOfTime: "15:00",
  };
  return {
    render() { cursor = 0; return sandbox.exports.WatchlistScoreBadge({ prediction, stockName: "测试证券", hasHolding: false, scoreReport: null, onOpen() {}, onEdit() {} }); },
    get focused() { return focused; },
  };
}

const popover = tree => tree.props.children[2];
const trigger = tree => tree.props.children[0];

test("mobile pointer focus and compatibility mouse events do not undo a tap; close returns focus", () => {
  const badge = mountBadge(true);
  let tree = badge.render();
  tree.props.onMouseEnter();
  tree.props.onFocusCapture();
  trigger(tree).props.onPointerUp({ pointerType: "touch" });
  assert.equal(popover(badge.render()), null);
  trigger(tree).props.onClick();
  tree = badge.render();
  assert.equal(popover(tree).props.role, "region");
  assert.equal(trigger(tree).props["aria-expanded"], true);
  tree.props.onBlurCapture();
  tree.props.onMouseLeave();
  tree = badge.render();
  assert.ok(popover(tree));
  const close = popover(tree).props.children[0];
  assert.equal(close.props.children, "关闭预测说明");
  close.props.onClick();
  assert.equal(popover(badge.render()), null);
  assert.equal(badge.focused, 1);
});

test("mobile can toggle the prediction closed and Escape remains an explicit exit", () => {
  const badge = mountBadge(true);
  trigger(badge.render()).props.onClick();
  trigger(badge.render()).props.onClick();
  assert.equal(popover(badge.render()), null);
  trigger(badge.render()).props.onClick();
  let stopped = false;
  badge.render().props.onKeyDown({ key: "Escape", stopPropagation: () => { stopped = true; } });
  assert.equal(popover(badge.render()), null);
  assert.equal(stopped, true);
  assert.equal(badge.focused, 1);
});

test("desktop retains hover and keyboard focus tooltip behavior", () => {
  const badge = mountBadge(false);
  badge.render().props.onMouseEnter();
  assert.equal(popover(badge.render()).props.role, "tooltip");
  trigger(badge.render()).props.onClick();
  assert.ok(popover(badge.render()));
  badge.render().props.onMouseLeave();
  assert.equal(popover(badge.render()), null);
  badge.render().props.onFocusCapture();
  assert.ok(popover(badge.render()));
  badge.render().props.onBlurCapture();
  assert.equal(popover(badge.render()), null);
});
