import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createAccountDataHandlers } from "../app/api/account-data/route.ts";
import { createAccountStorageClient } from "../app/lib/accountStorage.ts";

const watchlist = "ticklens.watchlist.v1";
const holdings = "ticklens.holdings.v1";
function service() {
  const sqlite = new DatabaseSync(":memory:");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  const db = drizzle(async (sql, params, method) => {
    const statement = sqlite.prepare(sql);
    if (method === "run") { statement.run(...params); return { rows: [] }; }
    return { rows: statement.all(...params).map((row) => Object.values(row)) };
  });
  let identity = "alice";
  const handlers = createAccountDataHandlers({ getDatabase: async () => db, identifyUser: async () => identity });
  const fetcher = async (path, init = {}) => {
    const request = new Request(`https://example.test${path}`, { ...init, headers: { Origin: "https://example.test", ...init.headers } });
    return handlers[init.method ?? "GET"](request);
  };
  return { sqlite, handlers, fetcher, setIdentity(value) { identity = value; } };
}
function write(overrides = {}) { return { userId: "alice", key: watchlist, value: '["600519"]', revision: 0, mutationId: crypto.randomUUID(), ...overrides }; }
const put = (fetcher, body) => fetcher("/api/account-data", { method: "PUT", body: JSON.stringify(body) });

test("stores each key by authenticated owner, detects concurrent changes and preserves deletion revisions", async (t) => {
  const api = service(); t.after(() => api.sqlite.close());
  const initial = write();
  assert.equal((await put(api.fetcher, initial)).status, 200);
  assert.equal((await put(api.fetcher, initial)).status, 200, "lost response retries are idempotent");
  assert.equal((await put(api.fetcher, write({ value: '[]' }))).status, 409, "stale writes cannot overwrite");
  assert.equal((await put(api.fetcher, write({ key: holdings, value: '[{"shares":10}]' }))).status, 200, "different keys do not conflict");
  const removed = await put(api.fetcher, write({ value: null, revision: 1 }));
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).entry.revision, 2);
  assert.equal((await put(api.fetcher, write())).status, 409, "deletion must not allow an old revision-zero insert");
  api.setIdentity("bob");
  assert.equal((await put(api.fetcher, write())).status, 401, "changed cookies cannot redirect pending writes to Bob");
  assert.deepEqual((await (await api.fetcher("/api/account-data?userId=bob")).json()).entries, []);
  assert.equal((await api.fetcher("/api/account-data?userId=alice")).status, 401);
  assert.equal((await put(api.fetcher, write({ userId: "bob" }))).status, 200);
  assert.equal(api.sqlite.prepare("select count(*) as count from account_data where user_key='alice'").get().count, 2);
});

test("requires authentication and same-origin requests and validates keys and size", async (t) => {
  const api = service(); t.after(() => api.sqlite.close());
  const anonymous = new Request("https://example.test/api/account-data", { method: "PUT", body: JSON.stringify(write()) });
  assert.equal((await api.handlers.PUT(anonymous)).status, 403);
  const crossSite = new Request("https://example.test/api/account-data", { method: "PUT", headers: { Origin: "https://evil.test" }, body: JSON.stringify(write()) });
  assert.equal((await api.handlers.PUT(crossSite)).status, 403);
  assert.equal((await put(api.fetcher, write({ key: "unauthorized.key" }))).status, 400);
  assert.equal((await put(api.fetcher, write({ value: 42 }))).status, 400);
  assert.equal((await put(api.fetcher, write({ revision: -1 }))).status, 400);
  assert.equal((await put(api.fetcher, write({ value: "x".repeat(2 * 1024 * 1024 + 1) }))).status, 413);
  api.setIdentity(null);
  assert.equal((await api.fetcher("/api/account-data")).status, 401);
  assert.equal((await put(api.fetcher, write())).status, 401);
});

test("facade loads account data, saves edits and drafts to the database, and clears on identity changes", async (t) => {
  const api = service(); t.after(() => api.sqlite.close());
  const client = createAccountStorageClient(api.fetcher);
  client.storage.setItem(watchlist, "guest");
  assert.equal(client.storage.getItem(watchlist), null);
  await client.hydrate("alice");
  client.storage.setItem(watchlist, '["AAPL"]');
  client.storage.setItem("trendsight.review-draft.v1", '{"entry":{"lesson":"draft"}}');
  assert.equal(client.getStatus().pending, 2);
  await client.flush();
  assert.equal(client.getStatus().phase, "ready");
  assert.equal(client.getStatus().pending, 0);
  const reload = createAccountStorageClient(api.fetcher);
  await reload.hydrate("alice");
  assert.equal(reload.storage.getItem(watchlist), '["AAPL"]');
  assert.equal(reload.storage.getItem("trendsight.review-draft.v1"), '{"entry":{"lesson":"draft"}}');
  api.setIdentity("bob");
  await client.hydrate("bob");
  assert.equal(client.storage.getItem(watchlist), null);
  assert.equal(client.storage.getItem("trendsight.review-draft.v1"), null);
  client.clear();
  assert.equal(client.getStatus().userId, null);
});

test("facade retains and exports failed saves, retries lost responses before saving newer edits", async (t) => {
  const api = service(); t.after(() => api.sqlite.close());
  let fail = true;
  let release;
  const client = createAccountStorageClient(async (url, init) => {
    const response = await api.fetcher(url, init);
    if (init?.method === "PUT" && fail) { fail = false; await new Promise((resolve) => { release = resolve; }); throw new Error("network lost"); }
    return response;
  });
  await client.hydrate("alice");
  client.storage.setItem(watchlist, "first");
  const saving = client.flush();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  client.storage.setItem(watchlist, "newer");
  release();
  await assert.rejects(saving, /network lost/);
  assert.equal(client.getStatus().phase, "error");
  assert.equal(client.getStatus().pending, 1);
  assert.equal(JSON.parse(client.exportPending()).entries[0].value, "newer");
  await client.flush();
  const reload = createAccountStorageClient(api.fetcher); await reload.hydrate("alice");
  assert.equal(reload.storage.getItem(watchlist), "newer");
  assert.equal(client.getStatus().pending, 0);
});

test("two tabs cannot silently overwrite a personal data key", async (t) => {
  const api = service(); t.after(() => api.sqlite.close());
  const a = createAccountStorageClient(api.fetcher); const b = createAccountStorageClient(api.fetcher);
  await a.hydrate("alice"); await b.hydrate("alice");
  a.storage.setItem(watchlist, "a"); await a.flush();
  b.storage.setItem(watchlist, "b"); await assert.rejects(b.flush(), /其他窗口/);
  assert.equal(b.storage.getItem(watchlist), "b", "unsaved edits remain available for backup");
  assert.equal(b.getStatus().pending, 1);
  const reload = createAccountStorageClient(api.fetcher); await reload.hydrate("alice");
  assert.equal(reload.storage.getItem(watchlist), "a");
});

test("a stale hydration response cannot expose a previous account's data", async () => {
  let release;
  const client = createAccountStorageClient(async () => new Promise((resolve) => { release = resolve; }));
  const loading = client.hydrate("alice");
  client.clear();
  release(Response.json({ userId: "alice", entries: [{ key: watchlist, value: "private", revision: 1, mutationId: "previous" }] }));
  await loading;
  assert.equal(client.storage.getItem(watchlist), null);
  assert.equal(client.getStatus().userId, null);
});


test("a synchronous transport failure does not prevent an explicit retry", async (t) => {
  const api = service(); t.after(() => api.sqlite.close());
  let failed = false;
  const client = createAccountStorageClient((path, init) => {
    if (init?.method === "PUT" && !failed) { failed = true; throw new Error("transport unavailable"); }
    return api.fetcher(path, init);
  });
  await client.hydrate("alice");
  client.storage.setItem(watchlist, "recovered");
  await assert.rejects(client.flush(), /transport unavailable/);
  await client.flush();
  assert.equal(client.getStatus().phase, "ready");
  assert.equal(client.getStatus().pending, 0);
});
