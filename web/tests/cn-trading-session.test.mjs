import assert from "node:assert/strict";
import test from "node:test";
import {
  CN_CLOSING_AUCTION_START_MINUTE,
  CN_TRADING_MINUTES,
  clockMinuteOfDay,
  cnTradingAxisXRatio,
  cnTradingMinuteOffset,
  cnTradingMinutePhase,
} from "../app/lib/cnTradingSession.ts";

test("maps the two A-share sessions onto one fixed four-hour axis", () => {
  assert.equal(CN_TRADING_MINUTES, 240);
  assert.equal(cnTradingMinuteOffset("2026-08-25 09:30:00"), 0);
  assert.equal(cnTradingMinuteOffset("2026-08-25 10:30:00"), 60);
  assert.equal(cnTradingMinuteOffset("2026-08-25 11:30:00"), 120);
  assert.equal(cnTradingMinuteOffset("2026-08-25 13:00:00"), 120);
  assert.equal(cnTradingMinuteOffset("2026-08-25 14:00:00"), 180);
  assert.equal(cnTradingMinuteOffset("2026-08-25 15:00:00"), 240);
  assert.equal(cnTradingMinuteOffset("2026-08-25 12:15:00"), null);
  assert.equal(cnTradingAxisXRatio("15:00"), 1);
});

test("distinguishes the closing auction and real post-market window", () => {
  assert.equal(CN_CLOSING_AUCTION_START_MINUTE, 237);
  assert.equal(cnTradingMinutePhase("14:56"), "afternoon");
  assert.equal(cnTradingMinutePhase("14:57"), "closing-auction");
  assert.equal(cnTradingMinutePhase("15:00"), "closing-auction");
  assert.equal(cnTradingMinutePhase("15:01"), "post-market");
  assert.equal(cnTradingMinutePhase("16:00"), "post-market");
  assert.equal(cnTradingMinutePhase("16:01"), "outside");
});

test("rejects invalid clocks rather than placing them on the chart", () => {
  assert.equal(clockMinuteOfDay("2026-08-25 25:00:00"), null);
  assert.equal(clockMinuteOfDay("not-a-time"), null);
  assert.equal(cnTradingAxisXRatio("2026-08-25 12:00:00"), null);
});
