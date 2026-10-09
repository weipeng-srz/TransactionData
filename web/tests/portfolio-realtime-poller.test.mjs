import assert from "node:assert/strict";
import test from "node:test";

import { createPortfolioRealtimePoller } from "../app/lib/portfolioRealtimePoller.ts";

const stocks = [
  { code: "000001", name: "平安银行", addedAt: "2026-10-08T00:00:00Z" },
  { code: "AAPL", name: "Apple", market: "US", currency: "USD", addedAt: "2026-10-08T00:00:00Z" },
];

function controlledFetch({ respectAbort = true } = {}) {
  const requests = [];
  return {
    requests,
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      const code = JSON.parse(options.body).code;
      const request = {
        url,
        code,
        signal: options.signal,
        resolve: (snapshot = { code, price: 12 }) => resolve({ ok: true, json: async () => snapshot }),
        reject,
      };
      if (respectAbort) options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      requests.push(request);
    }),
  };
}

function captureUpdates() {
  const quotes = [];
  const errors = [];
  return { quotes, errors, handlers: { onQuote: (stock, quote) => quotes.push({ code: stock.code, price: quote.price }), onError: (stock) => errors.push(stock.code) } };
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

test("a fast quote updates immediately and polling ticks do not cancel a slow quote", async () => {
  const fetcher = controlledFetch();
  const poller = createPortfolioRealtimePoller(fetcher);
  const updates = captureUpdates();
  const first = poller.refresh(stocks, updates.handlers);
  try {
    assert.equal(fetcher.requests[0].url, "/api/realtime-market");
    assert.equal(fetcher.requests[1].url, "/api/us-stock-realtime");
    fetcher.requests[0].resolve();
    await flushPromises();
    assert.deepEqual(updates.quotes, [{ code: "000001", price: 12 }]);

    await poller.refresh(stocks, updates.handlers);
    await poller.refresh(stocks, updates.handlers);
    assert.equal(fetcher.requests.length, 2);
    assert.equal(fetcher.requests[1].signal.aborted, false);

    fetcher.requests[1].resolve({ code: "AAPL", price: 200 });
    await first;
    assert.deepEqual(updates.quotes, [{ code: "000001", price: 12 }, { code: "AAPL", price: 200 }]);
    assert.deepEqual(updates.errors, []);

    const next = poller.refresh([stocks[0]], updates.handlers);
    assert.equal(fetcher.requests.length, 3);
    fetcher.requests[2].resolve({ code: "000001", price: 13 });
    await next;
    assert.deepEqual(updates.quotes.at(-1), { code: "000001", price: 13 });
  } finally {
    poller.abort();
    await first;
  }
});

test("a stock timeout preserves successful quotes and permits the next polling round", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fetcher = controlledFetch();
  const poller = createPortfolioRealtimePoller({ ...fetcher, timeoutMs: 25_000 });
  const updates = captureUpdates();
  const first = poller.refresh(stocks, updates.handlers);
  fetcher.requests[0].resolve();
  await flushPromises();

  context.mock.timers.tick(5_000);
  await poller.refresh(stocks, updates.handlers);
  assert.equal(fetcher.requests[1].signal.aborted, false);
  assert.equal(fetcher.requests.length, 2);
  context.mock.timers.tick(20_000);
  await first;
  assert.deepEqual(updates.quotes, [{ code: "000001", price: 12 }]);
  assert.deepEqual(updates.errors, ["AAPL"]);
  assert.equal(fetcher.requests[1].signal.aborted, true);

  const next = poller.refresh([stocks[1]], updates.handlers);
  fetcher.requests[2].resolve({ code: "AAPL", price: 201 });
  await next;
  assert.deepEqual(updates.quotes.at(-1), { code: "AAPL", price: 201 });
});

test("unmount cancellation suppresses late updates and cannot clear a newer active round", async () => {
  const fetcher = controlledFetch({ respectAbort: false });
  const poller = createPortfolioRealtimePoller(fetcher);
  const updates = captureUpdates();
  const oldRound = poller.refresh([stocks[0]], updates.handlers);
  poller.abort();
  assert.equal(fetcher.requests[0].signal.aborted, true);

  const newRound = poller.refresh([stocks[1]], updates.handlers);
  fetcher.requests[0].resolve();
  await oldRound;
  assert.deepEqual(updates.quotes, []);
  assert.deepEqual(updates.errors, []);
  await poller.refresh([stocks[1]], updates.handlers);
  assert.equal(fetcher.requests.length, 2);

  fetcher.requests[1].resolve({ code: "AAPL", price: 202 });
  await newRound;
  assert.deepEqual(updates.quotes, [{ code: "AAPL", price: 202 }]);
});

test("a failed or mismatched stock response does not suppress other quotes", async () => {
  const fetcher = controlledFetch();
  const poller = createPortfolioRealtimePoller(fetcher);
  const updates = captureUpdates();
  const first = poller.refresh(stocks, updates.handlers);
  fetcher.requests[0].reject(new Error("upstream unavailable"));
  fetcher.requests[1].resolve({ code: "AAPL", price: 203 });
  await first;
  assert.deepEqual(updates.errors, ["000001"]);
  assert.deepEqual(updates.quotes, [{ code: "AAPL", price: 203 }]);

  const next = poller.refresh([stocks[0]], updates.handlers);
  fetcher.requests[2].resolve({ code: "600519", price: 1500 });
  await next;
  assert.deepEqual(updates.errors, ["000001", "000001"]);
  assert.equal(updates.quotes.length, 1);
});
