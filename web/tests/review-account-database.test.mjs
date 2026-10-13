import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createAccountDataHandlers } from "../app/api/account-data/route.ts";
import { accountDataMaxBytes } from "../app/lib/accountData.ts";
import { createAccountStorageClient } from "../app/lib/accountStorage.ts";
import { createAuthHandlers } from "../app/lib/authServer.ts";
import {
  JOURNAL_STORAGE_KEY, createReviewEntry, createTradingRule, createTradingStrategy,
  emptyJournal, parseJournal, readJournal, saveJournal, snapshotTradingRule,
} from "../app/lib/tradingJournal.ts";

const origin = "https://review.example.test";
const draftKey = "trendsight.review-draft.v1";

// Real SQLite executes the checked-in D1 migrations and every generated SQL statement.
// The identity dependency calls the real session reader through the auth /me handler.
function database(t) {
  const directory = mkdtempSync(join(tmpdir(), "review-account-database-"));
  const filename = join(directory, "personal.sqlite");
  let sqlite = new DatabaseSync(filename);
  let failWrites = false;
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  const db = drizzle(async (sql, params, method) => {
    if (failWrites && /^(?:insert into|update) "account_data"/.test(sql)) throw new Error("simulated database unavailable");
    const statement = sqlite.prepare(sql);
    statement.setReturnArrays(true);
    if (method === "run") { statement.run(...params); return { rows: [] }; }
    return { rows: method === "get" ? statement.get(...params) : statement.all(...params) };
  });
  const auth = createAuthHandlers({ getDatabase: async () => db, logServiceError: (reason) => { throw reason; } });
  const handlers = createAccountDataHandlers({
    getDatabase: async () => db,
    identifyUser: async (request) => {
      const response = await auth.me(request);
      if (!response.ok) throw new Error("session service unavailable");
      return (await response.json()).user?.id ?? null;
    },
  });
  const fetcher = (cookie) => async (path, init = {}) => handlers[init.method ?? "GET"](new Request(`${origin}${path}`, {
    ...init, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
  }));
  async function register(name) {
    const response = await auth.register(new Request(`${origin}/api/auth/register`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${name}@example.test`, displayName: name, password: "TestPassword123!" }),
    }));
    assert.equal(response.status, 201);
    const { user } = await response.json();
    const cookie = response.headers.get("set-cookie").split(";")[0];
    return { user, cookie, fetch: fetcher(cookie) };
  }
  t.after(() => { sqlite.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    register, fetcher, handlers,
    reopen() { sqlite.close(); sqlite = new DatabaseSync(filename); },
    failWrites(value) { failWrites = value; },
    rows() { return sqlite.prepare("SELECT user_key, key, value, revision FROM account_data ORDER BY user_key, key").all(); },
  };
}

function journal(label = "按规则执行") {
  const entry = {
    ...createReviewEntry("2026-01-12", { code: "600519", name: "贵州茅台", market: "CN" }),
    title: label, status: "complete", operation: "buy", operationPrice: 1500,
    marketContext: "观察市场趋势", setup: "回调企稳", thesis: "价格达到既定条件",
    plannedEntry: 1500, stopLoss: 1450, targetPrice: 1650, entryPrice: 1500,
    quantity: 100, fees: 5, entryDate: "2026-01-12", emotion: "平静",
    tags: ["趋势"], mistakes: [], wentWell: "等待确认", lesson: "遵循计划",
    nextAction: "按止损条件执行", reviewDate: "2026-01-13",
  };
  const rule = {
    ...createTradingRule(entry), title: "确认后入场", condition: "回调企稳", action: "按计划买入",
    invalidation: "跌破止损价", category: "entry", status: "active", version: 3,
  };
  const strategy = { ...createTradingStrategy(), name: "趋势回调", description: "等待确认信号", ruleIds: [rule.id] };
  entry.strategyId = strategy.id;
  entry.ruleChecks = [{ ...snapshotTradingRule(rule), result: "followed", note: "已确认" }];
  return parseJournal({ version: 1, entries: [entry], rules: [rule], strategies: [strategy] });
}

const write = (userId, value, overrides = {}) => ({
  userId, key: JOURNAL_STORAGE_KEY, value: typeof value === "string" ? value : JSON.stringify(value),
  revision: 0, mutationId: crypto.randomUUID(), ...overrides,
});
const put = (fetcher, body) => fetcher("/api/account-data", { method: "PUT", body: JSON.stringify(body) });

test("complete reviews, operation prices, rule snapshots and strategies survive database reopening", async (t) => {
  const api = database(t);
  const alice = await api.register("alice");
  const state = journal();
  const client = createAccountStorageClient(alice.fetch);
  await client.hydrate(alice.user.id);
  saveJournal(client.storage, state);
  await client.flush();
  assert.equal(client.getStatus().pending, 0);
  assert.deepEqual(JSON.parse(api.rows()[0].value), state);
  api.reopen();
  const reloaded = createAccountStorageClient(alice.fetch);
  await reloaded.hydrate(alice.user.id);
  assert.deepEqual(readJournal(reloaded.storage), state);
  const response = await alice.fetch(`/api/account-data?userId=${alice.user.id}`);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
});

test("real authenticated sessions isolate journals and drafts and reject a forged account owner", async (t) => {
  const api = database(t);
  const alice = await api.register("alice");
  const bob = await api.register("bob");
  const a = journal("Alice 私人复盘");
  const b = journal("Bob 私人复盘");
  assert.equal((await put(alice.fetch, write(alice.user.id, a))).status, 200);
  assert.equal((await put(alice.fetch, write(alice.user.id, "未完成的草稿", { key: draftKey }))).status, 200);
  assert.deepEqual((await (await bob.fetch("/api/account-data")).json()).entries, []);
  assert.equal((await bob.fetch(`/api/account-data?userId=${alice.user.id}`)).status, 401);
  assert.equal((await put(bob.fetch, write(alice.user.id, b))).status, 401);
  assert.equal((await put(bob.fetch, write(bob.user.id, b))).status, 200);
  for (const [account, expected] of [[alice, a], [bob, b]]) {
    const result = await (await account.fetch("/api/account-data")).json();
    assert.equal(result.userId, account.user.id);
    assert.deepEqual(JSON.parse(result.entries.find((entry) => entry.key === JOURNAL_STORAGE_KEY).value), expected);
    assert.equal(result.entries.some((entry) => entry.key === draftKey), account === alice);
  }
});

test("guest or forged session cannot read or persist a journal", async (t) => {
  const api = database(t);
  for (const cookie of [undefined, "ts_session=local-preview", `ts_session=${"a".repeat(64)}`]) {
    const fetcher = api.fetcher(cookie);
    assert.equal((await fetcher("/api/account-data")).status, 401);
    assert.equal((await put(fetcher, write("forged-user", journal()))).status, 401);
  }
  assert.deepEqual(api.rows(), []);
});

test("concurrent journal writes use CAS and preserve the successful version and failed local edit", async (t) => {
  const api = database(t);
  const alice = await api.register("alice");
  const first = createAccountStorageClient(alice.fetch);
  const stale = createAccountStorageClient(alice.fetch);
  await first.hydrate(alice.user.id);
  await stale.hydrate(alice.user.id);
  const saved = journal("已保存版本");
  const unsaved = journal("另一窗口的编辑");
  saveJournal(first.storage, saved);
  await first.flush();
  saveJournal(stale.storage, unsaved);
  await assert.rejects(stale.flush(), /其他窗口/);
  assert.equal(stale.getStatus().phase, "error");
  assert.equal(stale.getStatus().pending, 1);
  assert.deepEqual(readJournal(stale.storage), unsaved);
  assert.deepEqual(JSON.parse(api.rows()[0].value), saved);
  assert.equal(api.rows()[0].revision, 1);
  assert.deepEqual(JSON.parse(JSON.parse(stale.exportPending()).entries[0].value), unsaved);
});

test("invalid and oversized journal payloads cannot replace valid history; incomplete editor drafts remain allowed", async (t) => {
  const api = database(t);
  const alice = await api.register("alice");
  const original = journal();
  assert.equal((await put(alice.fetch, write(alice.user.id, original))).status, 200);
  const invalidEntry = structuredClone(original);
  invalidEntry.entries[0].operationPrice = -1;
  const incompleteEntry = structuredClone(original);
  incompleteEntry.entries[0].lesson = "";
  const invalidRule = structuredClone(original);
  invalidRule.rules[0].version = 0;
  const invalidStrategy = structuredClone(original);
  invalidStrategy.strategies[0].name = "";
  for (const value of ["not json", { version: 2, entries: [], rules: [], strategies: [] }, invalidEntry, incompleteEntry, invalidRule, invalidStrategy]) {
    const response = await put(alice.fetch, write(alice.user.id, value, { revision: 1 }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "复盘数据格式无效，原有记录未被修改", code: "INVALID_JOURNAL_DATA" });
  }
  assert.equal((await put(alice.fetch, write(alice.user.id, "x".repeat(accountDataMaxBytes + 1), { revision: 1 }))).status, 413);
  assert.deepEqual(JSON.parse(api.rows()[0].value), original);
  assert.equal(api.rows()[0].revision, 1);
  const draft = JSON.stringify({ entry: { title: "正在填写", operationPrice: -1 } });
  assert.equal((await put(alice.fetch, write(alice.user.id, draft, { key: draftKey }))).status, 200);
});

test("database failure rejects flush, preserves pending review and permits a successful retry", async (t) => {
  const api = database(t);
  const alice = await api.register("alice");
  const client = createAccountStorageClient(alice.fetch);
  await client.hydrate(alice.user.id);
  const state = journal("暂未保存的内容");
  api.failWrites(true);
  saveJournal(client.storage, state);
  await assert.rejects(client.flush(), /保存失败/);
  assert.equal(client.getStatus().phase, "error");
  assert.equal(client.getStatus().pending, 1);
  assert.deepEqual(readJournal(client.storage), state);
  assert.deepEqual(api.rows(), []);
  api.failWrites(false);
  await client.flush();
  assert.equal(client.getStatus().phase, "ready");
  assert.equal(client.getStatus().pending, 0);
  assert.deepEqual(JSON.parse(api.rows()[0].value), state);
});

test("empty journal is accepted without requiring any review or rule", async (t) => {
  const api = database(t);
  const alice = await api.register("alice");
  const response = await put(alice.fetch, write(alice.user.id, emptyJournal()));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(api.rows()[0].value), emptyJournal());
});
