import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { accountStorage } from "../app/lib/accountStorage.ts";

function researchNotes(props) {
  const slots = [];
  let cursor = 0;
  const exports = {};
  const source = readFileSync(new URL("../app/components/ResearchDock.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === "../lib/accountStorage") return { accountStorage };
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name === "react") return {
        useState(initial) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = initial;
          return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
        },
        useEffect() {},
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return () => { cursor = 0; return exports.default(props); };
}

function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props?.children).flatMap((child) => nodes(child, predicate))];
}

const annotations = Array.from({ length: 12 }, (_, index) => ({ id: `note-${index}`, code: "000001", date: "2026-10-09", text: `记录 ${index}` }));
const props = {
  code: "000001", name: "测试股票", annotations, freshness: { market: "", financial: "", news: "" },
  dataProfile: { qualityWarnings: 0 }, cloudStatus: "local", hideWorkspaceActions: true,
};

test("all historical annotations remain reachable while notes for other stocks stay isolated", () => {
  let removed;
  const render = researchNotes({ ...props, annotations: [...annotations, { ...annotations[0], id: "other", code: "600000" }], onRemoveAnnotation: (id) => { removed = id; } });
  let tree = render();
  assert.equal(nodes(tree, (node) => node.type === "article").length, 8);
  nodes(tree, (node) => node.props?.["aria-expanded"] === false)[0].props.onClick();
  tree = render();
  assert.equal(nodes(tree, (node) => node.type === "article").length, 12);
  const buttons = nodes(tree, (node) => node.props?.["aria-label"] === "删除研究标注");
  buttons[11].props.onClick();
  assert.equal(removed, "note-11");
  nodes(tree, (node) => node.props?.["aria-expanded"] === true)[0].props.onClick();
  assert.equal(nodes(render(), (node) => node.type === "article").length, 8);
});

test("workspace action consolidation retains save, restore, export and print callbacks", () => {
  const calls = [];
  const render = researchNotes({ ...props, hasSavedView: true,
    onSaveView: () => calls.push("save"), onRestoreView: () => calls.push("restore"),
    onExportReport: () => calls.push("export"), onPrint: () => calls.push("print"),
  });
  const buttons = nodes(render(), (node) => node.type === "button");
  for (const label of ["保存视图", "恢复视图", "导出报告", "打印 / PDF"]) {
    const button = buttons.find((node) => node.props.children === label);
    assert.ok(button);
    button.props.onClick();
  }
  assert.deepEqual(calls, ["save", "restore", "export", "print"]);
  assert.ok(!buttons.some((node) => ["刷新当前股票", "分享当前研究"].includes(node.props.children)));
});
