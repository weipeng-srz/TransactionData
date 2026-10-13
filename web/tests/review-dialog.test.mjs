import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const source = readFileSync(new URL("../app/features/review/ReviewDialog.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function dialogHarness() {
  let effect;
  let focused = 0;
  let restored = 0;
  let closed = 0;
  const exports = {};
  class Element { isConnected = true; focus() { restored += 1; } }
  const document = { activeElement: new Element(), body: { style: { overflow: "clip" } } };
  const native = { open: false, showModal() { this.open = true; }, close() { this.open = false; }, querySelector() { return { focus() { focused += 1; } }; } };
  vm.runInNewContext(compiled, {
    exports, document, HTMLElement: Element,
    require(name) {
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name === "react") return { useRef: () => ({ current: native }), useId: () => "dialog-title", useEffect(callback) { effect = callback; } };
      throw new Error(name);
    },
  });
  return { document, native, render(open = true, busy = false) { return exports.default({ open, busy, title: "填写复盘", children: "form", onClose() { closed += 1; } }); }, effect: () => effect(), state: () => ({ focused, restored, closed }) };
}

function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props?.children).flatMap((child) => nodes(child, predicate))];
}

test("review opens a native modal, locks background scroll, focuses its first field and restores trigger on cleanup", () => {
  const harness = dialogHarness();
  const tree = harness.render();
  assert.equal(tree.type, "dialog", "native modal supplies focus trapping and background inertness");
  assert.equal(tree.props["aria-labelledby"], "dialog-title");
  const cleanup = harness.effect();
  assert.equal(harness.native.open, true);
  assert.equal(harness.document.body.style.overflow, "hidden");
  assert.equal(harness.state().focused, 1);
  cleanup();
  assert.equal(harness.native.open, false);
  assert.equal(harness.document.body.style.overflow, "clip", "restore the original body overflow rather than guessing it");
  assert.equal(harness.state().restored, 1);
});

test("Escape calls controlled close, saving blocks dismissal, and backdrop clicks never discard edits", () => {
  const harness = dialogHarness();
  let prevented = 0;
  let tree = harness.render();
  tree.props.onCancel({ preventDefault() { prevented += 1; } });
  assert.equal(prevented, 1);
  assert.equal(harness.state().closed, 1);
  assert.equal(tree.props.onClick, undefined, "there is no backdrop handler that can lose draft input");
  tree = harness.render(true, true);
  tree.props.onCancel({ preventDefault() { prevented += 1; } });
  assert.equal(harness.state().closed, 1);
  assert.equal(nodes(tree, (node) => node.type === "button")[0].props.disabled, true);
  assert.equal(harness.render(false), null);
});
