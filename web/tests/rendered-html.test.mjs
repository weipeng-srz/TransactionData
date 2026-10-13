import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server renders the account loading boundary without private portfolio contents", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>TrendSight · 市场研究工作台<\/title>/);
  assert.match(html, /appearance-bootstrap/);
  assert.match(html, /正在打开你的工作台/);
  assert.doesNotMatch(html, /<h[12][^>]*>我的自选/);
});

test("protected pages redirect unauthenticated direct and nested requests to login", async () => {
  for (const path of ["/global-markets", "/screener", "/review", "/account"]) {
    const response = await render(path);
    assert.equal(response.status, 307, path);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("next"), path);
  }
});

test("protected APIs reject guests before loading research or personal data", async () => {
  for (const path of ["/api/account-data", "/api/research-state", "/api/screener", "/api/global-indexes"]) {
    const response = await render(path);
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).code, "AUTH_REQUIRED");
  }
});
