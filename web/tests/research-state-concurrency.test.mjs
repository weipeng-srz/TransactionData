import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";

import { createResearchStateHandlers } from "../app/api/research-state/route.ts";

function createTestDatabase(beforeQuery = async () => {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE research_states (user_key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)");
  const db = drizzle(async (query, params, method) => {
    await beforeQuery(query, params);
    const statement = sqlite.prepare(query);
    statement.setReturnArrays(true);
    if (method === "run") {
      statement.run(...params);
      return { rows: [] };
    }
    if (method === "get") return { rows: statement.get(...params) };
    return { rows: statement.all(...params) };
  });
  return { sqlite, db };
}

function handlersFor(db) {
  return createResearchStateHandlers({
    getDatabase: async () => db,
    identifyUser: async () => "test-user",
    now: () => "2026-08-18T12:00:00.000Z",
    logServiceError: () => {},
  });
}

test("removes legacy holdings from storage without changing other users or save times", async (t) => {
  const { sqlite, db } = createTestDatabase();
  t.after(() => sqlite.close());
  const payload = JSON.stringify({ version: 3, holdings: { "600519": {} }, viewMode: "basic" });
  sqlite.prepare("INSERT INTO research_states VALUES (?, ?, ?)").run("test-user", payload, "old-time");
  sqlite.prepare("INSERT INTO research_states VALUES (?, ?, ?)").run("other-user", payload, "other-time");

  const response = await handlersFor(db).GET(new Request("http://localhost/api/research-state"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: { version: 4, viewMode: "basic" }, updatedAt: "old-time" });
  const stored = sqlite.prepare("SELECT payload, updated_at FROM research_states WHERE user_key = ?").get("test-user");
  assert.deepEqual(JSON.parse(stored.payload), { version: 4, viewMode: "basic" });
  assert.equal(stored.updated_at, "old-time");
  assert.equal(sqlite.prepare("SELECT payload FROM research_states WHERE user_key = ?").get("other-user").payload, payload);
});

test("a legacy cleanup cannot overwrite a PUT completed after the initial GET read", { timeout: 3000 }, async (t) => {
  let notifyCleanup;
  const cleanupStarted = new Promise((resolve) => { notifyCleanup = resolve; });
  let releaseCleanup;
  const cleanupGate = new Promise((resolve) => { releaseCleanup = resolve; });
  const { sqlite, db } = createTestDatabase(async (query) => {
    if (query.startsWith('update "research_states"')) {
      notifyCleanup();
      await cleanupGate;
    }
  });
  t.after(() => sqlite.close());
  sqlite.prepare("INSERT INTO research_states VALUES (?, ?, ?)").run(
    "test-user", JSON.stringify({ version: 3, holdings: { "600519": {} }, viewMode: "basic" }), "old-time",
  );
  const handlers = handlersFor(db);
  const pendingGet = handlers.GET(new Request("http://localhost/api/research-state"));
  await cleanupStarted;
  const newState = { version: 4, annotations: [{ id: "new-annotation" }], viewMode: "pro", benchmarkCode: "SPY" };
  const putResponse = await handlers.PUT(new Request("http://localhost/api/research-state", {
    method: "PUT", body: JSON.stringify({ state: newState }),
  }));
  assert.equal(putResponse.status, 200);
  releaseCleanup();

  const getResponse = await pendingGet;
  assert.equal(getResponse.status, 200);
  assert.deepEqual(await getResponse.json(), { state: newState, updatedAt: "2026-08-18T12:00:00.000Z" });
  const stored = sqlite.prepare("SELECT payload, updated_at FROM research_states WHERE user_key = ?").get("test-user");
  assert.deepEqual(JSON.parse(stored.payload), newState);
  assert.equal(stored.updated_at, "2026-08-18T12:00:00.000Z");
});
