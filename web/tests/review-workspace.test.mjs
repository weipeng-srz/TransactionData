import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as journal from "../app/lib/tradingJournal.ts";
import * as security from "../app/lib/security.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../app/features/review/ReviewWorkspace.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key) };
}

function ReviewEditor() { return null; }
function StrategyLibrary() { return null; }
function WorkspaceTabs() { return null; }
function WorkspacePanel() { return null; }
function ReviewDialog() { return null; }

function workspace(accountStorage = memoryStorage(), href = "https://example.test/review", confirmResult = true) {
  const slots = [];
  const pendingEffects = [];
  const timers = new Map();
  const frames = new Map();
  const listeners = new Map();
  let cursor = 0;
  let nextTimer = 0;
  let dirty = true;
  let tree;
  let userId = "alice";
  let flush = async () => {};
  const location = { href };
  const history = { state: null, replaceState(_state, _title, url) { location.href = String(url); } };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (update) => {
        const value = typeof update === "function" ? update(slots[index]) : update;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        slots[index] = { deps: deps ? [...deps] : undefined, cleanup: previous?.cleanup };
        pendingEffects.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date, Intl, URL, Blob, structuredClone, Error,
    document: { title: "", createElement: () => ({ click() {} }) },
    window: {
      location, history, confirm: () => confirmResult,
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); },
    },
    requestAnimationFrame: (callback) => { frames.set(++nextTimer, callback); return nextTimer; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name === "../../lib/tradingJournal") return journal;
      if (name === "../../lib/accountStorage") return {
        accountStorage, flushAccountStorage: () => flush(), getAccountStorageStatus: () => ({ userId }),
        subscribeAccountStorageChanges: (listener) => { listeners.set("account-storage", listener); return () => listeners.delete("account-storage"); },
      };
      if (name === "../../lib/security") return security;
      if (name === "../../components/SiteBanner") return { default: () => null };
      if (name === "../../components/AppearanceProvider") return { useAppearance: () => ({ appearance: "light", toggleAppearance() {} }) };
      if (name === "../../components/WorkspaceTabs") return { WorkspaceTabs, WorkspacePanel };
      if (name === "../../hooks/useWorkspaceView") return { useWorkspaceView: (_views, initial) => hooks.useState(initial) };
      if (name === "./ReviewEditor") return { default: ReviewEditor };
      if (name === "./ReviewDialog") return { default: ReviewDialog };
      if (name === "./StrategyLibrary") return { default: StrategyLibrary };
      if (name === "./useReviewQuotes") return { useReviewQuotes: () => ({ quotes: {}, loading: false, error: "", refresh() {} }) };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  function settle() {
    let turns = 0;
    while (dirty || pendingEffects.length || frames.size) {
      assert.ok(turns++ < 30, "hooks should converge without a rendering loop");
      if (dirty) { dirty = false; cursor = 0; tree = exports.default(); }
      pendingEffects.splice(0).forEach((effect) => effect());
      const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback());
    }
    return tree;
  }
  return {
    accountStorage, location,
    render: settle,
    async flushDraft() { settle(); const callbacks = [...timers.values()]; timers.clear(); await Promise.all(callbacks.map((callback) => callback())); return settle(); },
    async settleAsync() { await new Promise(setImmediate); return settle(); },
    setFlush(callback) { flush = callback; },
    setUser(value) { userId = value; },
    storageChanged() { listeners.get("account-storage")?.(journal.JOURNAL_STORAGE_KEY); return settle(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); timers.clear(); frames.clear(); },
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

function editor(harness) {
  return nodes(harness.render(), (node) => node.type === ReviewEditor)[0];
}

function button(tree, label) {
  const result = nodes(tree, (node) => node.type === "button" && text(node) === label)[0];
  assert.ok(result, `Expected button ${label}`);
  return result;
}

function validEntry(overrides = {}) {
  return {
    ...journal.createReviewEntry("2026-10-13", { code: "600519", name: "贵州茅台", market: "CN" }),
    title: "确认后入场", thesis: "回踩支撑后量缩", lesson: "等待确认再执行", nextAction: "跌破支撑则退出",
    operation: "buy", operationPrice: 100, entryPrice: 98, entryDate: "2026-10-12", quantity: 100,
    ...overrides,
  };
}

function fillRule(harness) {
  for (const [label, value] of [["规则名称", "不追高"], ["适用 / 触发条件", "价格回踩支撑"], ["具体执行动作", "确认支撑后买入"], ["例外 / 失效条件", "跌破支撑则放弃"]]) {
    const labelNode = nodes(harness.render(), (node) => node.type === "label" && text(node).startsWith(label))[0];
    assert.ok(labelNode, `Expected rule input ${label}`);
    const control = nodes(labelNode, (node) => node.type === "input" || node.type === "textarea")[0];
    control.props.onChange({ target: { value } });
  }
}

test("creating a custom rule from a review returns its snapshot, persists both records and survives remount", async () => {
  const harness = workspace();
  button(harness.render(), "＋ 写一篇复盘").props.onClick();
  const draft = validEntry({ id: editor(harness).props.entry.id });
  editor(harness).props.onChange(draft);
  await editor(harness).props.onCreateRule();
  assert.equal(journal.readJournal(harness.accountStorage).entries[0].id, draft.id, "the source review is saved before rule creation");
  fillRule(harness);
  const form = nodes(harness.render(), (node) => node.type === "form")[0];
  form.props.onSubmit({ preventDefault() {} });
  await harness.settleAsync();
  const returned = editor(harness).props.entry;
  const savedRule = journal.readJournal(harness.accountStorage).rules[0];
  assert.equal(savedRule.title, "不追高");
  assert.equal(savedRule.sourceEntryId, draft.id);
  assert.equal(returned.ruleChecks.length, 1);
  assert.equal(JSON.stringify(returned.ruleChecks[0]), JSON.stringify(journal.snapshotTradingRule(savedRule)));
  assert.equal(nodes(harness.render(), (node) => node.type === WorkspaceTabs)[0].props.value, "journal");
  editor(harness).props.onChange({ ...returned, ruleChecks: [{ ...returned.ruleChecks[0], result: "followed" }] });
  await editor(harness).props.onSave(true);
  assert.equal(editor(harness), undefined);
  const stored = journal.readJournal(harness.accountStorage);
  assert.equal(stored.entries[0].status, "complete");
  assert.equal(stored.entries[0].ruleChecks[0].result, "followed");
  assert.equal(harness.accountStorage.getItem("trendsight.review-draft.v1"), null);
  harness.unmount();
  const reloaded = workspace(harness.accountStorage);
  button(reloaded.render(), "编辑").props.onClick();
  assert.equal(JSON.stringify(editor(reloaded).props.entry), JSON.stringify(stored.entries[0]));
});

test("a concurrent change prevents overwrite while preserving the unsaved editor and recoverable draft", async () => {
  const original = validEntry({ status: "complete" });
  const storage = memoryStorage();
  journal.saveJournal(storage, { ...journal.emptyJournal(), entries: [original] });
  const harness = workspace(storage);
  button(harness.render(), "编辑").props.onClick();
  editor(harness).props.onChange({ ...editor(harness).props.entry, lesson: "当前窗口尚未提交的思考" });
  const changedElsewhere = { ...original, nextAction: "另一窗口已保存的行动" };
  journal.saveJournal(storage, { ...journal.emptyJournal(), entries: [changedElsewhere] });
  harness.storageChanged();
  await editor(harness).props.onSave(true);
  assert.match(text(harness.render()), /已在其他窗口修改/);
  assert.equal(editor(harness).props.entry.lesson, "当前窗口尚未提交的思考");
  assert.equal(journal.readJournal(storage).entries[0].nextAction, "另一窗口已保存的行动");
  await harness.flushDraft();
  harness.unmount();
  const reloaded = workspace(storage);
  assert.equal(editor(reloaded).props.entry.lesson, "当前窗口尚未提交的思考");
  assert.match(text(reloaded.render()), /已恢复上次未提交/);
});

test("older v1 edit baselines migrate together with incomplete drafts and can save without a false conflict", async () => {
  const original = validEntry({ status: "complete" });
  delete original.strategyId;
  const storage = memoryStorage();
  storage.setItem(journal.JOURNAL_STORAGE_KEY, JSON.stringify({ version: 1, entries: [original], rules: [] }));
  storage.setItem("trendsight.review-draft.v1", JSON.stringify({ entry: { ...original, lesson: "", code: "600" }, base: JSON.stringify(original) }));
  const harness = workspace(storage);
  assert.equal(editor(harness).props.entry.lesson, "");
  assert.equal(editor(harness).props.entry.code, "600");
  assert.equal(editor(harness).props.entry.strategyId, "");
  editor(harness).props.onChange({ ...editor(harness).props.entry, code: "600519", lesson: "补充后的结论" });
  await editor(harness).props.onSave(true);
  assert.equal(editor(harness), undefined, "a migrated edit baseline must not appear to be another window's update");
  assert.equal(journal.readJournal(storage).entries[0].lesson, "补充后的结论");
});

test("saving a review keeps the dialog open and prevents cancellation until the database acknowledges it", async () => {
  const harness = workspace();
  button(harness.render(), "＋ 写一篇复盘").props.onClick();
  const entry = validEntry({ id: editor(harness).props.entry.id });
  editor(harness).props.onChange(entry);
  let complete;
  harness.setFlush(() => new Promise((resolve) => { complete = resolve; }));
  const saving = editor(harness).props.onSave(true);
  assert.equal(editor(harness).props.saving, true);
  assert.equal(nodes(harness.render(), (node) => node.type === ReviewDialog && node.props.open)[0].props.busy, true);
  editor(harness).props.onCancel();
  assert.equal(editor(harness).props.entry.id, entry.id);
  assert.doesNotMatch(text(harness.render()), /复盘已完成。/);
  harness.setFlush(async () => {});
  complete();
  await saving;
  assert.equal(editor(harness), undefined);
  assert.match(text(harness.render()), /复盘已完成。/);
});

test("failed database writes keep the review editor and allow retrying its own queued write", async () => {
  const harness = workspace();
  button(harness.render(), "＋ 写一篇复盘").props.onClick();
  const entry = validEntry({ id: editor(harness).props.entry.id });
  editor(harness).props.onChange(entry);
  harness.setFlush(async () => { throw new Error("账户数据保存失败，请重试"); });
  await editor(harness).props.onSave(true);
  assert.equal(editor(harness).props.entry.lesson, entry.lesson);
  assert.equal(editor(harness).props.saving, false);
  assert.match(text(harness.render()), /账户数据保存失败/);
  assert.doesNotMatch(text(harness.render()), /复盘已完成。/);
  // Account storage retains failed pending values; the local conflict guard must
  // permit exactly this editor's write while the server still enforces CAS.
  assert.equal(journal.readJournal(harness.accountStorage).entries[0].id, entry.id);
  harness.setFlush(async () => {});
  await editor(harness).props.onSave(true);
  assert.equal(editor(harness), undefined);
  assert.match(text(harness.render()), /复盘已完成。/);
});

test("account changes during a pending save cannot close the editor or report success", async () => {
  const harness = workspace(undefined, "https://example.test/review?compose=1&stock=600519");
  const entry = validEntry({ id: editor(harness).props.entry.id });
  editor(harness).props.onChange(entry);
  let complete;
  harness.setFlush(() => new Promise((resolve) => { complete = resolve; }));
  const saving = editor(harness).props.onSave(true);
  harness.setUser("bob");
  complete();
  await saving;
  assert.equal(editor(harness).props.entry.id, entry.id);
  assert.match(text(harness.render()), /登录账户已变化/);
  assert.doesNotMatch(text(harness.render()), /复盘已完成。/);
  assert.equal(new URL(harness.location.href).searchParams.has("compose"), false, "compose links are consumed once");
});

test("stock compose and saved entry links take precedence over unrelated recovered drafts", async () => {
  const storage = memoryStorage();
  const saved = validEntry({ status: "complete", id: "saved-review" });
  const unrelated = validEntry({ id: "unsaved-review", title: "之前未提交" });
  journal.saveJournal(storage, { ...journal.emptyJournal(), entries: [saved] });
  storage.setItem("trendsight.review-draft.v1", JSON.stringify({ entry: unrelated, base: "" }));
  const linked = workspace(storage, "https://example.test/review?entry=saved-review&stock=600519&view=journal");
  assert.equal(editor(linked).props.entry.id, saved.id);
  assert.equal(new URL(linked.location.href).searchParams.has("entry"), false, "entry links are consumed before editing");
  await editor(linked).props.onSave(true);
  assert.equal(editor(linked), undefined);
  const url = new URL(linked.location.href);
  assert.equal(url.searchParams.has("entry"), false);
  assert.equal(url.searchParams.get("stock"), "600519");
  assert.equal(url.searchParams.get("view"), "journal");
  linked.unmount();
  storage.setItem("trendsight.review-draft.v1", JSON.stringify({ entry: unrelated, base: "" }));
  const composed = workspace(storage, "https://example.test/review?compose=1&stock=US%3AAAPL&name=Apple");
  assert.equal(editor(composed).props.entry.market, "US");
  assert.equal(editor(composed).props.entry.code, "AAPL");
  assert.equal(editor(composed).props.entry.name, "Apple");
  assert.notEqual(editor(composed).props.entry.id, unrelated.id);
  assert.equal(new URL(composed.location.href).searchParams.has("compose"), false);
  editor(composed).props.onCancel();
  assert.equal(new URL(composed.location.href).searchParams.has("compose"), false);
  assert.equal(editor(composed), undefined);
});

test("missing entry links show an account-safe message without silently opening another draft", () => {
  const storage = memoryStorage();
  storage.setItem("trendsight.review-draft.v1", JSON.stringify({ entry: validEntry(), base: "" }));
  const harness = workspace(storage, "https://example.test/review?entry=another-account-review");
  assert.equal(editor(harness), undefined);
  assert.match(text(harness.render()), /不存在或不属于当前账户/);
});

test("rule saves remain open on database failure and retry without discarding their text", async () => {
  const harness = workspace();
  button(harness.render(), "＋ 新建规则").props.onClick();
  fillRule(harness);
  harness.setFlush(async () => { throw new Error("账户数据保存失败"); });
  nodes(harness.render(), (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  await harness.settleAsync();
  assert.equal(nodes(harness.render(), (node) => node.type === "form").length, 1);
  assert.match(text(harness.render()), /账户数据保存失败/);
  assert.equal(journal.readJournal(harness.accountStorage).rules[0].title, "不追高");
  harness.setFlush(async () => {});
  nodes(harness.render(), (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  await harness.settleAsync();
  assert.equal(nodes(harness.render(), (node) => node.type === "form").length, 0);
  assert.match(text(harness.render()), /规则已保存/);
});

test("strategy saves report false on persistence failure and succeed after a retry", async () => {
  const harness = workspace();
  const strategy = { ...journal.createTradingStrategy(), name: "突破确认" };
  const library = () => nodes(harness.render(), (node) => node.type === StrategyLibrary)[0];
  harness.setFlush(async () => { throw new Error("账户数据保存失败"); });
  assert.equal(await library().props.onSave(strategy, ""), false);
  assert.doesNotMatch(text(harness.render()), /策略已保存/);
  harness.setFlush(async () => {});
  assert.equal(await library().props.onSave(strategy, ""), true);
  assert.match(text(harness.render()), /策略已保存/);
  assert.equal(journal.readJournal(harness.accountStorage).strategies[0].name, strategy.name);
});

test("an entry link restores newer edits for that entry and consuming its URL protects them on reload", async () => {
  const storage = memoryStorage();
  const saved = validEntry({ id: "same-entry", status: "complete" });
  const edited = { ...saved, lesson: "刷新前尚未提交的分析" };
  journal.saveJournal(storage, { ...journal.emptyJournal(), entries: [saved] });
  storage.setItem("trendsight.review-draft.v1", JSON.stringify({ entry: edited, base: JSON.stringify(saved) }));
  const harness = workspace(storage, "https://example.test/review?entry=same-entry");
  assert.equal(editor(harness).props.entry.lesson, edited.lesson);
  assert.equal(new URL(harness.location.href).searchParams.has("entry"), false);
  editor(harness).props.onChange({ ...edited, lesson: "链接打开后进一步修改" });
  await harness.flushDraft();
  harness.unmount();
  const reloaded = workspace(storage, harness.location.href);
  assert.equal(editor(reloaded).props.entry.lesson, "链接打开后进一步修改");
});

test("declining a new stock compose link preserves the prior draft", () => {
  const storage = memoryStorage();
  const edited = validEntry({ id: "important-draft" });
  storage.setItem("trendsight.review-draft.v1", JSON.stringify({ entry: edited, base: "" }));
  const harness = workspace(storage, "https://example.test/review?compose=1&stock=US%3AAAPL", false);
  assert.equal(editor(harness).props.entry.id, edited.id);
  assert.equal(editor(harness).props.entry.code, edited.code);
  assert.equal(new URL(harness.location.href).searchParams.has("compose"), false);
});

test("stock links filter exact instrument identity instead of incidental mentions in another review", () => {
  const storage = memoryStorage();
  const selected = validEntry({ status: "complete", title: "标的复盘" });
  const mention = validEntry({ status: "complete", id: "mention", code: "600000", name: "另一只股票", title: "对比600519但不是该标的" });
  journal.saveJournal(storage, { ...journal.emptyJournal(), entries: [selected, mention] });
  const harness = workspace(storage, "https://example.test/review?stock=600519");
  const cards = nodes(harness.render(), (node) => node.type === "article");
  assert.equal(cards.length, 1);
  assert.match(text(cards[0]), /标的复盘/);
  assert.doesNotMatch(text(cards[0]), /对比600519/);
});
