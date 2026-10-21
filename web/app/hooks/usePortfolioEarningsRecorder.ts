"use client";

import { accountStorage } from "../lib/accountStorage";

import { useEffect, useMemo, useState } from "react";
import type { StockHoldings } from "../lib/holdings";
import {
  earningsStorageKey, parseEarningsHistory, recordPortfolioEarnings,
  type EarningsHistory, type EarningsQuote,
} from "../lib/portfolioEarnings";

export type EarningsRecorderState = {
  history: EarningsHistory;
  now: Date | null;
  storageError: boolean;
};

// The workspace owns recording so opening or closing the calendar never changes
// which observations are persisted. Storage format and observation rules stay in
// portfolioEarnings, shared with the existing calculation tests.
export function usePortfolioEarningsRecorder(
  holdings: StockHoldings,
  quotes: Record<string, EarningsQuote>,
  hydrated: boolean,
): EarningsRecorderState {
  const [history, setHistory] = useState<EarningsHistory>({ version: 1, days: [] });
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let stored: EarningsHistory = { version: 1, days: [] };
    let failed = false;
    try { stored = parseEarningsHistory(JSON.parse(accountStorage.getItem(earningsStorageKey) ?? "null")); }
    catch { failed = true; }
    const frame = requestAnimationFrame(() => {
      setHistory(stored); setNow(new Date()); setStorageError(failed); setReady(true);
    });
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => { cancelAnimationFrame(frame); window.clearInterval(timer); };
  }, []);

  const observed = useMemo(() => ready && hydrated && now
    ? recordPortfolioEarnings(history, holdings, quotes, now) : history,
  [history, holdings, hydrated, now, quotes, ready]);

  useEffect(() => {
    if (!ready || !hydrated || observed === history) return;
    let failed = false;
    try { accountStorage.setItem(earningsStorageKey, JSON.stringify(observed)); }
    catch { failed = true; }
    const frame = requestAnimationFrame(() => { setHistory(observed); setStorageError(failed); });
    return () => cancelAnimationFrame(frame);
  }, [history, hydrated, observed, ready]);

  return { history: observed, now, storageError };
}
