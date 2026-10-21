import assert from "node:assert/strict";
import { test } from "node:test";
import { passwordValidationMessage, safeAuthReturnPath } from "../app/lib/authClient.ts";

test("login return path preserves internal routes and stock selections", () => {
  assert.equal(safeAuthReturnPath("/account"), "/account");
  assert.equal(safeAuthReturnPath("/?stock=US%3AAAPL#research"), "/?stock=US%3AAAPL#research");
  assert.equal(safeAuthReturnPath("/review?date=2026-10-13"), "/review?date=2026-10-13");
});

test("login return path rejects external URLs, normalization escapes and auth loops", () => {
  for (const input of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "/%5cevil.example", "/%2fevil.example", "/work/..//evil.example", "/\nevil.example", "/%00evil.example", "/login", "/login?next=/account", "/register", "/register/next", "/%6cogin", "/%invalid"]) {
    assert.equal(safeAuthReturnPath(input), "/", `unsafe path: ${input}`);
  }
});

test("registration and password-change checks match server minimum requirements", () => {
  assert.ok(passwordValidationMessage("abc123"));
  assert.ok(passwordValidationMessage("abcdefgh"));
  assert.ok(passwordValidationMessage("12345678"));
  assert.ok(passwordValidationMessage("a".repeat(128) + "1"));
  assert.equal(passwordValidationMessage("research8"), null);
  assert.equal(passwordValidationMessage("a".repeat(127) + "1"), null);
});
