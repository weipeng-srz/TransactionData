import assert from "node:assert/strict";
import test from "node:test";
import { workspaceView, workspaceViewUrl } from "../app/lib/workspaceNavigation.ts";
import { financialWorkspaceView } from "../app/lib/financialNavigation.ts";

test("financial shares serialize the effective legacy-anchor view before discarding the hash", () => {
  for (const search of ["?stock=000001#finance-income", "?stock=000001&finance=summary#finance-income"]) {
    const original = new URL(`https://example.test/${search}`);
    const shared = workspaceViewUrl(original, "finance", financialWorkspaceView(original), { tab: "financials" });
    assert.equal(shared.searchParams.get("finance"), "trends");
    assert.equal(financialWorkspaceView(shared), "trends");
    assert.equal(shared.hash, "");
  }
});

test("workspace navigation validates views and preserves every share parameter", () => {
  const original = new URL("https://example.test/?stock=US%3AAAPL&tf=1w&lower=macd&ov=ma,bb&from=2025-01-01&to=2026-01-01&mode=pro&benchmark=US%3ASPY#stock-market");
  const next = workspaceViewUrl(original, "tab", "financials");
  for (const [key, value] of original.searchParams) assert.equal(next.searchParams.get(key), value);
  assert.equal(next.searchParams.get("tab"), "financials");
  assert.equal(next.hash, "");
  assert.equal(original.hash, "#stock-market");
  assert.equal(workspaceView(next, ["overview", "financials"], "overview", "tab"), "financials");
  next.searchParams.set("tab", "invalid");
  assert.equal(workspaceView(next, ["overview", "financials"], "overview", "tab"), "overview");
});

test("legacy anchors reveal the owning view without changing the URL", () => {
  const url = new URL("https://example.test/?stock=000001#finance-cash");
  assert.equal(workspaceView(url, ["overview", "financials"], "overview", "tab", {"finance-*": "financials"}), "financials");
  assert.equal(url.searchParams.get("tab"), null);
});

test("malformed legacy hashes safely use the default view", () => {
  for (const hash of ["#%", "#%E0%A4%A"]) assert.equal(workspaceView(new URL(`https://example.test/${hash}`), ["watchlist", "holdings"], "watchlist"), "watchlist");
});

test("financial navigation canonicalizes its parent view after a legacy anchor", () => {
  const next = workspaceViewUrl(new URL("https://example.test/?stock=000001&tf=1w#finance-cash"), "finance", "details", { tab: "financials" });
  assert.equal(next.searchParams.get("tab"), "financials");
  assert.equal(next.searchParams.get("finance"), "details");
  assert.equal(next.searchParams.get("tf"), "1w");
  assert.equal(next.hash, "");
});
