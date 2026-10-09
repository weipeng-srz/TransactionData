import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { stockStorageKey } from "../app/lib/security.ts";
import { buildPortfolioStocks } from "../app/lib/watchlist.ts";

// Execute the component's real handler and counters with controlled state.
const source = ts.createSourceFile("PortfolioHome.tsx", readFileSync(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const variables = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node)) variables.set(node.name.getText(source), node.initializer);
  ts.forEachChild(node, visit);
}
visit(source);
const code = ts.transpileModule(`globalThis.clearPosition = ${variables.get("clearPosition").getText(source)};
globalThis.counts = () => ({ loading: ${variables.get("loadingCount").getText(source)}, ready: ${variables.get("readyCount").getText(source)} });`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const stock = { code: "000001", name: "平安银行", addedAt: "2026-10-08T00:00:00Z" };
const other = { code: "AAPL", name: "Apple", market: "US", currency: "USD", addedAt: stock.addedAt };

function setup(watched) {
  const sandbox = {
    stockStorageKey, editor: { stock }, watchlist: watched,
    holdings: { "000001": { ...stock, shares: 100, cost: 10, updatedAt: stock.addedAt } },
    quotes: { "000001": { status: "loading" }, "US:AAPL": { status: "ready" } },
    get portfolioStocks() { return buildPortfolioStocks(sandbox.watchlist, sandbox.holdings); },
    setHoldings(update) { sandbox.holdings = update(sandbox.holdings); },
    setQuotes(update) { sandbox.quotes = update(sandbox.quotes); },
    setEditor(value) { sandbox.editor = value; }, setNotice() {},
  };
  vm.runInNewContext(code, sandbox);
  return sandbox;
}

test("clearing a loading position outside the watchlist removes its quote and releases refresh", () => {
  const client = setup([other]);
  client.clearPosition();
  assert.equal(client.holdings["000001"], undefined);
  assert.equal(client.quotes["000001"], undefined);
  assert.equal(client.counts().loading, 0);
  assert.equal(client.counts().ready, 1);
  assert.equal(client.editor, null);
});

test("clearing a watched position retains its quote and loading status", () => {
  const client = setup([stock, other]);
  client.clearPosition();
  assert.equal(client.holdings["000001"], undefined);
  assert.equal(client.quotes["000001"].status, "loading");
  assert.equal(client.counts().loading, 1);
});

test("quotes outside the active portfolio cannot affect loading or ready counts", () => {
  const client = setup([other]);
  client.holdings = {};
  client.quotes["600519"] = { status: "ready" };
  assert.equal(client.counts().loading, 0);
  assert.equal(client.counts().ready, 1);
});
