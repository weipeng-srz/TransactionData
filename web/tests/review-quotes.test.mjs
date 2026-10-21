import assert from "node:assert/strict";
import test from "node:test";
import { loadReviewQuotes, reviewQuoteFromResponse, uniqueReviewQuoteEntries } from "../app/features/review/useReviewQuotes.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const cn = { market: "CN", code: "600000" };
const us = { market: "US", code: "AAPL" };
const snapshot = (code, price = 10) => ({ code, price, date: "2026-10-12", time: "15:00:00" });

function controlledFetch() {
  const requests = [];
  const fetchImpl = (url, options) => new Promise((resolve, reject) => {
    requests.push({ url, options, reject, resolve: (body = snapshot(JSON.parse(options.body).code)) => resolve({ ok: true, json: async () => body }) });
  });
  return { requests, fetchImpl };
}

test("quote entries deduplicate by market and normalize symbols without losing CN leading zeroes", () => {
  assert.deepEqual(uniqueReviewQuoteEntries([cn, cn, { market: "CN", code: "sz000001" }, us, { market: "US", code: "us:aapl" }, { market: "US", code: "" }]), [
    { market: "CN", code: "000001" }, cn, us,
  ]);
});

test("quote timestamps preserve provider semantics and never replace a missing quote time with now", () => {
  assert.equal(reviewQuoteFromResponse(cn, snapshot(cn.code)).updatedAt, "2026-10-12 15:00:00 北京时间");
  assert.equal(reviewQuoteFromResponse(cn, snapshot(cn.code)).asOfDate, "2026-10-12");
  assert.equal(reviewQuoteFromResponse(cn, { code: cn.code, price: 10 }).updatedAt, "行情时间未提供");
  assert.equal(reviewQuoteFromResponse(cn, { code: cn.code, price: 10 }).asOfDate, "");
  const delayed = reviewQuoteFromResponse(us, { ...snapshot(us.code), fetchedAt: "2026-10-13T04:00:00Z", source: "新浪美股延时报价" });
  assert.match(delayed.updatedAt, /延时报价 · 获取于/);
  assert.doesNotMatch(delayed.updatedAt, /2026-10-12/);
  assert.equal(delayed.asOfDate, "2026-10-12", "use only the provider date; do not generate an as-of date from the client clock");
  assert.equal(reviewQuoteFromResponse(us, { ...snapshot(us.code), source: "新浪美股日K备用收盘价" }).updatedAt, "2026-10-12 15:00:00 美东收盘");
  assert.equal(reviewQuoteFromResponse(us, { ...snapshot(us.code), source: "新浪美股日K备用收盘价" }).asOfDate, "2026-10-12");
  assert.throws(() => reviewQuoteFromResponse(cn, snapshot("600519")), /代码不匹配/);
  for (const price of [0, -1, Infinity, NaN, "10"]) assert.throws(() => reviewQuoteFromResponse(cn, { code: cn.code, price }), /有效价格/);
});

test("quote loading limits concurrency to four, requests every unique code, and updates fast results independently", async () => {
  const fetcher = controlledFetch();
  const controller = new AbortController();
  const updates = [];
  const entries = [...Array.from({ length: 5 }, (_, index) => ({ market: "CN", code: String(600000 + index) })), us, cn];
  const pending = loadReviewQuotes(entries, { signal: controller.signal, fetchImpl: fetcher.fetchImpl, onQuote: (key, quote) => updates.push({ key, quote }) });
  assert.equal(fetcher.requests.length, 4);
  assert.equal(fetcher.requests[0].url, "/api/realtime-market");
  fetcher.requests[0].resolve();
  await flush();
  assert.equal(updates.length, 1);
  assert.equal(fetcher.requests.length, 5);
  fetcher.requests[1].resolve();
  await flush();
  assert.equal(fetcher.requests.length, 6);
  assert.equal(fetcher.requests[5].url, "/api/us-stock-realtime");
  for (const request of fetcher.requests.slice(2)) request.resolve();
  assert.deepEqual(await pending, []);
  assert.equal(updates.length, 6);
});

test("aborted batches stop the queue and suppress late results even when a fetch ignores cancellation", async () => {
  const fetcher = controlledFetch();
  const controller = new AbortController();
  const updates = [];
  const entries = Array.from({ length: 5 }, (_, index) => ({ market: "CN", code: String(600000 + index) }));
  const pending = loadReviewQuotes(entries, { signal: controller.signal, fetchImpl: fetcher.fetchImpl, onQuote: (...values) => updates.push(values) });
  controller.abort();
  assert.deepEqual(await pending, []);
  for (const request of fetcher.requests) {
    assert.equal(request.options.signal.aborted, true);
    request.resolve();
  }
  await flush();
  assert.equal(fetcher.requests.length, 4);
  assert.deepEqual(updates, []);
});

test("timeouts and invalid responses do not prevent other symbols from updating", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fetcher = controlledFetch();
  const controller = new AbortController();
  const updates = [];
  const pending = loadReviewQuotes([cn, us, { market: "CN", code: "600001" }], {
    signal: controller.signal, fetchImpl: fetcher.fetchImpl, timeoutMs: 25_000,
    onQuote: (key) => updates.push(key),
  });
  fetcher.requests[0].resolve(snapshot("600519"));
  fetcher.requests[2].resolve(snapshot("AAPL", 200));
  await flush();
  context.mock.timers.tick(25_000);
  assert.deepEqual((await pending).sort(), ["CN:600000", "CN:600001"]);
  assert.deepEqual(updates, ["US:AAPL"]);
  assert.equal(fetcher.requests[1].options.signal.aborted, true);
});
