import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("model calculations begin on first visit and the same child remains mounted after leaving", () => {
  const source = readFileSync(new URL("../app/features/stock/StockModelContent.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let visited;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require(name) {
      assert.equal(name, "react");
      return { useState(initial) { visited ??= initial; return [visited, (value) => { visited = value; }]; } };
    },
  });
  const children = { predictionControls: "same component instance" };
  assert.equal(exports.default({ active: false, children }), null);
  assert.equal(exports.default({ active: true, children }), children);
  assert.equal(exports.default({ active: false, children }), children);
  assert.equal(exports.default({ active: true, children }), children);
});
