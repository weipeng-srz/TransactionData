import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the actual page callbacks with controlled I/O, including the outgoing PUT.
const source = ts.createSourceFile("page.tsx", readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
const visit = (node) => { nodes.push(node); ts.forEachChild(node, visit); };
visit(source);
const load = nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "loadCloudState").initializer;
const parser = nodes.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "parseAnnotations");
const save = nodes.find((node) => ts.isCallExpression(node) && node.expression.getText(source) === "window.setTimeout"
  && node.arguments[0]?.getText(source).includes('fetch("/api/research-state"')).arguments[0];
const code = ts.transpileModule(`${parser.getText(source)}\nglobalThis.load = ${load.getText(source)};\nglobalThis.save = ${save.getText(source)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const oldAnnotation = { id: "old", code: "000001", date: "2026-08-25", price: 10, text: "旧标注", createdAt: "2026-08-25T00:00:00Z" };

function client(state, { abort = false, storageBlocked = false } = {}) {
  const stored = new Map([["annotations", JSON.stringify([oldAnnotation])]]);
  const writes = [];
  const controller = new AbortController();
  const sandbox = {
    annotations: [oldAnnotation], annotationsStorageKey: "annotations", controller,
    selectedMarket: "CN", cloudLoadedRef: { current: false }, cloudStatus: "loading",
    savedWorkspace: null, viewMode: "basic", benchmarkCode: "000300",
    localStorage: { setItem(key, value) { if (storageBlocked) throw new Error("denied"); stored.set(key, value); } },
    fetch: async (_url, options) => {
      if (options?.method === "PUT") { writes.push(JSON.parse(options.body)); return Response.json({}); }
      if (abort) controller.abort();
      return Response.json({ state });
    },
    setAnnotations(value) { sandbox.annotations = value; },
    setCloudStatus(value) { sandbox.cloudStatus = value; },
    setViewMode(value) { sandbox.viewMode = value; },
    setBenchmarkCode(value) { sandbox.benchmarkCode = value; },
    setSavedWorkspace(value) { sandbox.savedWorkspace = value; },
    setHasSavedView() {}, benchmarkMatchesMarket: () => true,
    isAbortError: (reason) => reason.name === "AbortError",
  };
  vm.runInNewContext(code, sandbox);
  return { sandbox, stored, writes };
}

test("a second device honors cloud deletion, persists it locally, and never PUTs deleted annotations back", async () => {
  const { sandbox, stored, writes } = client({ version: 4, annotations: [] });
  await sandbox.load();
  assert.equal(sandbox.annotations.length, 0);
  assert.equal(stored.get("annotations"), "[]");
  assert.equal(sandbox.cloudStatus, "synced");
  await sandbox.save();
  assert.deepEqual(writes[0].state.annotations, []);
});

test("missing or malformed annotations do not masquerade as an explicit deletion", async () => {
  for (const state of [{ version: 4 }, { version: 4, annotations: null }]) {
    const { sandbox, stored } = client(state);
    await sandbox.load();
    assert.equal(sandbox.annotations[0].id, "old");
    assert.equal(JSON.parse(stored.get("annotations"))[0].id, "old");
  }
});

test("cloud state applies in memory even when local persistence is unavailable", async () => {
  const { sandbox, writes } = client({ annotations: [] }, { storageBlocked: true });
  await sandbox.load();
  await sandbox.save();
  assert.equal(sandbox.cloudStatus, "synced");
  assert.deepEqual(writes[0].state.annotations, []);
});

test("cancelled loads and pending hydration cannot overwrite local or remote state", async () => {
  const { sandbox, stored, writes } = client({ annotations: [] }, { abort: true });
  await sandbox.load();
  await sandbox.save();
  assert.equal(sandbox.annotations[0].id, "old");
  assert.equal(JSON.parse(stored.get("annotations"))[0].id, "old");
  assert.equal(sandbox.cloudLoadedRef.current, false);
  assert.deepEqual(writes, []);
});
