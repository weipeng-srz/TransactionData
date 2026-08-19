import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createResearchStateHandlers } from "../app/api/research-state/route.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationDirectory = resolve(projectRoot, "drizzle");

function dependencies(overrides = {}) {
  return {
    identifyUser: async () => "test-user",
    now: () => "2026-08-18T12:00:00.000Z",
    logServiceError: () => {},
    ...overrides,
  };
}

function request(body, method = "PUT") {
  return new Request("http://localhost/api/research-state", {
    method,
    headers: { "Content-Type": "application/json" },
    body,
  });
}

test("returns stable service errors without leaking database query details", async () => {
  const rawError = new Error("Failed query: select * from research_states params: secret-user-key");
  const logged = [];
  const handlers = createResearchStateHandlers(dependencies({
    getDatabase: async () => { throw rawError; },
    logServiceError: (operation, reason) => logged.push({ operation, reason }),
  }));

  const getResponse = await handlers.GET(request(undefined, "GET"));
  const putResponse = await handlers.PUT(request(JSON.stringify({ state: { version: 4 } })));

  for (const response of [getResponse, putResponse]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.text();
    assert.match(body, /RESEARCH_STATE_UNAVAILABLE/);
    assert.doesNotMatch(body, /select|params|secret-user-key/i);
  }
  assert.deepEqual(logged.map((entry) => entry.operation), ["read", "write"]);
  assert.ok(logged.every((entry) => entry.reason === rawError));
});

test("distinguishes malformed input, oversized payloads, and missing identity", async () => {
  let databaseCalls = 0;
  const handlers = createResearchStateHandlers(dependencies({
    getDatabase: async () => { databaseCalls += 1; throw new Error("must not be called"); },
  }));

  const invalidJson = await handlers.PUT(request("{"));
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await invalidJson.json(), { error: "请求体必须是有效的 JSON", code: "INVALID_RESEARCH_STATE" });

  const invalidState = await handlers.PUT(request(JSON.stringify({ state: null })));
  assert.equal(invalidState.status, 400);
  assert.deepEqual(await invalidState.json(), { error: "研究状态格式无效", code: "INVALID_RESEARCH_STATE" });

  const oversized = await handlers.PUT(request("x".repeat(97 * 1024)));
  assert.equal(oversized.status, 413);

  const anonymous = createResearchStateHandlers(dependencies({ identifyUser: async () => null }));
  const unauthorized = await anonymous.GET(request(undefined, "GET"));
  assert.equal(unauthorized.status, 401);
  assert.equal(databaseCalls, 0);
});

test("reads and writes research state through injected database clients", async () => {
  const inserted = [];
  const readDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{
            payload: JSON.stringify({ version: 3, holdings: { "600519": {} }, viewMode: "basic" }),
            updatedAt: "2026-08-17T00:00:00.000Z",
          }],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
  const writeDb = {
    insert: () => ({
      values: (value) => ({
        onConflictDoUpdate: async () => { inserted.push(value); },
      }),
    }),
  };

  const reader = createResearchStateHandlers(dependencies({ getDatabase: async () => readDb }));
  const getResponse = await reader.GET(request(undefined, "GET"));
  assert.equal(getResponse.status, 200);
  assert.deepEqual(await getResponse.json(), {
    state: { version: 4, viewMode: "basic" },
    updatedAt: "2026-08-17T00:00:00.000Z",
  });

  const writer = createResearchStateHandlers(dependencies({ getDatabase: async () => writeDb }));
  const putResponse = await writer.PUT(request(JSON.stringify({
    state: { version: 4, holdings: { AAPL: {} }, viewMode: "pro", benchmarkCode: "000300" },
  })));
  assert.equal(putResponse.status, 200);
  assert.deepEqual(await putResponse.json(), {
    state: { version: 4, viewMode: "pro", benchmarkCode: "000300" },
    updatedAt: "2026-08-18T12:00:00.000Z",
  });
  assert.equal(inserted.length, 1);
  assert.doesNotMatch(inserted[0].payload, /holdings|AAPL/);
});

test("persists supported US benchmark symbols in normalized form", async () => {
  const inserted = [];
  const database = {
    insert: () => ({
      values: (value) => ({ onConflictDoUpdate: async () => { inserted.push(value); } }),
    }),
  };
  const handlers = createResearchStateHandlers(dependencies({ getDatabase: async () => database }));

  for (const [input, expected] of [["SPY", "SPY"], ["qqq", "QQQ"], ["US:DIA", "DIA"]]) {
    const response = await handlers.PUT(request(JSON.stringify({ state: { version: 4, benchmarkCode: input } })));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state.benchmarkCode, expected);
  }
  assert.deepEqual(inserted.map((entry) => JSON.parse(entry.payload).benchmarkCode), ["SPY", "QQQ", "DIA"]);
});

test("migration set initializes a fresh D1-compatible SQLite database idempotently", () => {
  const database = new DatabaseSync(":memory:");
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      applyPendingMigrations(database);
    }

    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    assert.ok(tables.includes("research_states"));
    assert.ok(tables.includes("telemetry_daily"));
    assert.ok(!tables.includes("price_alerts"));
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM d1_migrations").get().count, 3);
  } finally {
    database.close();
  }
});

test("migration set reconciles a legacy local database without a migration journal", () => {
  const database = new DatabaseSync(":memory:");
  try {
    const initialMigration = readFileSync(resolve(migrationDirectory, "0000_nebulous_morg.sql"), "utf8").replaceAll("--> statement-breakpoint", "\n");
    database.exec(initialMigration);
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'price_alerts'").get());

    applyPendingMigrations(database);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    assert.ok(tables.includes("research_states"));
    assert.ok(tables.includes("telemetry_daily"));
    assert.ok(!tables.includes("price_alerts"));
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM d1_migrations").get().count, 3);
  } finally {
    database.close();
  }
});

test("development startup applies local migrations before launching vinext", () => {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
  const migrationScript = readFileSync(resolve(projectRoot, "scripts/migrate-local-d1.mjs"), "utf8");
  const localConfig = readFileSync(resolve(projectRoot, "wrangler.local.jsonc"), "utf8");

  assert.match(packageJson.scripts.dev, /^pnpm run db:migrate:local && /);
  assert.equal(packageJson.scripts["db:migrate:local"], "node scripts/migrate-local-d1.mjs");
  assert.match(migrationScript, /d1[\s\S]*migrations[\s\S]*apply[\s\S]*--local/);
  assert.match(migrationScript, /\.wrangler\/state/);
  assert.match(localConfig, /"migrations_dir": "drizzle"/);
  assert.match(localConfig, /"database_id": "00000000-0000-4000-8000-000000000000"/);
});

function applyPendingMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const applied = new Set(database.prepare("SELECT name FROM d1_migrations").all().map((row) => row.name));
  const migrationNames = readdirSync(migrationDirectory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();

  for (const name of migrationNames) {
    if (applied.has(name)) continue;
    const sql = readFileSync(resolve(migrationDirectory, name), "utf8").replaceAll("--> statement-breakpoint", "\n");
    database.exec("BEGIN");
    try {
      database.exec(sql);
      database.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
      database.exec("COMMIT");
    } catch (reason) {
      database.exec("ROLLBACK");
      throw reason;
    }
  }
}
