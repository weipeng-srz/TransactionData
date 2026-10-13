import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as journal from "../app/lib/tradingJournal.ts";

const source = readFileSync(new URL("../app/features/review/StrategyLibrary.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function harness(strategies = [], rules = [], entries = []) {
  const slots = [];
  const saves = [];
  const opened = [];
  let cursor = 0;
  let accepted = true;
  let pendingSave;
  let confirmResult = true;
  const props = {
    strategies, rules, entries,
    async onSave(strategy, base) {
      saves.push({ strategy, base });
      const saved = pendingSave ? await pendingSave : accepted;
      pendingSave = undefined;
      if (saved) props.strategies = [strategy, ...props.strategies.filter((item) => item.id !== strategy.id)];
      return saved;
    },
    onOpenEntry(entry) { opened.push(entry); },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Error,
    window: { confirm: () => confirmResult },
    require(name) {
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name === "../../lib/tradingJournal") return journal;
      if (name === "react") return {
        useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
        useId: () => "strategy-test", useRef: () => ({ current: null }), useEffect() {},
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return {
    props, saves, opened, accept(value) { accepted = value; pendingSave = undefined; }, confirm(value) { confirmResult = value; },
    holdSave() {
      let resolve, reject;
      pendingSave = new Promise((complete, fail) => { resolve = complete; reject = fail; });
      return { resolve, reject };
    },
    render() { cursor = 0; return exports.default(props); },
  };
}

function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props?.children).flatMap((child) => nodes(child, predicate))];
}
function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return React.Children.toArray(node?.props?.children).map(text).join("");
}
function button(tree, value) {
  const found = nodes(tree, (node) => node.type === "button" && (text(node) === value || node.props["aria-label"] === value))[0];
  assert.ok(found, `Expected button: ${value}`); return found;
}
function control(tree, label) {
  const found = nodes(tree, (node) => node.type === "label" && text(node).startsWith(label))[0];
  assert.ok(found, `Expected field: ${label}`);
  return nodes(found, (node) => ["input", "select", "textarea"].includes(node.type))[0];
}
async function submit(tree) {
  nodes(tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  await new Promise(setImmediate);
}
function strategy(patch = {}) { return { ...journal.createTradingStrategy(), name: "趋势回踩", description: "上升趋势量缩回踩", ...patch }; }
function rule(patch = {}) { return { ...journal.createTradingRule(), title: "确认后入场", condition: "等待支撑确认", action: "按计划入场", invalidation: "跌破支撑", ...patch }; }

test("a new strategy validates its name, selects active/testing rules, and remains editable after failed persistence", async () => {
  const active = rule({ status: "active" });
  const testing = rule({ status: "testing", title: "仓位检查" });
  const retired = rule({ status: "retired", title: "已废弃规则" });
  const app = harness([], [active, testing, retired]);
  button(app.render(), "＋ 新建策略").props.onClick();
  await submit(app.render());
  assert.equal(app.saves.length, 0);
  assert.match(text(app.render()), /请填写策略名称/);
  assert.equal(nodes(app.render(), (node) => node.type === "input" && node.props.type === "checkbox").length, 2);
  assert.doesNotMatch(text(app.render()), /已废弃规则/);
  control(app.render(), "策略名称").props.onChange({ target: { value: "  突破确认  " } });
  control(app.render(), "适用场景与策略说明").props.onChange({ target: { value: "放量突破后等待确认" } });
  control(app.render(), "确认后入场").props.onChange({ target: { checked: true } });
  app.accept(false);
  await submit(app.render());
  assert.equal(app.saves.length, 1);
  assert.equal(app.saves[0].base, "");
  assert.equal(app.saves[0].strategy.name, "突破确认");
  assert.equal(app.saves[0].strategy.ruleIds[0], active.id);
  assert.match(text(app.render()), /策略保存失败/);
  assert.equal(control(app.render(), "策略名称").props.value, "  突破确认  ");
  app.accept(true);
  await submit(app.render());
  assert.equal(nodes(app.render(), (node) => node.type === "form").length, 0);
  assert.match(text(app.render()), /策略已保存/);
  assert.equal(app.props.strategies.length, 1);
});

test("editing and archiving preserve IDs, the original conflict base, retired references, and historical samples", async () => {
  const retired = rule({ status: "retired", title: "历史检查规则" });
  const original = strategy({ ruleIds: [retired.id] });
  const entry = { ...journal.createReviewEntry("2026-10-12"), title: "原策略复盘", strategyId: original.id, setup: original.name, status: "complete" };
  const app = harness([original], [retired], [entry]);
  button(app.render(), `编辑策略 ${original.name}`).props.onClick();
  assert.match(text(app.render()), /仅保留历史关联，不用于新复盘/);
  control(app.render(), "策略名称").props.onChange({ target: { value: "修订后的策略" } });
  control(app.render(), "使用状态").props.onChange({ target: { value: "archived" } });
  assert.ok(button(app.render(), "保存为停用策略"));
  await submit(app.render());
  const saved = app.saves[0];
  assert.equal(saved.base, JSON.stringify(original));
  assert.equal(saved.strategy.id, original.id);
  assert.equal(saved.strategy.status, "archived");
  assert.equal(saved.strategy.createdAt, original.createdAt);
  assert.deepEqual([...saved.strategy.ruleIds], [retired.id]);
  assert.equal(entry.setup, "趋势回踩");
  assert.equal(original.name, "趋势回踩");
  assert.match(text(app.render()), /历史复盘与规则关联仍然保留/);
  const sampleButton = nodes(app.render(), (node) => node.type === "button" && text(node).startsWith("原策略复盘"))[0];
  sampleButton.props.onClick();
  assert.equal(app.opened[0], entry);
  button(app.render(), "编辑策略 修订后的策略").props.onClick();
  control(app.render(), "历史检查规则").props.onChange({ target: { checked: false } });
  assert.equal(nodes(app.render(), (node) => node.type === "input" && node.props.type === "checkbox").length, 0);
  await submit(app.render());
  assert.equal(app.saves.at(-1).strategy.ruleIds.length, 0);
});

test("a rule retired during editing cannot be newly saved into a strategy", async () => {
  const active = rule({ status: "active" });
  const app = harness([], [active]);
  button(app.render(), "＋ 新建策略").props.onClick();
  control(app.render(), "策略名称").props.onChange({ target: { value: "新策略" } });
  control(app.render(), active.title).props.onChange({ target: { checked: true } });
  app.props.rules = [{ ...active, status: "retired" }];
  await submit(app.render());
  assert.equal(app.saves.length, 0);
  assert.match(text(app.render()), /部分新选规则已停用/);
});

test("search and status filters work without discarding a dirty strategy editor", async () => {
  const active = strategy({ name: "使用中的策略" });
  const archived = strategy({ name: "旧策略", status: "archived" });
  const app = harness([active, archived]);
  control(app.render(), "策略状态").props.onChange({ target: { value: "archived" } });
  assert.equal(nodes(app.render(), (node) => node.type === "article").length, 1);
  control(app.render(), "搜索策略").props.onChange({ target: { value: "没有匹配" } });
  assert.match(text(app.render()), /没有符合筛选的策略/);
  button(app.render(), "清除筛选").props.onClick();
  button(app.render(), `编辑策略 ${active.name}`).props.onClick();
  control(app.render(), "策略名称").props.onChange({ target: { value: "尚未保存的名称" } });
  app.confirm(false);
  button(app.render(), "取消编辑").props.onClick();
  button(app.render(), `编辑策略 ${archived.name}`).props.onClick();
  assert.equal(control(app.render(), "策略名称").props.value, "尚未保存的名称");
  app.props.disabled = true;
  await submit(app.render());
  assert.equal(app.saves.length, 0);
  assert.equal(button(app.render(), "保存策略").props.disabled, true);
});

test("a pending strategy save keeps the editor open and disables cancel and duplicate submissions", async () => {
  const app = harness();
  button(app.render(), "＋ 新建策略").props.onClick();
  control(app.render(), "策略名称").props.onChange({ target: { value: "等待保存的策略" } });
  const pending = app.holdSave();
  await submit(app.render());
  assert.equal(button(app.render(), "保存策略").props.disabled, true);
  assert.equal(button(app.render(), "取消编辑").props.disabled, true);
  button(app.render(), "取消编辑").props.onClick();
  assert.equal(nodes(app.render(), (node) => node.type === "form").length, 1);
  await submit(app.render());
  assert.equal(app.saves.length, 1);
  assert.doesNotMatch(text(app.render()), /策略已保存/);
  pending.resolve(true);
  await new Promise(setImmediate);
  assert.equal(nodes(app.render(), (node) => node.type === "form").length, 0);
  assert.match(text(app.render()), /策略已保存/);
});

test("a rejected strategy save preserves edits and permits a later successful retry", async () => {
  const app = harness();
  button(app.render(), "＋ 新建策略").props.onClick();
  control(app.render(), "策略名称").props.onChange({ target: { value: "不能丢失的策略" } });
  const pending = app.holdSave();
  await submit(app.render());
  pending.reject(new Error("数据库暂不可用"));
  await new Promise(setImmediate);
  assert.equal(control(app.render(), "策略名称").props.value, "不能丢失的策略");
  assert.equal(button(app.render(), "保存策略").props.disabled, false);
  assert.match(text(app.render()), /策略保存失败.*数据库暂不可用/);
  assert.doesNotMatch(text(app.render()), /策略已保存/);
  app.accept(true);
  await submit(app.render());
  assert.equal(app.saves.length, 2);
  assert.equal(nodes(app.render(), (node) => node.type === "form").length, 0);
  assert.match(text(app.render()), /策略已保存/);
});
