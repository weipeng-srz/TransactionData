export const CN_TRADING_MINUTES = 240;
export const CN_CLOSING_AUCTION_START_MINUTE = 237;

export type CnTradingMinutePhase = "morning" | "afternoon" | "closing-auction" | "post-market" | "outside";

export function clockMinuteOfDay(value: string): number | null {
  const match = value.trim().match(/(?:^|\s)(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function cnTradingMinuteOffset(value: string): number | null {
  const minute = clockMinuteOfDay(value);
  if (minute == null) return null;
  if (minute >= 9 * 60 + 30 && minute <= 11 * 60 + 30) return minute - (9 * 60 + 30);
  if (minute >= 13 * 60 && minute <= 15 * 60) return 120 + minute - 13 * 60;
  return null;
}

export function cnTradingMinutePhase(value: string): CnTradingMinutePhase {
  const minute = clockMinuteOfDay(value);
  const offset = cnTradingMinuteOffset(value);
  if (offset != null) {
    if (offset >= CN_CLOSING_AUCTION_START_MINUTE) return "closing-auction";
    return minute != null && minute <= 11 * 60 + 30 ? "morning" : "afternoon";
  }
  if (minute != null && minute > 15 * 60 && minute <= 16 * 60) return "post-market";
  return "outside";
}

export function cnTradingAxisXRatio(value: string): number | null {
  const offset = cnTradingMinuteOffset(value);
  return offset == null ? null : Math.max(0, Math.min(1, offset / CN_TRADING_MINUTES));
}
