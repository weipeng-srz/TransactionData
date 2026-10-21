import assert from "node:assert/strict";
import test from "node:test";
import { requiresAccount, loginRedirect } from "../app/lib/accessPolicy.ts";

test("guest access is limited to stock queries and authentication", () => {
  for (const path of ["/", "/login", "/register", "/api/auth/me", "/api/auth/login", "/api/local-stock-data", "/api/us-stock-lookup", "/api/us-stock-news"]) assert.equal(requiresAccount(path), false, path);
  for (const path of ["/account", "/review", "/review/", "/screener", "/global-markets", "/api/research-state", "/api/account-data", "/api/screener", "/api/global-indexes", "/api/telemetry", "/api/future-private-feature", "/api/%73creener"]) assert.equal(requiresAccount(path), true, path);
});

test("login redirect preserves the intended same-origin destination", () => {
  const redirect = loginRedirect(new URL("https://example.test/screener?market=US"));
  assert.equal(redirect.origin, "https://example.test");
  assert.equal(redirect.pathname, "/login");
  assert.equal(redirect.searchParams.get("next"), "/screener?market=US");
});
