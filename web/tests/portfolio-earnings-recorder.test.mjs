import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { earningsStorageKey, parseEarningsHistory, recordPortfolioEarnings } from "../app/lib/portfolioEarnings.ts";

const source = ts.createSourceFile("usePortfolioEarningsRecorder.ts", readFileSync(new URL("../app/hooks/usePortfolioEarningsRecorder.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const hook = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "usePortfolioEarningsRecorder");
const code = ts.transpileModule(`${hook.getText(source).replace(/^export /, "")}\nglobalThis.record = usePortfolioEarningsRecorder;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const holdings = { "000001": { code: "000001", shares: 100, cost: 8, updatedAt: "2026-09-28T02:00:00Z" } };
const quotes = { "000001": { status: "ready", partial: false, price: 12, previousClose: 10, date: "2026-10-09", time: "15:00:00" } };

// Run the actual recorder with controlled React hooks and browser I/O. No calendar
// component is mounted: observations must belong to the workspace lifecycle.
function recorder({ initialHistory = null, hydrated = true, blockedStorage = false } = {}) {
  const slots = [];
  const frames = new Map();
  const timers = new Map();
  const writes = [];
  const stored = new Map(initialHistory ? [[earningsStorageKey, JSON.stringify(initialHistory)]] : []);
  let nextId = 0;
  let cursor = 0;
  let effects = [];
  let args = [holdings, quotes, hydrated];
  let state;
  const sandbox = {
    earningsStorageKey, parseEarningsHistory, recordPortfolioEarnings,
    Date: class extends Date { constructor(...values) { super(...(values.length ? values : ["2026-10-09T07:00:00Z"])); } },
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, (value) => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useMemo(calculate) { cursor++; return calculate(); },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && dependencies.every((value, offset) => Object.is(value, previous.dependencies[offset]))) return;
      effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { dependencies, cleanup: effect() };
      });
    },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    accountStorage: {
      getItem(key) { if (blockedStorage) throw new Error("storage denied"); return stored.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw new Error("storage denied"); stored.set(key, value); writes.push({ key, value }); },
    },
    window: {
      setInterval(callback, delay) { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
      clearInterval(id) { timers.delete(id); },
    },
  };
  vm.runInNewContext(code, sandbox);
  const render = () => {
    cursor = 0;
    effects = [];
    state = sandbox.record(...args);
    for (const effect of effects) effect();
  };
  const flush = () => {
    for (let cycle = 0; frames.size; cycle++) {
      assert.ok(cycle < 10, "recorder must settle without a render loop");
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
      render();
    }
  };
  render();
  return {
    stored, writes, timers,
    get state() { return state; },
    flush,
    update(nextHoldings, nextQuotes, nextHydrated = true) { args = [nextHoldings, nextQuotes, nextHydrated]; render(); flush(); },
    tick() { for (const timer of timers.values()) timer.callback(); render(); flush(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("records and updates observations without mounting the earnings calendar", () => {
  const client = recorder();
  assert.equal(client.writes.length, 0, "wait for stored history before writing");
  client.flush();
  assert.equal(client.state.history.days[0].profit, 200);
  assert.equal(JSON.parse(client.stored.get(earningsStorageKey)).days[0].profit, 200);
  client.update(holdings, { "000001": { ...quotes["000001"], price: 13 } });
  assert.equal(JSON.parse(client.stored.get(earningsStorageKey)).days[0].profit, 300);
  assert.equal(client.timers.size, 1, "rerenders must not duplicate the clock");
  assert.equal([...client.timers.values()][0].delay, 60_000);
  const count = client.writes.length;
  client.tick();
  assert.equal(client.writes.length, count, "identical observations do not rewrite history");
  client.unmount();
  assert.equal(client.timers.size, 0);
});

test("loads prior history before recording and waits for workspace holdings hydration", () => {
  const previousQuotes = { "000001": { ...quotes["000001"], date: "2026-10-08" } };
  const initialHistory = recordPortfolioEarnings({ version: 1, days: [] }, holdings, previousQuotes, new Date("2026-10-08T07:00:00Z"));
  const client = recorder({ initialHistory, hydrated: false });
  client.flush();
  assert.equal(client.state.history.days.length, 1);
  assert.equal(client.writes.length, 0);
  client.update(holdings, quotes);
  assert.deepEqual(client.state.history.days.map((day) => day.date), ["2026-10-08", "2026-10-09"]);
  client.update({}, {});
  assert.equal(client.state.history.days[0].profit, 200, "clearing positions preserves previous days");
  assert.equal(client.state.history.days[1].status, "holdings_changed");
  client.unmount();
});

test("keeps the in-memory estimate and reports a storage failure", () => {
  const client = recorder({ blockedStorage: true });
  client.flush();
  assert.equal(client.state.history.days[0].profit, 200);
  assert.equal(client.state.storageError, true);
  assert.equal(client.writes.length, 0);
  client.unmount();
});
