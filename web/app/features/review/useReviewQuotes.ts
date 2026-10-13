"use client";

import { useCallback, useEffect, useState } from "react";
import { isUSStockSymbol, normalizeUSSymbol } from "../../lib/security.ts";

export type ReviewQuoteEntry = { market: "CN" | "US"; code: string };
export type ReviewQuote = { price: number; updatedAt: string; asOfDate: string };
type QuoteResponse = { code?: unknown; price?: unknown; date?: unknown; time?: unknown; source?: unknown; fetchedAt?: unknown; error?: unknown };

export function uniqueReviewQuoteEntries(entries: ReviewQuoteEntry[]): ReviewQuoteEntry[] {
  const unique = new Map<string, ReviewQuoteEntry>();
  for (const entry of entries) {
    const code = entry.market === "US"
      ? normalizeUSSymbol(entry.code)
      : String(entry.code).trim().replace(/^(?:sh|sz)/i, "").replace(/\.(?:sh|sz)$/i, "");
    if (entry.market === "US" ? !isUSStockSymbol(code) : !/^\d{6}$/.test(code)) continue;
    unique.set(`${entry.market}:${code}`, { market: entry.market, code });
  }
  return [...unique.values()].sort((left, right) => `${left.market}:${left.code}`.localeCompare(`${right.market}:${right.code}`));
}

export function reviewQuoteFromResponse(entry: ReviewQuoteEntry, snapshot: QuoteResponse): ReviewQuote {
  if (snapshot.code !== entry.code) throw new Error("行情股票代码不匹配");
  if (typeof snapshot.price !== "number" || !Number.isFinite(snapshot.price) || snapshot.price <= 0) {
    throw new Error("行情未返回有效价格");
  }
  const date = typeof snapshot.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.date) ? snapshot.date : "";
  const time = typeof snapshot.time === "string" && /^\d{2}:\d{2}(?::\d{2})?$/.test(snapshot.time) ? snapshot.time : "";
  let updatedAt = "行情时间未提供";
  if (entry.market === "CN" && date) {
    updatedAt = `${date}${time ? ` ${time}` : ""} 北京时间`;
  } else if (entry.market === "US" && String(snapshot.source).includes("日K") && date) {
    updatedAt = `${date}${time ? ` ${time}` : ""} 美东收盘`;
  } else if (entry.market === "US") {
    // The existing US provider builds date/time from its fetch clock, not the
    // exchange quote timestamp. Never present those fields as execution time.
    const fetchedAt = typeof snapshot.fetchedAt === "string" ? new Date(snapshot.fetchedAt) : null;
    updatedAt = fetchedAt && Number.isFinite(fetchedAt.getTime())
      ? `延时报价 · 获取于 ${fetchedAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} 北京时间`
      : "延时报价 · 行情时间未提供";
  }
  // For the US delayed source this is the provider's fetch-clock date, not an
  // exchange timestamp. It only bounds comparisons against future operations;
  // updatedAt explicitly labels the retrieval time and delayed quote semantics.
  return { price: snapshot.price, updatedAt, asOfDate: date };
}

export async function loadReviewQuotes(
  entries: ReviewQuoteEntry[],
  { signal, onQuote, fetchImpl = fetch, timeoutMs = 25_000 }: {
    signal: AbortSignal;
    onQuote: (key: string, quote: ReviewQuote) => void;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<string[]> {
  const queue = uniqueReviewQuoteEntries(entries);
  const failed: string[] = [];
  let cursor = 0;
  async function worker() {
    while (!signal.aborted && cursor < queue.length) {
      const entry = queue[cursor++];
      const controller = new AbortController();
      let cancel: () => void = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        cancel = () => {
          controller.abort();
          reject(new DOMException("行情请求已取消或超时", "AbortError"));
        };
      });
      signal.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(cancel, timeoutMs);
      try {
        const snapshot = await Promise.race([
          (async () => {
            const response = await fetchImpl(entry.market === "US" ? "/api/us-stock-realtime" : "/api/realtime-market", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: entry.code }),
              cache: "no-store",
              signal: controller.signal,
            });
            const body = await response.json() as QuoteResponse;
            if (!response.ok) throw new Error(String(body?.error || "行情获取失败"));
            if (!body || typeof body !== "object") throw new Error("行情响应无效");
            return body;
          })(),
          cancelled,
        ]);
        const quote = reviewQuoteFromResponse(entry, snapshot);
        if (!signal.aborted && !controller.signal.aborted) onQuote(`${entry.market}:${entry.code}`, quote);
      } catch {
        if (!signal.aborted) failed.push(`${entry.market}:${entry.code}`);
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()));
  return failed;
}

export function useReviewQuotes(entries: ReviewQuoteEntry[]): {
  quotes: Record<string, ReviewQuote>;
  loading: boolean;
  error: string;
  refresh: () => void;
} {
  const [quotes, setQuotes] = useState<Record<string, ReviewQuote>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const signature = JSON.stringify(uniqueReviewQuoteEntries(entries));
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const stocks = JSON.parse(signature) as ReviewQuoteEntry[];
    const controller = new AbortController();
    let active = false;
    async function load() {
      if (active || controller.signal.aborted) return;
      active = true;
      setLoading(stocks.length > 0);
      setError("");
      try {
        const failed = await loadReviewQuotes(stocks, {
          signal: controller.signal,
          onQuote: (key, quote) => setQuotes((previous) => ({ ...previous, [key]: quote })),
        });
        if (!controller.signal.aborted) {
          setError(failed.length ? `${failed.length} 只股票行情暂未更新（${failed.join("、")}），已保留上次行情。` : "");
        }
      } finally {
        active = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") void load();
    }
    void load();
    const timer = setInterval(refreshWhenVisible, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [signature, revision]);

  return { quotes, loading, error, refresh };
}
