import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("print prepares lazy panels, expands details and restores the previous disclosure state", async () => {
  const source = readFileSync(new URL("../app/hooks/useResearchPrint.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const handlers = new Map();
  const details = [{ open: false }, { open: false }, { open: true }];
  let printing = false;
  let prepared = false;
  let frames = 0;
  let cleanup;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === "react-dom") return { flushSync: (callback) => callback() };
      if (name === "react") return {
        useState: () => [printing, (value) => { printing = value; }],
        useEffect: (effect) => { cleanup = effect(); }, useCallback: (callback) => callback,
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    document: { querySelectorAll: () => details.filter((detail) => !detail.open) },
    requestAnimationFrame(callback) { frames++; callback(); },
    window: {
      addEventListener: (name, handler) => handlers.set(name, handler),
      removeEventListener: (name) => handlers.delete(name),
      print() {
        assert.equal(prepared, true);
        assert.equal(printing, true);
        assert.equal(frames, 2);
        handlers.get("beforeprint")();
        assert.ok(details.every((detail) => detail.open));
        handlers.get("afterprint")();
      },
    },
  });
  const [, print] = exports.useResearchPrint(async () => { prepared = true; });
  await print();
  assert.equal(printing, false);
  assert.deepEqual(details.map((detail) => detail.open), [false, false, true]);
  cleanup();
  assert.equal(handlers.size, 0);
  const styles = readFileSync(new URL("../app/components/StockWorkspace.module.css", import.meta.url), "utf8");
  assert.match(styles, /@media print\s*\{\s*\.workspace :global\(\[role="tabpanel"\]\[hidden\]\) \{ display: block !important;/);
});
