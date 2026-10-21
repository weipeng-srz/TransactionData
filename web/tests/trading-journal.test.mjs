import assert from "node:assert/strict";
import test from "node:test";
import {
  JOURNAL_STORAGE_KEY,
  createReviewEntry,
  createTradingRule,
  createTradingStrategy,
  emptyJournal,
  journalStats,
  mergeJournal,
  parseJournal,
  parseEditingReviewEntry,
  priceChange,
  readJournal,
  ruleStats,
  saveJournal,
  snapshotTradingRule,
  tradeMetrics,
  validateReviewEntry,
  validateTradingRule,
  validateTradingStrategy,
} from "../app/lib/tradingJournal.ts";

function completedTrade(overrides = {}) {
  return {
    ...createReviewEntry("2026-10-13", { code: "600519", name: "贵州茅台", market: "CN" }),
    title: "突破后按计划离场", status: "complete", thesis: "放量突破后等待回踩", lesson: "等待确认可减少追高", nextAction: "回踩确认后入场",
    operation: "buy", operationPrice: 101, plannedEntry: 100, entryPrice: 101, stopLoss: 95, targetPrice: 110, exitPrice: 110, quantity: 100, fees: 10,
    entryDate: "2026-10-12", exitDate: "2026-10-13", ...overrides,
  };
}

function validRule(overrides = {}) {
  return { ...createTradingRule(), title: "等待回踩", condition: "突破后回踩支撑", action: "确认量缩后入场", invalidation: "跌破支撑则放弃", ...overrides };
}

test("empty journals and incomplete drafts round-trip without invented trade data", () => {
  const journal = emptyJournal();
  const entry = createReviewEntry("2026-10-13");
  journal.entries.push(entry);
  assert.deepEqual(validateReviewEntry(entry), []);
  assert.ok(validateReviewEntry(entry, true).length > 0);
  assert.deepEqual(parseJournal(JSON.stringify(journal)), journal);
  assert.equal(tradeMetrics(entry).netPnl, null);
  assert.notEqual(createReviewEntry().id, createReviewEntry().id);
});

test("completed reviews require reasoning, learning, an action and evaluated rules", () => {
  assert.deepEqual(validateReviewEntry(completedTrade()), []);
  const check = snapshotTradingRule(validRule());
  assert.match(validateReviewEntry(completedTrade({ ruleChecks: [check] })).join(" "), /逐条评价/);
  check.result = "broken";
  assert.match(validateReviewEntry(completedTrade({ ruleChecks: [check] })).join(" "), /原因/);
  check.note = "追涨后才看到条件未满足";
  assert.deepEqual(validateReviewEntry(completedTrade({ ruleChecks: [check] })), []);
  assert.match(validateReviewEntry(completedTrade({ nextAction: " " })).join(" "), /行动/);
  assert.match(validateReviewEntry(completedTrade({ exitDate: "" })).join(" "), /同时/);
});

test("restores intermediate editor state without requiring a submittable record", () => {
  const pendingCheck = snapshotTradingRule(validRule());
  for (const entry of [
    { ...createReviewEntry(), code: "600" },
    { ...createReviewEntry(), date: "" },
    completedTrade({ lesson: "", ruleChecks: [pendingCheck] }),
    completedTrade({ operationPrice: -1 }),
  ]) {
    assert.deepEqual(parseEditingReviewEntry(JSON.parse(JSON.stringify(entry))), entry);
    assert.throws(() => parseJournal({ version: 1, entries: [entry], rules: [] }));
  }
  assert.throws(() => parseEditingReviewEntry({ ...createReviewEntry(), code: 123 }), /代码/);
  assert.throws(() => parseEditingReviewEntry({ ...createReviewEntry(), operationPrice: Infinity }), /有限数字/);
  assert.throws(() => parseEditingReviewEntry({ ...createReviewEntry(), market: "unknown" }), /市场/);
  assert.throws(() => parseEditingReviewEntry({ ...createReviewEntry(), lesson: "x".repeat(20_001) }), /过长/);
});

test("future dates stay drafts and realized returns use the current date in China", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-13T16:01:00.000Z") });
  assert.deepEqual(validateReviewEntry(completedTrade({ date: "2026-10-14" })), []);
  for (const patch of [{ date: "2026-10-15" }, { entryDate: "2026-10-15", exitDate: "" , exitPrice: null }, { exitDate: "2026-10-15" }]) {
    const entry = completedTrade(patch);
    assert.match(validateReviewEntry(entry).join(" "), /不能晚于北京时间今日/);
    assert.deepEqual(validateReviewEntry({ ...entry, status: "draft" }), []);
  }
  assert.equal(tradeMetrics(completedTrade({ status: "draft", exitDate: "2026-10-15" })).netPnl, null);
  assert.equal(tradeMetrics(completedTrade({ exitDate: "2026-10-14" })).netPnl, 890);
});

test("saved symbols match platform quote keys without silently changing stored content", () => {
  for (const patch of [{ code: "600519 " }, { code: " 600519" }, { market: "US", code: "aapl" }, { market: "US", code: "ABCDEFGHIJK" }]) {
    assert.ok(validateReviewEntry(completedTrade(patch)).length);
  }
  assert.deepEqual(validateReviewEntry(completedTrade({ market: "US", code: "BRK.B" })), []);
  const entry = completedTrade({ market: "US", code: "aapl " });
  assert.equal(parseEditingReviewEntry(entry).code, "aapl ");
});

test("validates real calendar dates, finite positive prices and nonnegative fees", () => {
  assert.ok(validateReviewEntry(completedTrade({ date: "2026-02-30" })).length);
  assert.ok(validateReviewEntry(completedTrade({ exitDate: "2026-10-11" })).length);
  assert.ok(validateReviewEntry(completedTrade({ reviewDate: "2026-10-12" })).length);
  for (const value of [0, -1, NaN, Infinity]) {
    assert.ok(validateReviewEntry(completedTrade({ entryPrice: value })).length);
    assert.ok(validateReviewEntry(completedTrade({ quantity: value })).length);
  }
  assert.ok(validateReviewEntry(completedTrade({ fees: -1 })).length);
  assert.deepEqual(validateReviewEntry(completedTrade({ fees: 0 })), []);
  assert.ok(validateReviewEntry(completedTrade({ market: "US", code: "600519" })).length);
  assert.deepEqual(validateReviewEntry(completedTrade({ market: "US", code: "BRK.B" })), []);
});

test("calculates long trades using actual fill, net fees and initial stop risk", () => {
  const metrics = tradeMetrics(completedTrade());
  assert.equal(metrics.netPnl, 890);
  assert.equal(metrics.returnPct, 890 / 10100 * 100);
  assert.equal(metrics.rMultiple, 890 / 600);
  assert.equal(metrics.plannedRR, 2);
});

test("calculates short trades with correct directional stop and target", () => {
  const metrics = tradeMetrics(completedTrade({ direction: "short", plannedEntry: 100, entryPrice: 100, stopLoss: 105, targetPrice: 90, exitPrice: 90 }));
  assert.equal(metrics.netPnl, 990);
  assert.equal(metrics.rMultiple, 1.98);
  assert.equal(metrics.plannedRR, 2);
  const wrongSide = tradeMetrics(completedTrade({ direction: "short" }));
  assert.equal(wrongSide.rMultiple, null);
  assert.equal(wrongSide.plannedRR, null);
});

test("does not report unrealized positions, observations, missing fees or missing dates as profit", () => {
  for (const patch of [{ exitPrice: null }, { exitDate: "" }, { entryDate: "" }, { fees: null }, { kind: "observation" }, { entryPrice: 0 }]) {
    assert.equal(tradeMetrics(completedTrade(patch)).netPnl, null);
  }
  assert.equal(tradeMetrics(completedTrade({ fees: 0 })).netPnl, 900);
});

test("operation price is preserved separately from entry and exit fills", () => {
  const entry = completedTrade({ operation: "reduce", operationPrice: 108 });
  const parsed = parseJournal({ version: 1, entries: [entry], rules: [] });
  assert.equal(parsed.entries[0].operation, "reduce");
  assert.equal(parsed.entries[0].operationPrice, 108);
  assert.equal(parsed.entries[0].entryPrice, 101);
  assert.equal(parsed.entries[0].exitPrice, 110);
  assert.equal(createReviewEntry().operation, "observe");
  assert.match(validateReviewEntry(completedTrade({ operationPrice: null })).join(" "), /操作时价格/);
  assert.match(validateReviewEntry(completedTrade({ kind: "observation", operationPrice: null })).join(" "), /操作时价格/);
});

test("post-operation stock movement handles gains, losses, flat prices and unavailable quotes", () => {
  assert.deepEqual(priceChange(100, 110), { amount: 10, percent: 10 });
  assert.deepEqual(priceChange(100, 90), { amount: -10, percent: -10 });
  assert.deepEqual(priceChange(100, 100), { amount: 0, percent: 0 });
  for (const unavailable of [null, undefined, NaN, Infinity, 0, -10]) {
    assert.equal(priceChange(100, unavailable), null);
    assert.equal(priceChange(unavailable, 100), null);
  }
});

test("statistics exclude drafts and unknown outcomes and never add CNY to USD", () => {
  const entries = [completedTrade(), completedTrade({ status: "draft" }), completedTrade({ exitPrice: null, exitDate: "" }), completedTrade({ market: "US", code: "AAPL", exitPrice: 90 })];
  const all = journalStats(entries);
  assert.equal(all.total, 4);
  assert.equal(all.completed, 3);
  assert.equal(all.closedTrades, 2);
  assert.equal(all.winRate, 50);
  assert.equal(all.netPnl, null);
  assert.equal(journalStats(entries, "CN").netPnl, 890);
  assert.equal(journalStats(entries, "US").netPnl, -1110);
  assert.equal(journalStats([]).winRate, null);
  assert.equal(journalStats([]).netPnl, null);
});

test("rule snapshots keep historical wording and execution excludes pending, N/A and drafts", () => {
  const rule = validRule();
  const check = snapshotTradingRule(rule);
  rule.title = "修订后的规则";
  rule.version += 1;
  assert.equal(check.title, "等待回踩");
  assert.equal(check.ruleVersion, 1);
  const entries = [
    completedTrade({ ruleChecks: [{ ...check, result: "followed" }] }),
    completedTrade({ ruleChecks: [{ ...check, result: "broken", note: "追高" }] }),
    completedTrade({ ruleChecks: [{ ...check, result: "na" }] }),
    completedTrade({ status: "draft", ruleChecks: [{ ...check, result: "followed" }] }),
  ];
  assert.deepEqual(ruleStats(rule.id, entries), { followed: 1, broken: 1, sampleCount: 2, executionRate: 50 });
  assert.equal(journalStats(entries).executionRate, 50);
  assert.equal(ruleStats("missing", entries).executionRate, null);
});

test("rules require concrete trigger, action and invalidation", () => {
  assert.deepEqual(validateTradingRule(validRule()), []);
  assert.ok(validateTradingRule(createTradingRule()).length >= 3);
  assert.ok(validateTradingRule(validRule({ version: 0 })).length);
  const source = completedTrade({ setup: "放量后回踩", nextAction: "缩量确认再入场" });
  const extracted = createTradingRule(source);
  assert.equal(extracted.sourceEntryId, source.id);
  assert.equal(extracted.condition, source.setup);
  assert.equal(extracted.action, source.nextAction);
});

test("rejects corrupted, incompatible, duplicate and oversized imports without dropping records", () => {
  const entry = completedTrade();
  const base = { version: 1, entries: [entry], rules: [validRule()], strategies: [] };
  assert.deepEqual(parseJournal(base), base);
  assert.throws(() => parseJournal("not json"), /JSON/);
  assert.throws(() => parseJournal({ ...base, version: 2 }), /版本/);
  assert.throws(() => parseJournal({ ...base, secretField: true }), /不支持的字段/);
  assert.throws(() => parseJournal({ ...base, entries: [entry, entry] }), /重复 ID/);
  assert.throws(() => parseJournal({ ...base, entries: [{ ...entry, quantity: "100" }] }), /数字/);
  assert.throws(() => parseJournal({ ...base, entries: [{ ...entry, quantity: NaN }] }), /数字/);
  assert.throws(() => parseJournal({ ...base, entries: [{ ...entry, lesson: "" }] }), /结论/);
  assert.throws(() => parseJournal({ ...base, entries: [{ ...entry, tags: [123] }] }), /标签/);
  assert.throws(() => parseJournal({ ...base, entries: [{ ...entry, thesis: "x".repeat(20_001) }] }), /过长/);
  assert.throws(() => parseJournal({ ...base, entries: Array(10_001).fill(entry) }), /10000/);
  assert.throws(() => parseJournal({ ...base, entries: [{ ...entry, createdAt: "2026-02-30T12:00:00Z" }] }), /时间/);
  assert.equal(base.entries.length, 1);
});

test("read and save preserve data and surface storage failures", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(readJournal(storage), emptyJournal());
  const state = { version: 1, entries: [completedTrade()], rules: [], strategies: [] };
  saveJournal(storage, state);
  assert.deepEqual(readJournal(storage), state);
  const before = values.get(JOURNAL_STORAGE_KEY);
  assert.throws(() => saveJournal({ setItem: () => { throw new Error("QuotaExceededError"); } }, state), /Quota/);
  assert.equal(values.get(JOURNAL_STORAGE_KEY), before);
  values.set(JOURNAL_STORAGE_KEY, "broken");
  assert.throws(() => readJournal(storage), /JSON/);
  assert.equal(values.get(JOURNAL_STORAGE_KEY), "broken");
});

test("additive import is idempotent and reports conflicts while preserving local history", () => {
  const entry = completedTrade();
  const rule = validRule();
  const current = { version: 1, entries: [entry], rules: [rule] };
  const incoming = { version: 1, entries: [{ ...entry, lesson: "另一台设备的记录" }, completedTrade()], rules: [{ ...rule, version: 2, action: "另一版本" }, validRule()] };
  const merged = mergeJournal(current, incoming);
  assert.equal(merged.addedEntries, 1);
  assert.equal(merged.addedRules, 1);
  assert.equal(merged.conflicts.length, 2);
  assert.equal(merged.state.entries[0].lesson, entry.lesson);
  assert.equal(merged.state.rules[0].version, 1);
  assert.equal(current.entries.length, 1);
  assert.equal(incoming.entries.length, 2);
  const again = mergeJournal(merged.state, incoming);
  assert.equal(again.addedEntries, 0);
  assert.equal(again.addedRules, 0);
  assert.equal(again.state.entries.length, 2);
});

test("upgrades older v1 journals and editing drafts with missing strategy fields only", () => {
  const legacyEntry = { ...completedTrade() };
  delete legacyEntry.strategyId;
  const legacy = { version: 1, entries: [legacyEntry], rules: [] };
  const upgraded = parseJournal(legacy);
  assert.deepEqual(upgraded.strategies, []);
  assert.equal(upgraded.entries[0].strategyId, "");
  assert.equal(parseEditingReviewEntry(legacyEntry).strategyId, "");
  assert.ok(!Object.hasOwn(legacyEntry, "strategyId"));
  assert.throws(() => parseJournal({ ...legacy, strategies: null }), /交易策略/);
  assert.throws(() => parseJournal({ ...legacy, entries: [{ ...legacyEntry, strategyId: 5 }] }), /策略 ID/);
  assert.throws(() => parseJournal({ ...legacy, customField: true }), /不支持的字段/);
  assert.throws(() => parseJournal({ ...legacy, entries: [{ ...legacyEntry, customField: true }] }), /不支持的字段/);
});

test("custom strategies round-trip with linked rules and preserve a review's setup snapshot", () => {
  const rule = validRule();
  const strategy = { ...createTradingStrategy(), name: "突破回踩", description: "突破后等待回踩确认", ruleIds: [rule.id] };
  assert.deepEqual(validateTradingStrategy(strategy), []);
  assert.match(validateTradingStrategy(createTradingStrategy()).join(" "), /名称/);
  assert.match(validateTradingStrategy({ ...strategy, ruleIds: [rule.id, rule.id] }).join(" "), /重复/);
  const entry = completedTrade({ strategyId: strategy.id, setup: strategy.name });
  const journal = { version: 1, entries: [entry], rules: [rule], strategies: [strategy] };
  assert.deepEqual(parseJournal(JSON.stringify(journal)), journal);
  assert.equal(JSON.stringify(parseJournal(journal).entries[0]), JSON.stringify(entry), "parsing must preserve edit-conflict baseline field order");
  strategy.name = "更新后的名称";
  strategy.status = "archived";
  const parsed = parseJournal(journal);
  assert.equal(parsed.strategies[0].name, "更新后的名称");
  assert.equal(parsed.entries[0].setup, "突破回踩");
  assert.equal(parsed.entries[0].strategyId, strategy.id);
  assert.throws(() => parseJournal({ ...journal, strategies: [strategy, strategy] }), /重复 ID/);
  assert.throws(() => parseJournal({ ...journal, strategies: [{ ...strategy, ruleIds: [123] }] }), /关联规则 ID/);
  assert.throws(() => parseJournal({ ...journal, strategies: [{ ...strategy, ruleIds: [rule.id, rule.id] }] }), /重复/);
});

test("strategy import adds new IDs, reports conflicts and never rewrites local strategy history", () => {
  const strategy = { ...createTradingStrategy(), name: "突破回踩" };
  const newStrategy = { ...createTradingStrategy(), name: "趋势延续" };
  const local = { ...emptyJournal(), strategies: [strategy] };
  const incoming = { ...emptyJournal(), strategies: [{ ...strategy, name: "异地修改" }, newStrategy] };
  const merged = mergeJournal(local, incoming);
  assert.equal(merged.addedStrategies, 1);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.state.strategies[0].name, "突破回踩");
  assert.equal(merged.state.strategies[1].name, "趋势延续");
  assert.equal(mergeJournal(merged.state, incoming).addedStrategies, 0);
  assert.equal(local.strategies.length, 1);
});
