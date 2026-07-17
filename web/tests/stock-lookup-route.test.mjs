import assert from "node:assert/strict";
import test from "node:test";

import { GET, POST } from "../app/api/local-stock-lookup/route.ts";

test("production stock lookup route resolves a stock name", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    QuotationCodeTable: {
      Data: [
        { Code: "000001", Name: "平安银行", Classify: "AStock", QuoteID: "0.000001" },
      ],
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const response = await POST(new Request("http://localhost/api/local-stock-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "平安银行" }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { code: "000001", name: "平安银行" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production stock lookup route rejects unsupported methods", async () => {
  const response = GET();
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "仅支持 POST 请求" });
});
