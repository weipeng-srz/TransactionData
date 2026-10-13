import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as journal from "../app/lib/tradingJournal.ts";
import * as security from "../app/lib/security.ts";

const source = readFileSync(new URL("../app/features/review/ReviewEditor.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const validationSource = readFileSync(new URL("../app/features/review/reviewValidation.ts", import.meta.url), "utf8");
const validationExports = {};
vm.runInNewContext(ts.transpileModule(validationSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: validationExports,
  require(name) { if (name === "../../lib/tradingJournal") return journal; throw new Error(name); },
});

function editor(initialEntry, initialRules = []) {
  const slots = [];
  const changes = [];
  const saved = [];
  const focused = [];
  const scrolled = [];
  const controls = [];
  const form = { current: { querySelectorAll: () => controls } };
  let cursor = 0;
  const props = {
    entry: initialEntry, rules: initialRules, strategies: [], errors: [],
    onChange(next) { changes.push(next); props.entry = next; },
    onSave(complete) { saved.push(complete); },
    onCancel() {}, onDeriveRule() {}, onCreateRule() {},
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name === "../../lib/tradingJournal") return journal;
      if (name === "../../lib/security") return security;
      if (name === "./reviewValidation") return validationExports;
      if (name === "react") return {
        cloneElement: React.cloneElement,
        useState(initial) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = initial;
          return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
        },
        useId: () => "test-editor",
        useRef: () => form,
        useEffect() {},
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { props, changes, saved, focused, scrolled, controls, render() {
    cursor = 0;
    const tree = exports.default(props);
    const nativeControls = nodes(tree, (node) => typeof node.type === "function" && node.props?.name)
      .flatMap((node) => nodes(node.type(node.props), (child) => ["input", "select", "textarea"].includes(child.type)));
    const oldControls = new Map(controls.map((control) => [control.dataset.field, control]));
    controls.splice(0, controls.length, ...nativeControls.map((node) => ({
      ...oldControls.get(node.props.name), dataset: { field: node.props.name }, validity: oldControls.get(node.props.name)?.validity ?? { badInput: false },
      focus(options) { focused.push({ field: node.props.name, options }); },
      scrollIntoView(options) { scrolled.push({ field: node.props.name, options }); },
    })));
    return tree;
  } };
}

function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props?.children).flatMap((child) => nodes(child, predicate))];
}

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return React.Children.toArray(node?.props?.children).map(text).join("");
}

function field(tree, label) {
  const match = nodes(tree, (node) => node.props?.label === label)[0];
  assert.ok(match, `Expected editor field: ${label}`);
  const control = nodes(match, (node) => ["input", "select", "textarea"].includes(node.type))[0];
  assert.ok(control, `Expected control for: ${label}`);
  return control;
}

function button(tree, label) {
  const match = nodes(tree, (node) => node.type === "button" && text(node) === label)[0];
  assert.ok(match, `Expected button: ${label}`);
  return match;
}

function validEntry(overrides = {}) {
  return {
    ...journal.createReviewEntry("2026-10-13", { code: "600519", name: "贵州茅台", market: "CN" }),
    title: "确认后入场", thesis: "回踩支撑后量缩", lesson: "等待确认再执行", nextAction: "跌破支撑则退出",
    operation: "buy", operationPrice: 100, entryPrice: 98, entryDate: "2026-10-12", quantity: 100,
    ...overrides,
  };
}

function validRule(overrides = {}) {
  return { ...journal.createTradingRule(), title: "等待回踩", condition: "突破后量缩回踩", action: "确认支撑后入场", invalidation: "跌破支撑则放弃", ...overrides };
}

function addRule(harness, ruleId) {
  const select = nodes(harness.render(), (node) => node.type === "select" && node.props.id === "test-editor-rule")[0];
  select.props.onChange({ target: { value: ruleId } });
  button(harness.render(), "加入检查").props.onClick();
}

for (const kind of ["trade", "observation"]) {
  test(`${kind} records update operation price independently from trade entry price and preserve clearing`, () => {
    const original = validEntry({ kind });
    const harness = editor(original);
    field(harness.render(), "本次操作").props.onChange({ target: { value: kind === "trade" ? "sell" : "observe" } });
    field(harness.render(), "操作时价格（元）").props.onChange({ target: { value: "123.45" } });
    assert.equal(harness.props.entry.operationPrice, 123.45);
    assert.equal(harness.props.entry.operation, kind === "trade" ? "sell" : "observe");
    assert.equal(harness.props.entry.entryPrice, 98, "post-operation comparison must not overwrite trade cost");
    assert.equal(original.operationPrice, 100, "controlled edits must not mutate the supplied record");
    assert.equal(nodes(harness.render(), (node) => node.props?.label === "实际入场均价（元）").length, kind === "trade" ? 1 : 0);
    field(harness.render(), "操作时价格（元）").props.onChange({ target: { value: "" } });
    assert.equal(harness.props.entry.operationPrice, null, "an empty input must not become a fabricated zero price");
    assert.match(journal.validateReviewEntry(harness.props.entry, true).join(" "), /操作时价格/);
  });
}

test("adding a rule captures its wording and version without exposing retired rules or rewriting old checks", () => {
  const rule = validRule({ status: "active", version: 3 });
  const retired = validRule({ id: "retired-rule", status: "retired", title: "旧规则" });
  const harness = editor(validEntry(), [rule, retired]);
  const picker = nodes(harness.render(), (node) => node.type === "select" && node.props.id === "test-editor-rule")[0];
  assert.ok(!nodes(picker, (node) => node.type === "option").some((node) => node.props.value === retired.id));
  addRule(harness, rule.id);
  const snapshot = harness.props.entry.ruleChecks[0];
  const expected = JSON.stringify(journal.snapshotTradingRule(rule));
  assert.equal(JSON.stringify(snapshot), expected);
  harness.props.rules = [{ ...rule, version: 4, title: "修订后的规则", condition: "新的触发条件", action: "新的动作" }, retired];
  const tree = harness.render();
  assert.equal(JSON.stringify(harness.props.entry.ruleChecks[0]), expected);
  const card = nodes(tree, (node) => node.type === "article")[0];
  assert.match(text(card), /等待回踩/);
  assert.match(text(card), /v3/);
  assert.match(text(card), /突破后量缩回踩/);
  assert.ok(!text(card).includes("新的触发条件"));
  const updatedPicker = nodes(tree, (node) => node.type === "select" && node.props.id === "test-editor-rule")[0];
  assert.ok(!nodes(updatedPicker, (node) => node.type === "option").some((node) => node.props.value === rule.id), "a selected rule cannot be added twice");
});

test("pending and broken rule checks retain user input and require an explicit result and reason", () => {
  const rule = validRule();
  const harness = editor(validEntry(), [rule]);
  addRule(harness, rule.id);
  const pendingSnapshot = harness.props.entry.ruleChecks[0];
  assert.match(journal.validateReviewEntry(harness.props.entry, true).join(" "), /逐条评价/);
  const resultPicker = (tree) => nodes(tree, (node) => node.type === "select" && nodes(node, (option) => option.type === "option" && option.props.value === "broken").length > 0)[0];
  resultPicker(harness.render()).props.onChange({ target: { value: "broken" } });
  assert.equal(harness.props.entry.ruleChecks[0].result, "broken");
  assert.equal(pendingSnapshot.result, "pending", "updates must preserve previous snapshots");
  assert.match(journal.validateReviewEntry(harness.props.entry, true).join(" "), /原因/);
  const note = nodes(harness.render(), (node) => node.type === "textarea" && node.props.placeholder?.startsWith("用具体行为说明"))[0];
  note.props.onChange({ target: { value: "回踩前追高，下一次等待收盘确认" } });
  assert.equal(harness.props.entry.ruleChecks[0].note, "回踩前追高，下一次等待收盘确认");
  assert.deepEqual(journal.validateReviewEntry(harness.props.entry, true), []);
  for (const result of ["followed", "na"]) {
    resultPicker(harness.render()).props.onChange({ target: { value: result } });
    assert.equal(harness.props.entry.ruleChecks[0].result, result);
    assert.deepEqual(journal.validateReviewEntry(harness.props.entry, true), []);
  }
});

test("save draft and complete review use separate callbacks and saving prevents duplicate form submission", () => {
  const harness = editor(validEntry());
  const tree = harness.render();
  assert.equal(tree.type, "form");
  assert.equal(tree.props.noValidate, true, "draft saving must not be blocked by native required validation");
  const draftButton = button(tree, "保存草稿");
  assert.equal(draftButton.props.type, "button");
  draftButton.props.onClick();
  let prevented = false;
  tree.props.onSubmit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(harness.saved, [false, true]);
  assert.equal(button(tree, "完成复盘").props.type, "submit");
  harness.props.saving = true;
  const savingTree = harness.render();
  const savingButtons = nodes(savingTree, (node) => node.type === "button" && text(node) === "保存中…");
  assert.equal(savingButtons.length, 2);
  assert.ok(savingButtons.every((node) => node.props.disabled));
  savingTree.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(harness.saved, [false, true]);
});

test("errors remain accessible while filled reviews can derive rules and research links use the selected market", () => {
  const harness = editor(validEntry({ code: "AAPL", market: "US" }));
  let derived = 0;
  let cancelled = 0;
  harness.props.onDeriveRule = () => { derived += 1; };
  harness.props.onCancel = () => { cancelled += 1; };
  harness.props.errors = ["请逐条评价关联规则的执行情况"];
  const tree = harness.render();
  const alert = nodes(tree, (node) => node.props?.role === "alert")[0];
  assert.equal(alert.props.tabIndex, -1);
  assert.match(text(alert), /请逐条评价关联规则的执行情况/);
  const researchLink = nodes(tree, (node) => node.type === "a" && node.props.href.startsWith("/?stock="))[0];
  assert.equal(new URL(researchLink.props.href, "https://example.test").searchParams.get("stock"), "US:AAPL");
  assert.equal(researchLink.props.target, "_blank");
  const derive = nodes(tree, (node) => node.type === "button" && text(node).startsWith("提炼交易规则"))[0];
  assert.equal(derive.props.disabled, false);
  derive.props.onClick();
  button(tree, "取消编辑").props.onClick();
  assert.equal(derived, 1);
  assert.equal(cancelled, 1);
  harness.props.entry = { ...harness.props.entry, nextAction: "" };
  assert.equal(nodes(harness.render(), (node) => node.type === "button" && text(node).startsWith("提炼交易规则"))[0].props.disabled, true);
});

test("strategy selection adds only missing usable rules and keeps historical wording, outcomes and notes intact", () => {
  const existingRule = validRule({ id: "existing", status: "active", version: 1 });
  const oldCheck = { ...journal.snapshotTradingRule(existingRule), result: "followed", note: "按原计划执行" };
  const testingRule = validRule({ id: "testing", status: "testing", title: "测试中的仓位规则" });
  const activeRule = validRule({ id: "active", status: "active", title: "执行中的退出规则" });
  const retiredRule = validRule({ id: "retired", status: "retired" });
  const unrelatedRule = validRule({ id: "unrelated", status: "active" });
  const harness = editor(validEntry({ ruleChecks: [oldCheck] }), [
    { ...existingRule, title: "已修改的现行名称", condition: "修订条件", version: 4 },
    testingRule, activeRule, retiredRule, unrelatedRule,
  ]);
  harness.props.strategies = [{
    id: "strategy-1", name: "趋势回踩策略", description: "趋势向上，等待缩量回踩。", status: "active",
    ruleIds: ["existing", "testing", "active", "retired", "missing", "testing"],
    createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z",
  }];
  field(harness.render(), "选择交易策略").props.onChange({ target: { value: "strategy-1" } });
  assert.equal(harness.props.entry.strategyId, "strategy-1");
  assert.equal(harness.props.entry.setup, "趋势回踩策略");
  assert.equal(harness.props.entry.ruleChecks.length, 3);
  assert.equal(harness.props.entry.ruleChecks[0], oldCheck, "the historical check must not be replaced with the current rule");
  assert.equal(harness.props.entry.ruleChecks[0].ruleVersion, 1);
  assert.equal(harness.props.entry.ruleChecks[0].note, "按原计划执行");
  assert.deepEqual(Array.from(harness.props.entry.ruleChecks, (check) => check.ruleId), ["existing", "testing", "active"]);
  assert.ok(harness.props.entry.ruleChecks.slice(1).every((check) => check.result === "pending" && check.note === ""));
  field(harness.render(), "选择交易策略").props.onChange({ target: { value: "strategy-1" } });
  assert.equal(harness.props.entry.ruleChecks.length, 3, "selecting the same strategy cannot duplicate checks");
  harness.props.strategies = [{ ...harness.props.strategies[0], name: "后来改名的策略" }];
  assert.equal(field(harness.render(), "本次策略名称 / 交易形态").props.value, "趋势回踩策略", "current strategy names must not rewrite the recorded setup");
});

test("clearing strategy keeps snapshots and custom setup while archived strategies remain history-only", () => {
  const rule = validRule();
  const oldCheck = journal.snapshotTradingRule(rule);
  const harness = editor(validEntry({ strategyId: "archived", setup: "历史突破策略", ruleChecks: [oldCheck] }), [rule]);
  harness.props.strategies = [
    { id: "archived", name: "历史突破策略", description: "", status: "archived", ruleIds: [rule.id], createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z" },
    { id: "other-archived", name: "其他停用策略", description: "", status: "archived", ruleIds: [], createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z" },
  ];
  const strategyPicker = field(harness.render(), "选择交易策略");
  const options = nodes(strategyPicker, (node) => node.type === "option");
  assert.equal(options.find((node) => node.props.value === "archived").props.disabled, true);
  assert.ok(!options.some((node) => node.props.value === "other-archived"));
  strategyPicker.props.onChange({ target: { value: "" } });
  assert.equal(harness.props.entry.strategyId, "");
  assert.equal(harness.props.entry.setup, "历史突破策略");
  assert.equal(harness.props.entry.ruleChecks[0], oldCheck);
  const changesBefore = harness.changes.length;
  field(harness.render(), "选择交易策略").props.onChange({ target: { value: "archived" } });
  assert.equal(harness.changes.length, changesBefore, "disabled strategies cannot be added by a stale selection event");
  field(harness.render(), "本次策略名称 / 交易形态").props.onChange({ target: { value: "自定义观察形态" } });
  assert.equal(harness.props.entry.setup, "自定义观察形态");
  assert.equal(harness.props.entry.ruleChecks[0], oldCheck);
});

test("custom rule creation is available directly from an incomplete review and disabled during saving", () => {
  const harness = editor(validEntry({ lesson: "", nextAction: "" }));
  let requested = 0;
  harness.props.onCreateRule = () => { requested += 1; };
  const create = button(harness.render(), "＋ 自定义交易规则");
  assert.equal(create.props.type, "button");
  assert.equal(create.props.disabled, false);
  create.props.onClick();
  assert.equal(requested, 1);
  assert.deepEqual(harness.saved, [], "the parent owns draft persistence and returning the new rule snapshot");
  harness.props.saving = true;
  assert.equal(button(harness.render(), "＋ 自定义交易规则").props.disabled, true);
});

function renderedField(tree, name) {
  const wrapper = nodes(tree, (node) => typeof node.type === "function" && node.props?.name === name)[0];
  assert.ok(wrapper, `Expected named field: ${name}`);
  return wrapper.type(wrapper.props);
}

function renderedControl(tree, name) {
  return nodes(renderedField(tree, name), (node) => ["input", "select", "textarea"].includes(node.type))[0];
}

test("completion highlights required controls, focuses the first in reading order, and clears corrected errors immediately", () => {
  const harness = editor(validEntry({ title: "", operationPrice: null, thesis: "", lesson: "", nextAction: "" }));
  harness.render().props.onSubmit({ preventDefault() {} });
  assert.deepEqual(harness.saved, []);
  assert.equal(harness.focused[0].field, "title");
  assert.equal(harness.scrolled[0].field, "title");
  assert.equal(harness.scrolled[0].options.block, "center");
  let tree = harness.render();
  for (const name of ["title", "operationPrice", "thesis", "lesson", "nextAction"]) {
    const control = renderedControl(tree, name);
    assert.equal(control.props["aria-invalid"], true);
    assert.equal(control.props["aria-required"], true);
    assert.equal(control.props.name, name);
    assert.equal(control.props["data-field"], name);
    assert.ok(control.props["aria-describedby"].includes(`${control.props.id}-error`));
    assert.ok(nodes(renderedField(tree, name), (node) => node.props?.id === `${control.props.id}-error`).length);
  }
  field(tree, "复盘标题").props.onChange({ target: { value: "补充后的复盘" } });
  tree = harness.render();
  assert.equal(renderedControl(tree, "title").props["aria-invalid"], undefined);
  assert.equal(renderedControl(tree, "operationPrice").props["aria-invalid"], true);
  tree.props.onSubmit({ preventDefault() {} });
  assert.equal(harness.focused.at(-1).field, "operationPrice", "subsequent submissions advance to the next missing field");
});

test("drafts allow missing completion-only fields while invalid values still locate their controls", () => {
  const harness = editor(validEntry({ title: "", thesis: "", lesson: "", nextAction: "", operationPrice: null, fees: -1 }));
  button(harness.render(), "保存草稿").props.onClick();
  assert.deepEqual(harness.saved, []);
  assert.equal(harness.focused.at(-1).field, "fees");
  assert.equal(renderedControl(harness.render(), "title").props["aria-invalid"], undefined);
  field(harness.render(), "交易总费用（元）").props.onChange({ target: { value: "0" } });
  assert.equal(renderedControl(harness.render(), "fees").props["aria-invalid"], undefined);
  button(harness.render(), "保存草稿").props.onClick();
  assert.deepEqual(harness.saved, [false]);
});

test("bad native numeric input is rejected even when an optional controlled value is empty", () => {
  const harness = editor(validEntry({ targetPrice: null }));
  let tree = harness.render();
  harness.controls.find((control) => control.dataset.field === "targetPrice").validity.badInput = true;
  button(tree, "保存草稿").props.onClick();
  assert.deepEqual(harness.saved, []);
  assert.equal(harness.focused.at(-1).field, "targetPrice");
  tree = harness.render();
  assert.equal(renderedControl(tree, "targetPrice").props["aria-invalid"], true);
  tree.props.onChangeCapture({ target: { name: "targetPrice" } });
  harness.controls.find((control) => control.dataset.field === "targetPrice").validity.badInput = false;
  field(harness.render(), "计划目标价").props.onChange({ target: { value: "110" } });
  button(harness.render(), "保存草稿").props.onClick();
  assert.deepEqual(harness.saved, [false]);
});

test("rule errors are keyed per rule and move from pending results to the missing violation reason", () => {
  const checks = ["first-rule", "second-rule"].map((id) => journal.snapshotTradingRule(validRule({ id })));
  const harness = editor(validEntry({ ruleChecks: checks }));
  harness.render().props.onSubmit({ preventDefault() {} });
  assert.equal(harness.focused.at(-1).field, "ruleChecks.first-rule.result");
  let control = renderedControl(harness.render(), "ruleChecks.first-rule.result");
  control.props.onChange({ target: { value: "broken" } });
  harness.render().props.onSubmit({ preventDefault() {} });
  assert.equal(harness.focused.at(-1).field, "ruleChecks.first-rule.note");
  control = renderedControl(harness.render(), "ruleChecks.first-rule.note");
  assert.equal(control.props["aria-invalid"], true);
  control.props.onChange({ target: { value: "提前入场，未等确认" } });
  harness.render().props.onSubmit({ preventDefault() {} });
  assert.equal(harness.focused.at(-1).field, "ruleChecks.second-rule.result");
  renderedControl(harness.render(), "ruleChecks.second-rule.result").props.onChange({ target: { value: "followed" } });
  harness.render().props.onSubmit({ preventDefault() {} });
  assert.deepEqual(harness.saved, [true]);
});

test("domain date, pairing, numeric, code and text errors all map to an editable field", () => {
  const cases = [
    [{ date: "2026-02-30" }, "date"], [{ entryDate: "not-a-date" }, "entryDate"],
    [{ exitDate: "2026-10-01" }, "exitDate"], [{ reviewDate: "2026-10-01" }, "reviewDate"],
    [{ date: "2999-01-01" }, "date"], [{ entryDate: "2999-01-01" }, "entryDate"],
    [{ exitPrice: 110, exitDate: "" }, "exitDate"], [{ exitPrice: null, exitDate: "2026-10-13" }, "exitPrice"],
    [{ code: "invalid" }, "code"], [{ entryPrice: Number.NaN }, "entryPrice"],
    [{ plannedEntry: Infinity }, "plannedEntry"], [{ title: "t".repeat(301) }, "title"],
    [{ marketContext: "x".repeat(20001) }, "marketContext"],
  ];
  for (const [override, expectedField] of cases) {
    const result = validationExports.reviewValidation(validEntry(override), true);
    assert.ok(result.fields[expectedField], `Expected ${expectedField} for ${Object.keys(override).join(",")}`);
    assert.ok(result.errors.length > 0);
  }
});

test("all record fields expose independent accessible names and saving locks the whole editor", () => {
  const harness = editor(validEntry());
  let tree = harness.render();
  const wrappers = nodes(tree, (node) => typeof node.type === "function" && node.props?.label);
  const names = wrappers.map((wrapper) => renderedControl(tree, wrapper.props.name).props.name);
  assert.equal(names.length, new Set(names).size);
  assert.ok(names.every(Boolean));
  harness.props.saving = true;
  tree = harness.render();
  const fieldset = nodes(tree, (node) => node.type === "fieldset" && node.props.className === "formBody")[0];
  assert.equal(fieldset.props.disabled, true);
});

for (const action of ["create", "derive"]) {
  test(`${action} rule navigation validates and focuses invalid draft fields before asking the parent to save`, () => {
    const harness = editor(validEntry({ code: "600" }));
    let navigated = 0;
    harness.props[action === "create" ? "onCreateRule" : "onDeriveRule"] = () => { navigated += 1; };
    const actionButton = (tree) => action === "create" ? button(tree, "＋ 自定义交易规则") : nodes(tree, (node) => node.type === "button" && text(node).startsWith("提炼交易规则"))[0];
    actionButton(harness.render()).props.onClick();
    assert.equal(navigated, 0);
    assert.equal(harness.focused.at(-1).field, "code");
    assert.equal(renderedControl(harness.render(), "code").props["aria-invalid"], true);
    field(harness.render(), "股票代码").props.onChange({ target: { value: "600519" } });
    actionButton(harness.render()).props.onClick();
    assert.equal(navigated, 1);
    assert.deepEqual(harness.saved, [], "only the parent rule flow should persist its source record");
  });
}

test("rule creation preserves completion requirements when editing a completed record", () => {
  const harness = editor(validEntry({ status: "complete", title: "" }));
  let navigated = 0;
  harness.props.onCreateRule = () => { navigated += 1; };
  button(harness.render(), "＋ 自定义交易规则").props.onClick();
  assert.equal(navigated, 0);
  assert.equal(harness.focused.at(-1).field, "title");
  assert.equal(renderedControl(harness.render(), "title").props["aria-invalid"], true);
});
