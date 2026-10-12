import assert from "node:assert/strict";
import test from "node:test";
import {
  earningsCalendar, earningsDayReturn, earningsMarketDate,
  parseEarningsHistory, recordPortfolioEarnings, summarizeEarnings,
} from "../app/lib/portfolioEarnings.ts";

const now = new Date("2026-10-09T07:00:00Z");
const empty = () => ({ version: 1, days: [] });
const holding = (overrides = {}) => ({ code: "000001", shares: 100, cost: 8, updatedAt: "2026-09-28T02:00:00Z", ...overrides });
const quote = (overrides = {}) => ({ status: "ready", partial: false, price: 12, previousClose: 10, date: "2026-10-09", time: "15:00:00", ...overrides });
const positions = () => ({ "000001": holding() });
const quotes = () => ({ "000001": quote() });

test("daily estimate uses yesterday's value, not cost profit or market value", () => {
  const history = recordPortfolioEarnings(empty(), positions(), quotes(), now);
  assert.equal(history.days.length, 1);
  assert.equal(history.days[0].profit, 200);
  assert.equal(history.days[0].openingValue, 1000);
  assert.equal(earningsDayReturn(history.days[0]), 20);
  assert.equal(history.days[0].status, "estimated");
});

test("refreshes replace a day and idempotent observations preserve the same history object", () => {
  const first = recordPortfolioEarnings(empty(), positions(), quotes(), now);
  assert.equal(recordPortfolioEarnings(first, positions(), quotes(), new Date("2026-10-09T07:02:00Z")), first);
  const second = recordPortfolioEarnings(first, positions(), { "000001": quote({ price: 13 }) }, now);
  assert.equal(second.days.length, 1);
  assert.equal(summarizeEarnings(second.days, "CNY", "2026-10").profit, 300);
});

test("missing days are not backfilled and monthly totals count only observed valid days", () => {
  const first = recordPortfolioEarnings(empty(), positions(), quotes(), now);
  const second = recordPortfolioEarnings(first, positions(), { "000001": quote({ date: "2026-10-12", price: 11, previousClose: 12 }) }, new Date("2026-10-12T07:00:00Z"));
  const summary = summarizeEarnings(second.days, "CNY", "2026-10");
  assert.deepEqual(second.days.map((day) => day.date), ["2026-10-09", "2026-10-12"]);
  assert.deepEqual([summary.profit, summary.recordedDays, summary.winningDays, summary.losingDays, summary.flatDays], [100, 2, 1, 1, 0]);
  assert.equal(summarizeEarnings(second.days, "CNY", "2026-09").profit, null);
  assert.equal(summary.best.date, "2026-10-09");
  assert.equal(summary.worst.date, "2026-10-12");
});

test("a stale quote never records yesterday's return again on the next day", () => {
  const first = recordPortfolioEarnings(empty(), positions(), quotes(), now);
  assert.equal(recordPortfolioEarnings(first, positions(), quotes(), new Date("2026-10-10T07:00:00Z")), first);
});

test("mixed quote dates and partial/failing quotes make an initial observation unavailable", () => {
  const holdings = { ...positions(), "600519": holding({ code: "600519" }) };
  for (const overrides of [{ date: "2026-10-08" }, { status: "error" }, { partial: true }, { price: null }, { previousClose: 0 }]) {
    const result = recordPortfolioEarnings(empty(), holdings, { ...quotes(), "600519": quote(overrides) }, now);
    assert.equal(result.days[0].profit, null);
    assert.equal(result.days[0].status, "incomplete_quotes");
    assert.equal(summarizeEarnings(result.days, "CNY").profit, null);
  }
});

test("a complete snapshot survives transient loading and failures with its observed timestamp", () => {
  const first = recordPortfolioEarnings(empty(), positions(), quotes(), now);
  for (const overrides of [{ status: "loading" }, { status: "error" }, { partial: true }, { date: "2026-10-08" }]) {
    assert.equal(recordPortfolioEarnings(first, positions(), { "000001": quote(overrides) }, new Date("2026-10-09T08:00:00Z")), first);
  }
});

test("partial sell, changed cost, intraday acquisition and clear invalidate the whole day", () => {
  const first = recordPortfolioEarnings(empty(), positions(), quotes(), now);
  for (const updated of [
    { "000001": holding({ shares: 50, updatedAt: "2026-10-09T06:00:00Z" }) },
    { "000001": holding({ cost: 9 }) },
    { ...positions(), "600519": holding({ code: "600519", updatedAt: "2026-10-09T06:00:00Z" }) },
    {},
  ]) {
    const result = recordPortfolioEarnings(first, updated, quotes(), now);
    assert.equal(result.days[0].status, "holdings_changed");
    assert.equal(result.days[0].profit, null);
    assert.equal(summarizeEarnings(result.days, "CNY").unavailableDays, 1);
    // Reverting the editor cannot pretend the day's unknown trading process never happened.
    assert.equal(recordPortfolioEarnings(result, positions(), quotes(), now).days[0].profit, null);
  }
  const firstAcquisition = recordPortfolioEarnings(empty(), { "000001": holding({ updatedAt: "2026-10-09T00:00:00Z" }) }, quotes(), now);
  assert.equal(firstAcquisition.days[0].status, "holdings_changed");
});

test("clearing positions preserves older records and does not invent a new zero-return day", () => {
  const first = recordPortfolioEarnings(empty(), positions(), quotes(), now);
  assert.equal(recordPortfolioEarnings(first, {}, {}, new Date("2026-10-12T07:00:00Z")), first);
  assert.equal(summarizeEarnings(first.days, "CNY").profit, 200);
});

test("the next trading day resumes calculation after a previous-day holding change", () => {
  const changedPositions = { "000001": holding({ shares: 50, updatedAt: "2026-10-09T06:00:00Z" }) };
  const first = recordPortfolioEarnings(empty(), changedPositions, quotes(), now);
  const next = recordPortfolioEarnings(first, changedPositions, { "000001": quote({ date: "2026-10-12", price: 13, previousClose: 12 }) }, new Date("2026-10-12T07:00:00Z"));
  assert.equal(next.days[1].profit, 50);
  assert.equal(summarizeEarnings(next.days, "CNY").profit, 50);
});

test("CNY and USD use their own exchange date and never add currencies together", () => {
  const crossDate = new Date("2026-10-10T01:00:00Z");
  assert.equal(earningsMarketDate("CNY", crossDate), "2026-10-10");
  assert.equal(earningsMarketDate("USD", crossDate), "2026-10-09");
  const usPositions = { ...positions(), "US:AAPL": holding({ code: "AAPL", market: "US", currency: "USD", shares: 2 }) };
  const mixedQuotes = { ...quotes(), "US:AAPL": quote({ price: 210, previousClose: 200, time: "20:00:00", candles: [{ date: "2026-10-09" }] }) };
  const first = recordPortfolioEarnings(empty(), positions(), quotes(), now);
  const next = recordPortfolioEarnings(first, usPositions, mixedQuotes, crossDate);
  assert.equal(summarizeEarnings(next.days, "CNY").profit, 200);
  assert.equal(summarizeEarnings(next.days, "USD").profit, 20);
  assert.equal(next.days.find((day) => day.currency === "USD").date, "2026-10-09");
});

test("US fetch-clock dates cannot create duplicated weekend, premarket or holiday returns", () => {
  const usPositions = { "US:AAPL": holding({ code: "AAPL", market: "US", currency: "USD" }) };
  const cases = [
    { now: "2026-10-10T16:00:00Z", date: "2026-10-10", time: "12:00:00", candles: [{ date: "2026-10-09" }], marketStatus: "休市" },
    { now: "2026-10-12T12:00:00Z", date: "2026-10-12", time: "08:00:00", candles: [{ date: "2026-10-09" }], marketStatus: "盘前" },
    { now: "2026-12-25T17:00:00Z", date: "2026-12-25", time: "12:00:00", candles: [{ date: "2026-12-24" }], marketStatus: "交易中" },
  ];
  for (const item of cases) {
    const result = recordPortfolioEarnings(empty(), usPositions, { "US:AAPL": quote(item) }, new Date(item.now));
    assert.equal(result.days.length, 0);
  }
});

test("true zero returns remain known records and count as flat days", () => {
  const history = recordPortfolioEarnings(empty(), positions(), { "000001": quote({ price: 10 }) }, now);
  assert.equal(history.days[0].profit, 0);
  assert.equal(summarizeEarnings(history.days, "CNY").flatDays, 1);
  assert.equal(summarizeEarnings(history.days, "CNY").profit, 0);
});

test("persisted history roundtrips, rejects malformed/unknown records and deduplicates dates", () => {
  const history = recordPortfolioEarnings(empty(), positions(), quotes(), now);
  assert.deepEqual(parseEarningsHistory(JSON.parse(JSON.stringify(history))), history);
  const good = history.days[0];
  const malformed = [
    { ...good, date: "2026-02-31" }, { ...good, profit: "200" },
    { ...good, openingValue: 0 }, { ...good, currency: "EUR" }, { ...good, signature: 42 },
    { ...good, positions: 0 }, { ...good, priced: -1 }, { ...good, observedAt: "bad date" },
  ];
  assert.deepEqual(parseEarningsHistory({ version: 1, days: malformed }).days, []);
  assert.equal(parseEarningsHistory({ version: 1, days: [good, good] }).days.length, 1);
  assert.deepEqual(parseEarningsHistory({ version: 9, days: [good] }).days, []);
  assert.deepEqual(parseEarningsHistory(null).days, []);
});

test("calendar aligns Monday first and includes leap days without inventing data", () => {
  const calendar = earningsCalendar("2024-02");
  assert.deepEqual(calendar.slice(0, 3), [null, null, null]);
  assert.deepEqual(calendar.at(-1), { day: 29, date: "2024-02-29" });
  assert.deepEqual(earningsCalendar("2026-13"), []);
});
