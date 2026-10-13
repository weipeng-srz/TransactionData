import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createAuthHandlers, hashPassword, verifyPassword } from "../app/lib/authServer.ts";
import { resolveUserKey } from "../app/lib/serverIdentity.ts";

const initialTime = Date.parse("2026-10-13T08:00:00.000Z");
const credentials = { email: "alice@example.com", displayName: "Alice", password: "Password123!" };
function fixture(t, beforeQuery = async () => {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../drizzle/0003_auth.sql", import.meta.url), "utf8"));
  let now = initialTime;
  const db = drizzle(async (query, params, method) => {
    await beforeQuery(query, params);
    const statement = sqlite.prepare(query);
    statement.setReturnArrays(true);
    if (method === "run") { statement.run(...params); return { rows: [] }; }
    if (method === "get") return { rows: statement.get(...params) };
    return { rows: statement.all(...params) };
  });
  const handlers = createAuthHandlers({ getDatabase: async () => db, now: () => now, logServiceError: (error) => { throw error; } });
  t.after(() => sqlite.close());
  return { handlers, sqlite, advance: (ms) => { now += ms; } };
}
function request(path, body, cookie, origin = "https://stocks.example.com") {
  return new Request(`https://stocks.example.com/api/auth/${path}`, {
    method: path === "me" ? "GET" : path === "profile" ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json", ...(origin === null ? {} : { Origin: origin }), ...(cookie ? { Cookie: cookie } : {}) },
    ...(path === "me" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
}
const getCookie = (response) => response.headers.get("set-cookie")?.split(";")[0];
async function register(handlers, input = credentials) {
  const response = await handlers.register(request("register", input));
  assert.equal(response.status, 201);
  return { cookie: getCookie(response), body: await response.json(), response };
}

test("registration persists a salted password hash and opaque hashed session, never credentials in response", async (t) => {
  const { handlers, sqlite } = fixture(t);
  const { response, body, cookie } = await register(handlers, { ...credentials, email: " ALICE@EXAMPLE.COM " });
  assert.equal(body.user.email, credentials.email);
  assert.equal(body.user.displayName, "Alice");
  assert.deepEqual(Object.keys(body.user).sort(), ["bio", "createdAt", "displayName", "email", "id", "updatedAt"]);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const stored = sqlite.prepare("SELECT * FROM users").get();
  assert.match(stored.password_hash, /^scrypt\$16384\$8\$5\$/);
  assert.notEqual(stored.password_hash, credentials.password);
  assert.equal(await verifyPassword(credentials.password, stored.password_hash), true);
  const session = sqlite.prepare("SELECT * FROM auth_sessions").get();
  assert.notEqual(session.token_hash, cookie.split("=")[1]);
  assert.equal(session.user_id, body.user.id);
  assert.equal((await (await handlers.me(request("me", undefined, cookie))).json()).user.id, body.user.id);
});

test("same-password accounts get independent salts and malformed hashes fail closed", async () => {
  const a = await hashPassword(credentials.password);
  const b = await hashPassword(credentials.password);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("wrong", a), false);
  assert.equal(await verifyPassword(credentials.password, "broken"), false);
});

test("duplicate normalized emails and weak credentials are rejected", async (t) => {
  const { handlers } = fixture(t);
  await register(handlers);
  assert.equal((await handlers.register(request("register", { ...credentials, email: "ALICE@example.com" }))).status, 409);
  for (const input of [{ password: "12345678" }, { password: "abcdefgh" }, { displayName: " " }, { email: "bad-email" }]) {
    assert.equal((await handlers.register(request("register", { ...credentials, ...input }))).status, 400);
  }
});

test("wrong login is generic, valid login survives a fresh handler and logout revokes only its session", async (t) => {
  const { handlers, sqlite } = fixture(t);
  const first = await register(handlers);
  const failed = await handlers.login(request("login", { ...credentials, password: "Wrong1234" }));
  assert.equal(failed.status, 401);
  assert.equal((await failed.json()).code, "INVALID_CREDENTIALS");
  const login = await handlers.login(request("login", credentials));
  assert.equal(login.status, 200);
  const secondCookie = getCookie(login);
  assert.notEqual(secondCookie, first.cookie);
  const logout = await handlers.logout(request("logout", {}, secondCookie));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await (await handlers.me(request("me", undefined, secondCookie))).json()).user, null);
  assert.equal((await (await handlers.me(request("me", undefined, first.cookie))).json()).user.id, first.body.user.id);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM auth_sessions").get().total, 1);
});

test("anonymous access cannot be forged with old user headers, localhost, random or expired cookies", async (t) => {
  const { handlers, advance } = fixture(t);
  assert.equal(await resolveUserKey(new Request("http://localhost/api/research-state", { headers: { "oai-authenticated-user-email": credentials.email } })), null);
  for (const cookie of [undefined, "ts_session=local-preview", `ts_session=${"a".repeat(64)}`]) {
    assert.deepEqual(await (await handlers.me(request("me", undefined, cookie))).json(), { user: null });
    assert.equal((await handlers.profile(request("profile", { displayName: "Attack" }, cookie))).status, 401);
  }
  const account = await register(handlers);
  advance(30 * 24 * 60 * 60 * 1000 + 1);
  assert.deepEqual(await (await handlers.me(request("me", undefined, account.cookie))).json(), { user: null });
});

test("profile changes are scoped to the session and changing email requires password", async (t) => {
  const { handlers, sqlite } = fixture(t);
  const alice = await register(handlers);
  const bob = await register(handlers, { ...credentials, email: "bob@example.com", displayName: "Bob" });
  const profile = await handlers.profile(request("profile", { displayName: " Alice New ", bio: " Hello ", userId: alice.body.user.id }, alice.cookie));
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).user.bio, "Hello");
  assert.equal(sqlite.prepare("SELECT display_name FROM users WHERE id = ?").get(bob.body.user.id).display_name, "Bob");
  assert.equal((await handlers.profile(request("profile", { userId: alice.body.user.id, email: "new@example.com" }, alice.cookie))).status, 400);
  assert.equal((await handlers.profile(request("profile", { userId: alice.body.user.id, email: "new@example.com", currentPassword: "Wrong123" }, alice.cookie))).status, 400);
  assert.equal((await handlers.profile(request("profile", { userId: alice.body.user.id, email: "bob@example.com", currentPassword: credentials.password }, alice.cookie))).status, 409);
  const changed = await handlers.profile(request("profile", { userId: alice.body.user.id, email: "new@example.com", currentPassword: credentials.password }, alice.cookie));
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).user.email, "new@example.com");
  assert.equal((await handlers.login(request("login", credentials))).status, 401);
  assert.equal((await handlers.login(request("login", { ...credentials, email: "new@example.com" }))).status, 200);
});

test("password change invalidates all old sessions, leaves other accounts intact, and permits new password only", async (t) => {
  const { handlers } = fixture(t);
  const alice = await register(handlers);
  const bob = await register(handlers, { ...credentials, email: "bob@example.com" });
  const secondCookie = getCookie(await handlers.login(request("login", credentials)));
  const changed = await handlers.password(request("password", { userId: alice.body.user.id, currentPassword: credentials.password, newPassword: "Changed123!" }, alice.cookie));
  assert.equal(changed.status, 200);
  for (const oldCookie of [alice.cookie, secondCookie]) assert.equal((await (await handlers.me(request("me", undefined, oldCookie))).json()).user, null);
  assert.ok((await (await handlers.me(request("me", undefined, getCookie(changed)))).json()).user);
  assert.ok((await (await handlers.me(request("me", undefined, bob.cookie))).json()).user);
  assert.equal((await handlers.login(request("login", credentials))).status, 401);
  assert.equal((await handlers.login(request("login", { ...credentials, password: "Changed123!" }))).status, 200);
});

test("cross-origin and missing-origin mutations are rejected before touching storage", async () => {
  const handlers = createAuthHandlers({ getDatabase: async () => { throw new Error("must not access DB"); } });
  for (const action of ["register", "login", "logout", "profile", "password"]) {
    for (const origin of ["https://evil.example", "null", null]) assert.equal((await handlers[action](request(action, credentials, undefined, origin))).status, 403);
  }
});

test("login throttles repeated attempts in database and recovers after the window", async (t) => {
  const { handlers, sqlite, advance } = fixture(t);
  await register(handlers);
  for (let i = 0; i < 10; i++) assert.equal((await handlers.login(request("login", { ...credentials, password: "Wrong123" }))).status, 401);
  assert.equal((await handlers.login(request("login", credentials))).status, 429);
  assert.ok(sqlite.prepare("SELECT count FROM auth_rate_limits WHERE count > 10").get());
  advance(15 * 60 * 1000);
  assert.equal((await handlers.login(request("login", credentials))).status, 200);
});

test("database outage produces a safe service error", async () => {
  const handlers = createAuthHandlers({ getDatabase: async () => { throw new Error("DB private binding details"); }, logServiceError: () => {} });
  const response = await handlers.login(request("login", credentials));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "账户服务暂不可用，请稍后重试", code: "AUTH_UNAVAILABLE" });
});

test("guest identity remains available without a database", async () => {
  const handlers = createAuthHandlers({ getDatabase: async () => { throw new Error("must not access DB for guests"); } });
  for (const cookie of [undefined, "ts_session=invalid"]) {
    const response = await handlers.me(request("me", undefined, cookie));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user: null });
  }
});

test("an in-flight login cannot restore a session invalidated by a password change", async (t) => {
  let pauseLogin = false;
  let notifyLogin;
  const loginStarted = new Promise((resolve) => { notifyLogin = resolve; });
  let releaseLogin;
  const gate = new Promise((resolve) => { releaseLogin = resolve; });
  const { handlers } = fixture(t, async (query, params) => {
    if (pauseLogin && query.startsWith('insert into "auth_sessions"') && params[2] === 1) {
      pauseLogin = false;
      notifyLogin();
      await gate;
    }
  });
  const account = await register(handlers);
  pauseLogin = true;
  const pendingLogin = handlers.login(request("login", credentials));
  await loginStarted;
  const changed = await handlers.password(request("password", { userId: account.body.user.id, currentPassword: credentials.password, newPassword: "Changed123!" }, account.cookie));
  assert.equal(changed.status, 200);
  releaseLogin();
  const staleLogin = await pendingLogin;
  assert.equal((await (await handlers.me(request("me", undefined, getCookie(staleLogin)))).json()).user, null);
  assert.equal((await (await handlers.me(request("me", undefined, getCookie(changed)))).json()).user.id, account.body.user.id);
});

test("stale tabs cannot change another account's profile or password after a cookie switch", async (t) => {
  const { handlers, sqlite } = fixture(t);
  const alice = await register(handlers);
  const bob = await register(handlers, { ...credentials, email: "bob@example.com", displayName: "Bob" });
  for (const userId of [undefined, alice.body.user.id]) {
    const profile = await handlers.profile(request("profile", { userId, displayName: "Stale Alice", bio: "Alice notes" }, bob.cookie));
    assert.equal(profile.status, 401);
    assert.equal((await profile.json()).code, "ACCOUNT_CHANGED");
    const password = await handlers.password(request("password", { userId, currentPassword: credentials.password, newPassword: "Changed123!" }, bob.cookie));
    assert.equal(password.status, 401);
    assert.equal((await password.json()).code, "ACCOUNT_CHANGED");
  }
  const stored = sqlite.prepare("SELECT display_name, bio, password_hash, session_version FROM users WHERE id = ?").get(bob.body.user.id);
  assert.equal(stored.display_name, "Bob");
  assert.equal(stored.bio, "");
  assert.equal(stored.session_version, 1);
  assert.equal(await verifyPassword(credentials.password, stored.password_hash), true);
});
