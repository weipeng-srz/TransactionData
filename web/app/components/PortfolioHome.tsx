"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  aggregateCandles,
  analyzeMarketIntent,
  calculateIndicators,
  compactNumber,
  formatNumber,
  parseMarketCsv,
  type Candle,
  type IntentAnalysis,
} from "../lib/market";
import { parseNewsCsv, type NewsItem } from "../lib/news";
import { buildNextDayPrediction, type NextDayPredictionReport } from "../lib/nextDayPrediction";
import { emptyFinancialDataset } from "../lib/financials";
import {
  calculateHoldingMetrics,
  exportHoldingsCsv,
  parseHoldings,
  parseHoldingsCsv,
  type StockHolding,
  type StockHoldings,
} from "../lib/holdings";
import type { GlobalIndexFeed } from "../lib/globalIndexes";
import type { RealtimeSnapshot } from "../lib/realtimeMarket";
import { backtestGuideSignals, calculateRiskMetrics } from "../lib/research";
import { buildStockScore, type StockScoreReport } from "../lib/stockScore";
import {
  calculatePortfolioTotals,
  parseWatchlist,
  upsertWatchlistStock,
  type WatchlistStock,
} from "../lib/watchlist";
import {
  buildPortfolioInsights,
  formatCapitalAmount,
  sortPortfolioWatchlist,
  type PortfolioInsightSummary,
  type PortfolioSortKey,
} from "../lib/portfolioPresentation";
import { buildPortfolioPredictionConclusion } from "../lib/portfolioPrediction";
import SiteBanner from "./SiteBanner";
import styles from "./PortfolioHome.module.css";
import { currencyOf, marketLabel, marketOf, stockRouteKey, stockStorageKey, type StockCurrency, type StockMarket } from "../lib/security";

type Appearance = "light" | "dark";
type QuoteStatus = "idle" | "loading" | "ready" | "error";

type PortfolioQuote = {
  status: QuoteStatus;
  candles: Candle[];
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  amount: number | null;
  turnoverPct: number | null;
  date: string;
  time: string;
  marketStatus: string;
  source: string;
  error: string;
  score: StockScoreReport | null;
  intent: IntentAnalysis | null;
  predictionStatus: QuoteStatus;
  prediction: NextDayPredictionReport | null;
};

type PortfolioBenchmark = {
  candles: Candle[];
  name: string;
};

type PositionEditor = {
  stock: WatchlistStock;
  shares: string;
  cost: string;
  error: string;
};

type RemovedStock = {
  stock: WatchlistStock;
  index: number;
};

type FxPreference = {
  enabled: boolean;
  usdCny: string;
  updatedAt: string;
};

type GlobalFeedState = {
  status: "loading" | "ready" | "error";
  data: GlobalIndexFeed | null;
  error: string;
};

const watchlistStorageKey = "ticklens.watchlist.v1";
const holdingsStorageKey = "ticklens.holdings.v1";
const appearanceStorageKey = "ticklens.appearance.v1";
const fxPreferenceStorageKey = "ticklens.fx-preference.v1";
const portfolioBenchmarkRequests = new Map<StockMarket, { expiresAt: number; request: Promise<PortfolioBenchmark> }>();
const dialogFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");
const searchExamples = [
  { code: "000001", label: "平安银行" },
  { code: "600519", label: "贵州茅台" },
  { code: "300750", label: "宁德时代" },
];

const emptyQuote: PortfolioQuote = {
  status: "idle",
  candles: [],
  price: null,
  previousClose: null,
  change: null,
  changePct: null,
  open: null,
  high: null,
  low: null,
  volume: null,
  amount: null,
  turnoverPct: null,
  date: "",
  time: "",
  marketStatus: "等待行情",
  source: "",
  error: "",
  score: null,
  intent: null,
  predictionStatus: "idle",
  prediction: null,
};

function loadPortfolioBenchmark(market: StockMarket): Promise<PortfolioBenchmark> {
  const cached = portfolioBenchmarkRequests.get(market);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  const code = market === "US" ? "SPY" : "000300";
  const name = market === "US" ? "标普 500 ETF" : "沪深300";
  const request = fetch(market === "US" ? "/api/us-stock-data" : "/api/local-stock-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, days: 320, ...(market === "CN" ? { kind: "index" } : {}) }),
  }).then(async (response) => {
    const body = await response.text();
    if (!response.ok) throw new Error("市场基准获取失败");
    const dataset = parseMarketCsv(body);
    const benchmarkCode = dataset.codes[0] ?? code;
    const candles = aggregateCandles(dataset.rows, benchmarkCode, "1d");
    if (!candles.length) throw new Error("市场基准没有可用 K 线");
    return { candles, name };
  }).catch((reason) => {
    portfolioBenchmarkRequests.delete(market);
    throw reason;
  });
  portfolioBenchmarkRequests.set(market, { expiresAt: Date.now() + 5 * 60_000, request });
  return request;
}

export default function PortfolioHome({ onOpenStock }: { onOpenStock: (code: string) => void }) {
  const [watchlist, setWatchlist] = useState<WatchlistStock[]>([]);
  const [holdings, setHoldings] = useState<StockHoldings>({});
  const [quotes, setQuotes] = useState<Record<string, PortfolioQuote>>({});
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [hydrated, setHydrated] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [editor, setEditor] = useState<PositionEditor | null>(null);
  const [removedStock, setRemovedStock] = useState<RemovedStock | null>(null);
  const [notice, setNotice] = useState("");
  const [sortBy, setSortBy] = useState<PortfolioSortKey>("custom");
  const [lastRealtimeRefresh, setLastRealtimeRefresh] = useState("");
  const [globalFeed, setGlobalFeed] = useState<GlobalFeedState>({ status: "loading", data: null, error: "" });
  const [fxPreference, setFxPreference] = useState<FxPreference>({ enabled: false, usdCny: "7.20", updatedAt: "" });
  const realtimeRequestRef = useRef<AbortController | null>(null);
  const globalRequestRef = useRef<AbortController | null>(null);
  const holdingsFileRef = useRef<HTMLInputElement | null>(null);
  const positionModalRef = useRef<HTMLFormElement | null>(null);
  const positionEditorInitialFocusRef = useRef<HTMLInputElement | null>(null);
  const editorRestoreFocusRef = useRef<HTMLElement | null>(null);
  const editorOpen = editor !== null;

  useEffect(() => {
    let storedWatchlist: WatchlistStock[] = [];
    let storedHoldings: StockHoldings = {};
    let storedAppearance: Appearance = "light";
    let storedFxPreference: FxPreference = { enabled: false, usdCny: "7.20", updatedAt: "" };
    try {
      storedWatchlist = parseWatchlist(JSON.parse(localStorage.getItem(watchlistStorageKey) ?? "[]"));
    } catch {
      localStorage.removeItem(watchlistStorageKey);
    }
    try {
      storedHoldings = parseHoldings(JSON.parse(localStorage.getItem(holdingsStorageKey) ?? "[]"));
    } catch {
      localStorage.removeItem(holdingsStorageKey);
    }
    try {
      storedAppearance = localStorage.getItem(appearanceStorageKey) === "dark" ? "dark" : "light";
    } catch {
      storedAppearance = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(fxPreferenceStorageKey) ?? "null") as Partial<FxPreference> | null;
      const rate = Number(parsed?.usdCny);
      if (parsed && Number.isFinite(rate) && rate > 0 && rate < 20) {
        storedFxPreference = {
          enabled: parsed.enabled === true,
          usdCny: String(parsed.usdCny),
          updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
        };
      }
    } catch {
      localStorage.removeItem(fxPreferenceStorageKey);
    }
    document.documentElement.dataset.appearance = storedAppearance;
    const frame = window.requestAnimationFrame(() => {
      setWatchlist(storedWatchlist);
      setHoldings(storedHoldings);
      setAppearance(storedAppearance);
      setFxPreference(storedFxPreference);
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(watchlistStorageKey, JSON.stringify(watchlist));
    } catch {
      // The in-memory watchlist remains usable when browser storage is restricted.
    }
  }, [hydrated, watchlist]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(holdingsStorageKey, JSON.stringify(Object.values(holdings)));
    } catch {
      // The in-memory holdings remain usable when browser storage is restricted.
    }
  }, [holdings, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(fxPreferenceStorageKey, JSON.stringify(fxPreference));
    } catch {
      // The explicit conversion remains usable for the current session.
    }
  }, [fxPreference, hydrated]);

  const loadQuote = useCallback(async (stock: WatchlistStock, signal: AbortSignal) => {
    const key = stockStorageKey(stock);
    const market = marketOf(stock);
    setQuotes((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? emptyQuote),
        status: "loading",
        error: "",
        predictionStatus: "loading",
        prediction: null,
      },
    }));
    const marketRequest = fetch(market === "US" ? "/api/us-stock-data" : "/api/local-stock-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: stock.code, days: 180, ...(market === "CN" ? { kind: "stock" } : {}) }),
      signal,
    }).then(async (response) => {
      const body = await response.text();
      if (!response.ok) {
        let message = body;
        try { message = String((JSON.parse(body) as { error?: unknown }).error || body); } catch { /* text response */ }
        throw new Error(message || "历史行情获取失败");
      }
      const dataset = parseMarketCsv(body);
      const code = dataset.codes[0] ?? stock.code;
      const candles = aggregateCandles(dataset.rows, code, "1d");
      if (!candles.length) throw new Error("历史行情没有可用 K 线");
      const indicators = calculateIndicators(candles);
      const latest = candles.at(-1);
      const intent = latest ? analyzeMarketIntent(dataset, code, latest.date) : null;
      return { candles, indicators, intent, dataQuality: dataset.quality };
    });
    const realtimeRequest = fetch(market === "US" ? "/api/us-stock-realtime" : "/api/realtime-market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: stock.code }),
      cache: "no-store",
      signal,
    }).then(async (response) => {
      const body = await response.json() as RealtimeSnapshot | { error?: unknown };
      if (!response.ok) throw new Error(String((body as { error?: unknown }).error || "实时行情获取失败"));
      return body as RealtimeSnapshot;
    });
    const newsRequest = fetch(market === "US" ? "/api/us-stock-news" : "/api/local-stock-news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: stock.code, limit: 24 }),
      signal,
    }).then(async (response) => {
      const body = await response.text();
      if (!response.ok) throw new Error("消息面获取失败");
      return parseNewsCsv(body).items;
    });
    const benchmarkRequest = loadPortfolioBenchmark(market);
    const contextRequest = Promise.allSettled([newsRequest, benchmarkRequest] as const);

    const [marketResult, realtimeResult] = await Promise.allSettled([marketRequest, realtimeRequest]);
    if (signal.aborted) return;
    if (marketResult.status === "rejected" && realtimeResult.status === "rejected") {
      const marketError = marketResult.reason instanceof Error ? marketResult.reason.message : "历史行情失败";
      const realtimeError = realtimeResult.reason instanceof Error ? realtimeResult.reason.message : "实时行情失败";
      setQuotes((current) => ({
        ...current,
        [key]: {
          ...(current[key] ?? emptyQuote),
          status: "error",
          error: `${marketError}；${realtimeError}`,
          predictionStatus: "error",
          prediction: null,
        },
      }));
      return;
    }

    const candles = marketResult.status === "fulfilled" ? marketResult.value.candles : [];
    const latest = candles.at(-1);
    const realtime = realtimeResult.status === "fulfilled" ? realtimeResult.value : null;
    const price = realtime?.price ?? latest?.close ?? null;
    const previousClose = realtime?.previousClose ?? (candles.length > 1 ? candles.at(-2)?.close ?? null : null);
    const fallbackChange = price != null && previousClose != null ? price - previousClose : latest?.change ?? null;
    const fallbackChangePct = price != null && previousClose ? ((price / previousClose) - 1) * 100 : latest?.changePct ?? null;
    const quote: PortfolioQuote = {
      status: "ready",
      candles,
      price,
      previousClose,
      change: realtime?.change ?? fallbackChange,
      changePct: realtime?.changePct ?? fallbackChangePct,
      open: realtime?.open ?? latest?.open ?? null,
      high: realtime?.high ?? latest?.high ?? null,
      low: realtime?.low ?? latest?.low ?? null,
      volume: realtime?.volume ?? latest?.volume ?? null,
      amount: realtime?.amount ?? latest?.amount ?? null,
      turnoverPct: latest?.turnoverPct ?? null,
      date: realtime?.date ?? latest?.date ?? "",
      time: realtime?.time ?? "收盘",
      marketStatus: realtime?.marketStatus ?? "最近收盘",
      source: realtime ? "实时 + 180日K" : "最近收盘 + 180日K",
      error: marketResult.status === "rejected" || realtimeResult.status === "rejected" ? "部分数据源暂不可用" : "",
      score: null,
      intent: marketResult.status === "fulfilled" ? marketResult.value.intent : null,
      predictionStatus: marketResult.status === "fulfilled" ? "loading" : "error",
      prediction: null,
    };
    setQuotes((current) => ({ ...current, [key]: quote }));

    if (marketResult.status !== "fulfilled") return;
    const [newsResult, benchmarkResult] = await contextRequest;
    if (signal.aborted) return;
    const newsItems: NewsItem[] = newsResult.status === "fulfilled" ? newsResult.value : [];
    const benchmark = benchmarkResult.status === "fulfilled" ? benchmarkResult.value : null;
    try {
      const score = buildStockScore({
        candles,
        indicators: marketResult.value.indicators,
        currentPrice: realtime?.price ?? latest?.close ?? null,
        intent: marketResult.value.intent,
        financials: emptyFinancialDataset(),
        newsItems,
        risk: calculateRiskMetrics(candles, benchmark?.candles ?? []),
        backtest: backtestGuideSignals(candles, marketResult.value.indicators, [5, 10, 20], {
          benchmark: benchmark?.candles ?? [],
          limitUpDownPct: market === "US" ? null : 9.8,
        }),
        dataQuality: marketResult.value.dataQuality,
      });
      const prediction = buildNextDayPrediction(candles, {
        window: 126,
        neighbors: 15,
        mode: "tomorrow",
        market,
        realtimeSnapshot: realtime,
        benchmarkCandles: benchmark?.candles ?? [],
        benchmarkName: benchmark?.name,
        newsItems,
      });
      setQuotes((current) => current[key] ? ({
        ...current,
        [key]: {
          ...current[key],
          score,
          predictionStatus: prediction ? "ready" : "error",
          prediction,
        },
      }) : current);
    } catch {
      setQuotes((current) => current[key] ? ({
        ...current,
        [key]: { ...current[key], predictionStatus: "error", prediction: null },
      }) : current);
    }
  }, []);

  const refreshRealtimeQuotes = useCallback(async () => {
    if (!watchlist.length || document.hidden) return;
    realtimeRequestRef.current?.abort();
    const controller = new AbortController();
    realtimeRequestRef.current = controller;
    const results = await Promise.allSettled(watchlist.map(async (stock) => {
      const response = await fetch(marketOf(stock) === "US" ? "/api/us-stock-realtime" : "/api/realtime-market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: stock.code }),
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json() as RealtimeSnapshot | { error?: unknown };
      if (!response.ok) throw new Error(String((body as { error?: unknown }).error || "实时行情获取失败"));
      return body as RealtimeSnapshot;
    }));
    if (controller.signal.aborted) return;
    setQuotes((current) => {
      const next = { ...current };
      results.forEach((result, index) => {
        const stock = watchlist[index];
        const key = stockStorageKey(stock);
        const previous = current[key] ?? emptyQuote;
        if (result.status === "rejected") {
          if (previous.status === "ready") next[key] = { ...previous, error: "本次实时刷新暂不可用" };
          return;
        }
        const realtime = result.value;
        next[key] = {
          ...previous,
          status: "ready",
          price: realtime.price,
          previousClose: realtime.previousClose,
          change: realtime.change,
          changePct: realtime.changePct,
          open: realtime.open,
          high: realtime.high,
          low: realtime.low,
          volume: realtime.volume,
          amount: realtime.amount,
          date: realtime.date,
          time: realtime.time,
          marketStatus: realtime.marketStatus,
          source: previous.candles.length ? "实时 + 180日K" : "实时行情",
          error: "",
        };
      });
      return next;
    });
    setLastRealtimeRefresh(new Date().toISOString());
  }, [watchlist]);

  const loadGlobalFeed = useCallback(async (silent = false) => {
    if (document.hidden) return;
    globalRequestRef.current?.abort();
    const controller = new AbortController();
    globalRequestRef.current = controller;
    if (!silent) setGlobalFeed((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const response = await fetch("/api/global-indexes", { cache: "no-store", signal: controller.signal });
      const body = await response.json() as GlobalIndexFeed | { error?: unknown };
      if (!response.ok) throw new Error(String((body as { error?: unknown }).error || "全球市场行情获取失败"));
      setGlobalFeed({ status: "ready", data: body as GlobalIndexFeed, error: "" });
    } catch (reason) {
      if (controller.signal.aborted) return;
      const message = reason instanceof Error ? reason.message : "全球市场行情获取失败";
      setGlobalFeed((current) => ({ ...current, status: current.data ? "ready" : "error", error: message }));
    }
  }, []);

  useEffect(() => {
    if (!hydrated || watchlist.length === 0) return;
    const controller = new AbortController();
    const loadInBatches = async () => {
      for (let index = 0; index < watchlist.length && !controller.signal.aborted; index += 4) {
        await Promise.allSettled(watchlist.slice(index, index + 4).map((stock) => loadQuote(stock, controller.signal)));
      }
    };
    void loadInBatches();
    return () => controller.abort();
  }, [hydrated, loadQuote, refreshVersion, watchlist]);

  useEffect(() => {
    if (!hydrated || watchlist.length === 0) return;
    const timer = window.setInterval(() => void refreshRealtimeQuotes(), 5_000);
    const refreshWhenVisible = () => { if (!document.hidden) void refreshRealtimeQuotes(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      realtimeRequestRef.current?.abort();
    };
  }, [hydrated, refreshRealtimeQuotes, watchlist.length]);

  useEffect(() => {
    if (!hydrated) return;
    const initial = window.setTimeout(() => void loadGlobalFeed(), 0);
    const timer = window.setInterval(() => void loadGlobalFeed(true), 10_000);
    const refreshWhenVisible = () => { if (!document.hidden) void loadGlobalFeed(true); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      globalRequestRef.current?.abort();
    };
  }, [hydrated, loadGlobalFeed]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditor(null);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!editorOpen) return;
    editorRestoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      positionEditorInitialFocusRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const restoreTarget = editorRestoreFocusRef.current;
      editorRestoreFocusRef.current = null;
      if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
    };
  }, [editorOpen]);

  useEffect(() => {
    if (!notice && !removedStock) return;
    const timeout = window.setTimeout(() => {
      setNotice("");
      setRemovedStock(null);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [notice, removedStock]);

  const addResolvedStock = (stock: WatchlistStock, existed = watchlist.some((item) => stockStorageKey(item) === stockStorageKey(stock))) => {
    setWatchlist((current) => upsertWatchlistStock(current, stock));
    setNotice(existed ? `${stock.name} 已在自选股中，已移到列表顶部。` : `${stock.name} 已加入自选股。`);
  };

  const removeStock = (stock: WatchlistStock) => {
    const key = stockStorageKey(stock);
    const index = watchlist.findIndex((item) => stockStorageKey(item) === key);
    setWatchlist((current) => current.filter((item) => stockStorageKey(item) !== key));
    setQuotes((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setRemovedStock({ stock, index: Math.max(0, index) });
    setNotice(`已从自选股移除 ${stock.name}。`);
  };

  const undoRemove = () => {
    if (!removedStock) return;
    setWatchlist((current) => {
      const next = [...current];
      next.splice(Math.min(removedStock.index, next.length), 0, removedStock.stock);
      return parseWatchlist(next);
    });
    setNotice(`${removedStock.stock.name} 已恢复。`);
    setRemovedStock(null);
  };

  const openEditor = (stock: WatchlistStock) => {
    const holding = holdings[stockStorageKey(stock)];
    setEditor({
      stock,
      shares: holding ? String(holding.shares) : "",
      cost: holding ? String(holding.cost) : "",
      error: "",
    });
  };

  const savePosition = () => {
    if (!editor) return;
    const shares = Number(editor.shares);
    const cost = Number(editor.cost);
    if (!Number.isInteger(shares) || shares <= 0) {
      setEditor({ ...editor, error: "持股数需为大于 0 的整数" });
      return;
    }
    if (!Number.isFinite(cost) || cost <= 0) {
      setEditor({ ...editor, error: "成本价需为大于 0 的数字" });
      return;
    }
    const holding: StockHolding = {
      code: editor.stock.code,
      ...(marketOf(editor.stock) === "US" ? { market: "US" as const, currency: "USD" as const } : {}),
      shares,
      cost,
      updatedAt: new Date().toISOString(),
    };
    setHoldings((current) => ({ ...current, [stockStorageKey(holding)]: holding }));
    setNotice(`${editor.stock.name} 的持仓已更新。`);
    setEditor(null);
  };

  const clearPosition = () => {
    if (!editor) return;
    setHoldings((current) => {
      const next = { ...current };
      delete next[stockStorageKey(editor.stock)];
      return next;
    });
    setNotice(`${editor.stock.name} 的持仓信息已清空。`);
    setEditor(null);
  };

  const exportPositions = () => {
    const csv = exportHoldingsCsv(holdings, watchlist);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `TrendSight-持仓-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    setNotice(Object.keys(holdings).length ? "持仓已导出为可编辑 CSV。" : "已导出空白持仓模板，可编辑后重新导入。");
  };

  const importPositions = async (file: File) => {
    try {
      const imported = parseHoldingsCsv(await file.text());
      setHoldings((current) => ({ ...current, ...imported.holdings }));
      setWatchlist((current) => imported.stocks.reduceRight(
        (next, stock) => upsertWatchlistStock(next, { ...stock, addedAt: new Date().toISOString() }),
        current,
      ));
      setNotice(`已从 CSV 导入 ${imported.stocks.length} 条持仓，并保存到当前浏览器。`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "持仓 CSV 导入失败");
    } finally {
      if (holdingsFileRef.current) holdingsFileRef.current.value = "";
    }
  };

  const toggleAppearance = () => {
    const next: Appearance = appearance === "light" ? "dark" : "light";
    setAppearance(next);
    document.documentElement.dataset.appearance = next;
    try { localStorage.setItem(appearanceStorageKey, next); } catch { /* current view still updates */ }
  };

  const sortedWatchlist = useMemo(
    () => sortPortfolioWatchlist(watchlist, holdings, quotes, sortBy),
    [holdings, quotes, sortBy, watchlist],
  );

  const totals = useMemo(() => calculatePortfolioTotals(
    watchlist,
    holdings,
    Object.fromEntries(Object.entries(quotes).map(([code, quote]) => [code, { price: quote.price, change: quote.change }])),
  ), [holdings, quotes, watchlist]);
  const portfolioInsights = useMemo(
    () => buildPortfolioInsights(watchlist, holdings, quotes),
    [holdings, quotes, watchlist],
  );

  const loadingCount = Object.values(quotes).filter((quote) => quote.status === "loading").length;
  const latestUpdate = portfolioInsights.latestUpdate;

  return (
    <main className={styles.page}>
      <SiteBanner
        activePage="portfolio"
        appearance={appearance}
        onToggleAppearance={toggleAppearance}
        onOpenStock={onOpenStock}
        onAddStock={addResolvedStock}
        statusText={loadingCount ? `${loadingCount} 只更新中` : lastRealtimeRefresh ? `实时刷新 ${formatClock(lastRealtimeRefresh)}` : latestUpdate ? `行情 ${latestUpdate.slice(5, 16)}` : "等待行情"}
      />

      <div className={styles.content} id="portfolio-top">
        <h1 className={styles.srOnly}>我的投资组合与市场观察</h1>
        <section className={styles.summaryGrid} aria-label="投资组合概览">
          <article>
            <span>持仓市值</span>
            <strong>{totals.positioned ? formatMixedCurrencyTotals(totals.byCurrency, "marketValue") : "—"}</strong>
            <small>{totals.positioned ? `${totals.positioned} 只持仓 · 成本 ${formatMixedCurrencyTotals(totals.byCurrency, "costValue")}` : "设置持股数与成本价后显示"}</small>
          </article>
          <article>
            <span>累计收益</span>
            <strong>{totals.positioned ? formatMixedCurrencyTotals(totals.byCurrency, "profit", true) : "—"}</strong>
            <small>{totals.positioned ? "不同币种分别统计，不进行汇率折算" : "暂无持仓数据"}</small>
          </article>
          <article>
            <span>今日持仓盈亏</span>
            <strong>{totals.positioned ? formatMixedCurrencyTotals(totals.byCurrency, "dayProfit", true) : "—"}</strong>
            <small>{latestUpdate ? `按 ${latestUpdate.slice(0, 16)} 行情估算` : "等待最新行情"}</small>
          </article>
          <article>
            <span>自选关注</span>
            <strong>{totals.tracked || "—"}</strong>
            <small>{totals.tracked ? `${Object.values(quotes).filter((quote) => quote.status === "ready").length} 只行情已就绪` : "从上方添加第一只股票"}</small>
          </article>
        </section>

        <FxConversionPanel
          totals={totals.byCurrency}
          preference={fxPreference}
          onChange={setFxPreference}
        />

        <PortfolioDecisionBrief summary={portfolioInsights} />

        <GlobalMarketPulse feed={globalFeed} onRetry={() => void loadGlobalFeed()} />

        <section className={styles.watchlistCard} id="watchlist">
          <header className={styles.listHeader}>
            <div>
              <p>PORTFOLIO</p>
              <h2>我的自选股</h2>
              <span>{watchlist.length ? `${watchlist.length} 只股票 · 明日预测按行情切片计算 · 价格每 5 秒刷新` : "收藏股票后，预测结论、行情与持仓收益会集中显示在这里"}</span>
            </div>
            <div className={styles.listActions}>
              <label>排序
                <select aria-label="自选股排序" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
                  <option value="custom">最近添加</option>
                  <option value="signal">证据状态</option>
                  <option value="capital">资金强度（百分比）</option>
                  <option value="change">涨跌幅</option>
                  <option value="profit">持仓收益率</option>
                </select>
              </label>
              <input ref={holdingsFileRef} className={styles.srOnly} type="file" accept=".csv,text/csv" aria-label="导入持仓 CSV" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPositions(file); }} />
              <button type="button" onClick={() => holdingsFileRef.current?.click()} title="导入持仓 CSV"><ImportIcon />导入持仓</button>
              <button type="button" onClick={exportPositions} title="导出可编辑的持仓 CSV"><ExportIcon />导出持仓</button>
              <button type="button" onClick={() => setRefreshVersion((value) => value + 1)} disabled={!watchlist.length || loadingCount > 0}>
                <RefreshIcon />{loadingCount ? "更新中" : "刷新行情"}
              </button>
            </div>
          </header>

          {watchlist.length ? (
            <div className={styles.tableViewport}>
              <div className={styles.columnHeader} aria-hidden="true">
                <span>股票</span><span>明日预测结论</span><span>最新价 / 涨跌</span><span>资金净流（本币）</span><span>持仓收益</span><span>持仓 / 市值</span><span>近 60 日趋势</span><span>今日行情</span><span>操作</span>
              </div>
              <div className={styles.stockList}>
                {sortedWatchlist.map((stock) => (
                  <PortfolioRow
                    key={stockStorageKey(stock)}
                    stock={stock}
                    quote={quotes[stockStorageKey(stock)] ?? emptyQuote}
                    holding={holdings[stockStorageKey(stock)] ?? null}
                    onOpen={() => onOpenStock(stockRouteKey(stock))}
                    onEdit={() => openEditor(stock)}
                    onRemove={() => removeStock(stock)}
                    onRetry={() => void loadQuote(stock, new AbortController().signal)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <div className={styles.emptyArtwork} aria-hidden="true"><i /><i /><i /><span>＋</span></div>
              <h3>建立你的第一份自选列表</h3>
              <p>搜索并收藏股票后，这里会显示明日预测结论、上涨概率、迷你 K 线、实时行情与持仓收益。</p>
              <div className={styles.exampleStocks}>
                {searchExamples.map((item) => <button key={item.code} type="button" onClick={() => addResolvedStock({ code: item.code, name: item.label, addedAt: new Date().toISOString() })}><strong>{item.label}</strong><span>{item.code}</span><em>＋</em></button>)}
              </div>
            </div>
          )}
        </section>

        <footer className={styles.footer}>
          <span>持仓仅保存在当前浏览器；预测基于历史 K 线、大盘与消息面概率计算，行情与结论可能存在延迟。</span>
          <span>仅供研究参考，不构成投资建议。</span>
        </footer>
      </div>

      {editor ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
          <form
            ref={positionModalRef}
            className={styles.positionModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="position-title"
            onSubmit={(event) => { event.preventDefault(); savePosition(); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditor(null);
              } else if (event.key === "Tab") {
                const focusableElements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(dialogFocusableSelector));
                const currentIndex = focusableElements.findIndex((element) => element === document.activeElement);
                const nextIndex = event.shiftKey
                  ? (currentIndex <= 0 ? focusableElements.length - 1 : currentIndex - 1)
                  : (currentIndex < 0 || currentIndex === focusableElements.length - 1 ? 0 : currentIndex + 1);
                event.preventDefault();
                focusableElements[nextIndex]?.focus();
              } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
                event.preventDefault();
                savePosition();
              }
            }}
          >
            <header>
              <div className={styles.modalIdentity}>
                <span className={styles.stockAvatar}>{editor.stock.name.slice(0, 1)}</span>
                <div><p>编辑持仓</p><h2 id="position-title">{editor.stock.name}</h2><small>{editor.stock.code} · {marketLabel(marketOf(editor.stock))}</small></div>
              </div>
              <button className={styles.modalClose} type="button" onClick={() => setEditor(null)} aria-label="关闭编辑持仓">×</button>
            </header>
            <div className={styles.positionFields}>
              <label><span>持股数量</span><div><input ref={positionEditorInitialFocusRef} inputMode="numeric" value={editor.shares} onChange={(event) => setEditor({ ...editor, shares: event.target.value, error: "" })} placeholder="例如 1000" /><em>股</em></div></label>
              <label><span>平均成本价</span><div><b>{currencyOf(editor.stock) === "USD" ? "$" : "¥"}</b><input inputMode="decimal" value={editor.cost} onChange={(event) => setEditor({ ...editor, cost: event.target.value, error: "" })} placeholder="例如 12.50" /><em>{currencyOf(editor.stock) === "USD" ? "美元" : "元"}</em></div></label>
            </div>
            <div className={styles.positionPreview}>
              <span>预计持仓成本</span>
              <strong>{Number(editor.shares) > 0 && Number(editor.cost) > 0 ? formatCurrency(Number(editor.shares) * Number(editor.cost), currencyOf(editor.stock)) : "—"}</strong>
              <small>保存后将结合最新行情计算市值与收益</small>
            </div>
            {editor.error ? <p className={styles.modalError} role="alert">{editor.error}</p> : null}
            <footer>
              {holdings[stockStorageKey(editor.stock)] ? <button className={styles.clearButton} type="button" onClick={clearPosition}>清空持仓</button> : <span />}
              <div><button className={styles.cancelButton} type="button" onClick={() => setEditor(null)}>取消</button><button className={styles.saveButton} type="submit">保存持仓</button></div>
            </footer>
          </form>
        </div>
      ) : null}

      {notice ? (
        <div className={styles.toast} role="status">
          <span>{notice}</span>
          {removedStock ? <button type="button" onClick={undoRemove}>撤销</button> : null}
          <button type="button" aria-label="关闭通知" onClick={() => { setNotice(""); setRemovedStock(null); }}>×</button>
        </div>
      ) : null}
    </main>
  );
}

function FxConversionPanel({
  totals,
  preference,
  onChange,
}: {
  totals: ReturnType<typeof calculatePortfolioTotals>["byCurrency"];
  preference: FxPreference;
  onChange: (value: FxPreference) => void;
}) {
  const rate = Number(preference.usdCny);
  const validRate = Number.isFinite(rate) && rate > 0 && rate < 20;
  const converted = (key: "marketValue" | "costValue" | "profit" | "dayProfit") => validRate
    ? totals.CNY[key] + totals.USD[key] * rate
    : null;
  const updateTime = preference.updatedAt && !Number.isNaN(Date.parse(preference.updatedAt))
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(preference.updatedAt))
    : "尚未确认";

  return (
    <section className={`${styles.fxPanel} ${preference.enabled ? styles.fxPanelEnabled : ""}`} aria-label="可选汇率折算">
      <div>
        <p>OPTIONAL FX VIEW</p>
        <strong>人民币折算视图</strong>
        <small>默认仍按人民币与美元分别统计；折算值只用于组合观察，不改写原始持仓和收益。</small>
      </div>
      <label className={styles.fxToggle}>
        <input
          type="checkbox"
          checked={preference.enabled}
          onChange={(event) => onChange({ ...preference, enabled: event.target.checked, updatedAt: new Date().toISOString() })}
        />
        <span>{preference.enabled ? "已开启" : "保持分币种"}</span>
      </label>
      {preference.enabled ? (
        <>
          <label className={styles.fxRateField}>
            <span>USD/CNY</span>
            <input
              inputMode="decimal"
              aria-label="美元兑人民币汇率"
              value={preference.usdCny}
              onChange={(event) => onChange({ ...preference, usdCny: event.target.value, updatedAt: new Date().toISOString() })}
            />
            <small>{validRate ? `来源：用户输入 · 更新 ${updateTime}` : "请输入 0–20 之间的有效汇率"}</small>
          </label>
          <div className={styles.fxConvertedValues}>
            <span><small>折算市值</small><strong>{converted("marketValue") == null ? "—" : formatCurrency(converted("marketValue")!, "CNY")}</strong></span>
            <span><small>折算成本</small><strong>{converted("costValue") == null ? "—" : formatCurrency(converted("costValue")!, "CNY")}</strong></span>
            <span><small>折算累计收益</small><strong>{converted("profit") == null ? "—" : formatCurrency(converted("profit")!, "CNY")}</strong></span>
            <span><small>折算今日盈亏</small><strong>{converted("dayProfit") == null ? "—" : formatCurrency(converted("dayProfit")!, "CNY")}</strong></span>
          </div>
        </>
      ) : null}
    </section>
  );
}

function PortfolioDecisionBrief({ summary }: { summary: PortfolioInsightSummary }) {
  const dataHeadline = summary.tracked ? `${summary.completionPct}% 行情就绪` : "等待建立自选";
  const performanceHeadline = summary.bestHolding
    ? `${summary.bestHolding.stockName} ${signedPercent(summary.bestHolding.valuePct)}`
    : summary.strongestMove
      ? `${summary.strongestMove.stockName} ${signedPercent(summary.strongestMove.valuePct)}`
      : "等待收益与波动数据";
  const riskDetail = summary.highestConcentration
    ? `${summary.highestConcentration.topStockName} 占${currencyName(summary.highestConcentration.currency)}子组合 ${formatNumber(summary.highestConcentration.topWeightPct, 1)}%`
    : summary.weakestHolding
      ? `${summary.weakestHolding.stockName} 当前收益率 ${signedPercent(summary.weakestHolding.valuePct)}`
      : "尚无可计算的持仓集中度";

  return (
    <section className={styles.decisionBrief} aria-labelledby="decision-brief-title">
      <header>
        <div><p>TODAY IN 3</p><h2 id="decision-brief-title">今日三件事</h2></div>
        <span>先看数据，再看风险，最后决定核验动作</span>
      </header>
      <div className={styles.decisionGrid}>
        <article>
          <span>1 · 数据状态</span>
          <strong>{dataHeadline}</strong>
          <small>{summary.tracked ? `${summary.ready}/${summary.tracked} 只可用${summary.failed ? ` · ${summary.failed} 只失败` : ""}${summary.latestUpdate ? ` · 最新 ${summary.latestUpdate.slice(5, 16)}` : ""}` : "添加股票后会显示来源、时效与完整度"}</small>
        </article>
        <article>
          <span>2 · 收益与风险线索</span>
          <strong>{performanceHeadline}</strong>
          <small>{riskDetail}；不同币种不合并、不隐式折算。</small>
        </article>
        <article>
          <span>3 · 下一步核验</span>
          <strong>先验证，再决策</strong>
          <small>{summary.nextAction}</small>
        </article>
      </div>
      <footer className={styles.exposureStrip}>
        <span>币种敞口</span>
        {summary.exposures.length ? summary.exposures.map((exposure) => (
          <div key={exposure.currency}>
            <strong>{currencyName(exposure.currency)}</strong>
            <b>{exposure.priced ? formatCurrency(exposure.marketValue, exposure.currency) : "等待行情"}</b>
            <small>{exposure.positioned} 只持仓{exposure.priced < exposure.positioned ? ` · ${exposure.positioned - exposure.priced} 只待定价` : ""}{exposure.topWeightPct != null ? ` · 最大集中 ${formatNumber(exposure.topWeightPct, 1)}%` : ""}</small>
          </div>
        )) : <p>尚未记录持仓；币种敞口会按人民币与美元分别展示。</p>}
        <em>不采用隐含汇率</em>
      </footer>
    </section>
  );
}

function GlobalMarketPulse({ feed, onRetry }: { feed: GlobalFeedState; onRetry: () => void }) {
  const shanghai = feed.data?.quotes.find((quote) => quote.id === "shanghai");
  const chinext = feed.data?.quotes.find((quote) => quote.id === "chinext");
  const nasdaq = feed.data?.usQuotes.find((quote) => quote.id === "nasdaq");
  const aShareFear = feed.data?.fearGauges.find((quote) => quote.id === "a-share-fear");
  const usFear = feed.data?.fearGauges.find((quote) => quote.id === "us-vix");
  const cards = [
    {
      id: "shanghai",
      name: "上证指数",
      code: shanghai?.code ?? "000001",
      value: shanghai?.price ?? null,
      changePct: shanghai?.changePct ?? null,
      meta: shanghai?.marketStatus ?? "A股核心指数",
      proxy: null as string | null,
      kind: "index" as const,
    },
    {
      id: "chinext",
      name: "创业板指",
      code: chinext?.code ?? "399006",
      value: chinext?.price ?? null,
      changePct: chinext?.changePct ?? null,
      meta: chinext?.marketStatus ?? "成长风格指数",
      proxy: null as string | null,
      kind: "index" as const,
    },
    {
      id: "nasdaq",
      name: "纳斯达克综指",
      code: nasdaq?.code ?? "IXIC",
      value: nasdaq?.cashPrice ?? null,
      changePct: nasdaq?.cashChangePct ?? null,
      meta: nasdaq ? `IXIC ${nasdaq.phase === "盘中" ? "现货盘中" : "最近现货"}` : "美股科技风向",
      proxy: nasdaq?.phaseIsProxy && nasdaq.phaseValue != null
        ? `${nasdaq.phaseInstrument} ${formatMarketValue(nasdaq.phaseValue)}${nasdaq.phaseChangePct == null ? "" : ` · ${signedPercent(nasdaq.phaseChangePct)}`}`
        : null,
      kind: "index" as const,
    },
    {
      id: "a-share-fear",
      name: "A股市场压力温度",
      code: aShareFear?.code ?? "CN-PRESSURE",
      value: aShareFear?.value ?? null,
      changePct: aShareFear?.changePct ?? null,
      meta: aShareFear?.level ?? "市场压力代理",
      proxy: null as string | null,
      kind: "fear" as const,
    },
    {
      id: "us-vix",
      name: "美股恐慌指数",
      code: usFear?.code ?? "VIX",
      value: usFear?.value ?? null,
      changePct: usFear?.changePct ?? null,
      meta: usFear?.level ?? "CBOE VIX",
      proxy: null as string | null,
      kind: "fear" as const,
    },
  ];

  return (
    <section className={styles.globalMarketCard} aria-labelledby="global-market-title">
      <header className={styles.globalMarketHeader}>
        <div>
          <p>GLOBAL PULSE</p>
          <h2 id="global-market-title">全球市场脉动</h2>
          <span>核心指数与风险温度 · 10 秒自动刷新</span>
        </div>
        <div>
          <span className={styles.globalUpdated}>{feed.data ? `更新 ${formatClock(feed.data.fetchedAt)}` : feed.status === "loading" ? "正在连接全球行情" : "行情连接异常"}</span>
          <Link href="/global-markets">查看全球市场 <b aria-hidden="true">›</b></Link>
        </div>
      </header>
      {feed.status === "error" && !feed.data ? (
        <div className={styles.globalError} role="alert"><span>{feed.error}</span><button type="button" onClick={onRetry}>重新加载</button></div>
      ) : (
        <div className={styles.globalMarketGrid} aria-busy={feed.status === "loading"}>
          {cards.map((card) => (
            <article className={styles.globalMetric} key={card.id}>
              <header><span>{card.name}</span><em>{card.code}</em></header>
              {card.value == null ? <div className={styles.globalSkeleton} /> : <strong>{formatMarketValue(card.value)}</strong>}
              <footer>
                <span className={card.kind === "fear" ? fearToneClass(card.value) : toneClass(card.changePct)}>
                  {card.kind === "fear" && card.changePct == null ? card.meta : card.changePct == null ? "—" : signedPercent(card.changePct)}
                </span>
                <small>{card.kind === "fear" && card.changePct == null ? "压力水平" : card.meta}</small>
              </footer>
              {card.proxy ? <p className={styles.globalProxyNote}><span>{card.proxy}</span><small>方向参考，非 IXIC 指数点位</small></p> : null}
            </article>
          ))}
        </div>
      )}
      {feed.error && feed.data ? <p className={styles.globalStale}>本次刷新未成功，继续展示上一份有效行情。</p> : null}
    </section>
  );
}

function PortfolioRow({
  stock,
  quote,
  holding,
  onOpen,
  onEdit,
  onRemove,
  onRetry,
}: {
  stock: WatchlistStock;
  quote: PortfolioQuote;
  holding: StockHolding | null;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const currency = currencyOf(stock);
  const metrics = holding ? calculateHoldingMetrics(holding.shares, holding.cost, quote.price) : null;
  const dayProfit = holding && quote.change != null ? holding.shares * quote.change : null;
  const tone = toneClass(quote.changePct);
  return (
    <article className={styles.stockRow}>
      <button className={styles.stockIdentity} type="button" aria-label={`打开 ${stock.name} ${stock.code} 的股票分析`} onClick={onOpen}>
        <span className={styles.stockAvatar}>{stock.name.slice(0, 1)}</span>
        <span className={styles.stockIdentityText}><strong>{stock.name}</strong><small>{stock.code} · {marketOf(stock) === "US" ? "美股" : "A股"}</small><em className={quote.marketStatus === "交易中" ? styles.live : ""}>{quote.marketStatus}</em></span>
      </button>
      <WatchlistScoreBadge
        prediction={quote.prediction}
        predictionStatus={quote.predictionStatus}
        scoreReport={quote.score}
        stockName={stock.name}
        hasHolding={Boolean(holding)}
        onOpen={onOpen}
        onEdit={onEdit}
      />
      <div className={styles.priceCell}>
        {quote.status === "error" ? <button className={styles.retryLink} type="button" onClick={onRetry}>重试行情</button> : <strong>{quote.price == null ? "—" : formatNumber(quote.price, quote.price >= 100 ? 2 : 3)}</strong>}
        <span className={tone}>{quote.change == null || quote.changePct == null ? "—" : `${quote.change >= 0 ? "+" : ""}${formatNumber(quote.change, 3)}  ${signedPercent(quote.changePct)}`}</span>
        {quote.error ? <small title={quote.error}>{quote.error}</small> : null}
      </div>
      <CapitalFlowCell intent={quote.intent} quoteDate={quote.date} loading={quote.status === "loading"} currency={currency} />
      <div className={styles.profitCell}>
        <strong className={toneClass(metrics?.profit)}>{metrics ? signedCurrency(metrics.profit, currency) : "—"}</strong>
        <span className={toneClass(metrics?.profitPct)}>{metrics ? signedPercent(metrics.profitPct) : "暂无持仓"}</span>
      </div>
      <div className={styles.holdingCell}>
        {holding ? <><strong>{formatShares(holding.shares)}</strong><span>市值 {metrics ? formatCurrency(metrics.marketValue, currency) : "—"}</span><small>成本 {currency === "USD" ? "$" : "¥"}{formatNumber(holding.cost, 3)}</small></> : <><strong>未设置</strong><span>记录后显示盈亏</span><button type="button" onClick={onEdit}>＋ 添加持仓</button></>}
      </div>
      <div className={styles.klineCell}>
        {quote.status === "loading" && !quote.candles.length ? <div className={styles.chartSkeleton} /> : quote.candles.length ? <MiniKline candles={quote.candles.slice(-60)} /> : <span className={styles.noChart}>K 线待更新</span>}
        <small>{quote.date ? `${quote.date.slice(5)} · ${quote.source}` : "近 60 日"}</small>
      </div>
      <div className={styles.marketCell}>
        <div><span>高 / 低</span><strong>{quote.high == null || quote.low == null ? "—" : `${formatNumber(quote.high, 2)} / ${formatNumber(quote.low, 2)}`}</strong></div>
        <div><span>量 / 换手</span><strong>{quote.volume == null ? "—" : `${compactNumber(quote.volume)} / ${quote.turnoverPct == null ? "—" : `${formatNumber(quote.turnoverPct, 2)}%`}`}</strong></div>
        {dayProfit != null ? <small className={toneClass(dayProfit)}>今日持仓 {signedCurrency(dayProfit, currency)}</small> : null}
      </div>
      <div className={styles.rowActions}>
        <button type="button" onClick={onEdit} aria-label={`编辑 ${stock.name} 的持仓`} title="编辑持仓"><EditIcon /></button>
        <button type="button" onClick={onRemove} aria-label={`移除 ${stock.name}`} title="移除自选"><TrashIcon /></button>
        <span aria-hidden="true">›</span>
      </div>
    </article>
  );
}

function CapitalFlowCell({ intent, quoteDate, loading, currency }: { intent: IntentAnalysis | null; quoteDate: string; loading: boolean; currency: StockCurrency }) {
  if (!intent) {
    return <div className={styles.capitalCell}><span>今日资金</span><strong>—</strong><small>{loading ? "估算中" : "暂无可用数据"}</small></div>;
  }
  const direction = intent.activeNetAmount > 0 ? "流入" : intent.activeNetAmount < 0 ? "流出" : "持平";
  const basisLabel = intent.basis === "level1" ? "主动买卖估算" : "量价模型估算";
  const periodLabel = !quoteDate || intent.date === quoteDate ? "今日" : intent.date.slice(5);
  return (
    <div className={styles.capitalCell} title={`${basisLabel} · 置信度 ${intent.confidence}% · ${intent.label}`}>
      <span>{periodLabel}{intent.basis === "level1" ? "主动净额" : "量价净额"}</span>
      <strong className={toneClass(intent.activeNetAmount)}>{direction} {formatCapitalAmount(intent.activeNetAmount, currency)}</strong>
      <small>{currencyName(currency)}口径 · {basisLabel} · 置信 {intent.confidence}%</small>
    </div>
  );
}

function WatchlistScoreBadge({
  prediction,
  predictionStatus,
  scoreReport,
  stockName,
  hasHolding,
  onOpen,
  onEdit,
}: {
  prediction: NextDayPredictionReport | null;
  predictionStatus: QuoteStatus;
  scoreReport: StockScoreReport | null;
  stockName: string;
  hasHolding: boolean;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();
  const conclusion = prediction ? buildPortfolioPredictionConclusion(prediction) : null;
  const predictionToneClass = conclusion ? {
    hold: styles.predictionHold,
    reduce: styles.predictionReduce,
    takeProfit: styles.predictionTakeProfit,
    stopLoss: styles.predictionStopLoss,
  }[conclusion.tone] : styles.predictionHold;

  const showDetails = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(330, window.innerWidth - 24);
      const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
      const top = rect.bottom + 9 + 430 > window.innerHeight ? Math.max(12, rect.top - 439) : rect.bottom + 9;
      setPopoverPosition({ left, top });
    }
    setDetailsVisible(true);
  };

  return (
    <div
      ref={anchorRef}
      className={styles.scoreCell}
      onMouseEnter={showDetails}
      onMouseLeave={() => setDetailsVisible(false)}
      onFocusCapture={showDetails}
      onBlurCapture={() => setDetailsVisible(false)}
      onClick={(event) => event.stopPropagation()}
    >
      {prediction && conclusion ? (
        <button
          className={`${styles.scoreBadge} ${predictionToneClass}`}
          type="button"
          aria-describedby={detailsVisible ? popoverId : undefined}
          aria-expanded={detailsVisible}
          aria-label={`${stockName} 明日预测结论：${conclusion.action}，上涨概率 ${probabilityPercent(prediction.prediction.upProbability)}，决策可信度 ${prediction.signal.decisionConfidence}%`}
          onPointerUp={(event) => {
            if (event.pointerType !== "touch") return;
            if (detailsVisible) setDetailsVisible(false);
            else showDetails();
          }}
        >
          <b className={styles.signalMark} aria-hidden="true">{conclusion.mark}</b>
          <span><strong>{conclusion.action}</strong><small>上涨 {probabilityPercent(prediction.prediction.upProbability)} · 可信 {prediction.signal.decisionConfidence}%</small></span>
        </button>
      ) : (
        <div className={`${styles.scoreSkeleton} ${predictionStatus === "error" ? styles.predictionUnavailable : ""}`}>
          <i />
          <span>{predictionStatus === "error" ? "预测暂不可用" : "预测计算中"}</span>
        </div>
      )}
      <div className={styles.signalActions}>
        <button type="button" onClick={onOpen} aria-label={`查看 ${stockName} 的完整明日预测依据`}>完整预测</button>
        <button type="button" onClick={onEdit} aria-label={`${hasHolding ? "调整" : "记录"} ${stockName} 的持仓`}>{hasHolding ? "调持仓" : "记持仓"}</button>
      </div>
      {detailsVisible && prediction && conclusion && popoverPosition ? createPortal((
        <div className={styles.scorePopover} id={popoverId} role="tooltip" style={popoverPosition}>
          <header><div><span>NEXT SESSION PREDICTION</span><strong>{stockName} · {prediction.target.label}</strong></div><b>{conclusion.action}</b></header>
          <p>{prediction.decisionSupport.summary}</p>
          <div className={styles.predictionMetrics}>
            <div><span>上涨概率</span><strong>{probabilityPercent(prediction.prediction.upProbability)}</strong></div>
            <div><span>预期收盘</span><strong>{signedPercent(prediction.prediction.expectedCloseReturn * 100)}</strong></div>
            <div><span>决策可信度</span><strong>{prediction.signal.decisionConfidence}%</strong></div>
            <div><span>模型一致度</span><strong>{probabilityPercent(prediction.signal.ensembleAgreement)}</strong></div>
          </div>
          <div className={styles.predictionLevels}>
            <span>止盈观察 <strong>{formatNumber(prediction.decisionSupport.takeProfitReference, 2)}</strong></span>
            <span>风险观察 <strong>{formatNumber(prediction.decisionSupport.riskReference, 2)}</strong></span>
          </div>
          <ul className={styles.predictionChecks}>{prediction.decisionSupport.checks.map((check) => <li key={check}>{check}</li>)}</ul>
          <footer>
            截至 {prediction.asOf} {prediction.asOfTime} · {prediction.externalContext.market.available ? "大盘已覆盖" : "大盘缺失"} · {prediction.externalContext.news.itemCount ? `${prediction.externalContext.news.itemCount} 条消息` : "消息缺失"} · {prediction.modelValidation.panelEnabled ? "面板 ML" : prediction.modelValidation.mlEnabled ? "个股 ML" : "统计模型"} · 综合研究 {scoreReport?.score ?? "—"} 分
          </footer>
        </div>
      ), document.body) : null}
    </div>
  );
}

function MiniKline({ candles }: { candles: Candle[] }) {
  const width = 176;
  const height = 56;
  const padding = 3;
  const minimum = Math.min(...candles.map((candle) => candle.low));
  const maximum = Math.max(...candles.map((candle) => candle.high));
  const range = Math.max(maximum - minimum, 0.001);
  const step = (width - padding * 2) / Math.max(candles.length, 1);
  const y = (value: number) => padding + ((maximum - value) / range) * (height - padding * 2);
  const bodyWidth = Math.max(1, Math.min(2.4, step * 0.62));
  return (
    <svg className={styles.miniKline} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`近 ${candles.length} 日 K 线`} preserveAspectRatio="none">
      <line className={styles.midline} x1="0" y1={height / 2} x2={width} y2={height / 2} />
      {candles.map((candle, index) => {
        const x = padding + step * index + step / 2;
        const up = candle.close >= candle.open;
        const bodyY = Math.min(y(candle.open), y(candle.close));
        const bodyHeight = Math.max(1, Math.abs(y(candle.open) - y(candle.close)));
        return (
          <g key={candle.key} className={up ? styles.candleUp : styles.candleDown}>
            <line x1={x} y1={y(candle.high)} x2={x} y2={y(candle.low)} />
            <rect x={x - bodyWidth / 2} y={bodyY} width={bodyWidth} height={bodyHeight} rx="0.4" />
          </g>
        );
      })}
    </svg>
  );
}

function formatCurrency(value: number, currency: StockCurrency = "CNY"): string {
  if (!Number.isFinite(value)) return "—";
  return `${currency === "USD" ? "$" : "¥"}${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedCurrency(value: number, currency: StockCurrency = "CNY"): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${currency === "USD" ? "$" : "¥"}${Math.abs(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMixedCurrencyTotals(totals: ReturnType<typeof calculatePortfolioTotals>["byCurrency"], key: "costValue" | "marketValue" | "profit" | "dayProfit", signed = false): string {
  return (["CNY", "USD"] as StockCurrency[])
    .filter((currency) => totals[currency].costValue > 0 || totals[currency][key] !== 0)
    .map((currency) => signed ? signedCurrency(totals[currency][key], currency) : formatCurrency(totals[currency][key], currency))
    .join(" · ") || "—";
}

function signedPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function probabilityPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${formatNumber(value * 100, 0)}%`;
}

function formatMarketValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatShares(value: number): string {
  if (value >= 100_000_000) return `${formatNumber(value / 100_000_000, 2)} 亿股`;
  if (value >= 10_000) return `${formatNumber(value / 10_000, 2)} 万股`;
  return `${value.toLocaleString("zh-CN")} 股`;
}

function currencyName(currency: StockCurrency): string {
  return currency === "USD" ? "美元" : "人民币";
}

function toneClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return styles.neutral;
  return value > 0 ? styles.positive : styles.negative;
}

function fearToneClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return styles.neutral;
  if (value >= 30) return styles.positive;
  if (value <= 18) return styles.negative;
  return styles.neutral;
}

function RefreshIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.7 6.5A6.2 6.2 0 1 0 16.2 12M15.7 6.5V2.8m0 3.7H12" /></svg>;
}

function ImportIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8M4 14.2v2h12v-2" /></svg>;
}

function ExportIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V4m0 0 3.2 3.2M10 4 6.8 7.2M4 14.2v2h12v-2" /></svg>;
}

function EditIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.8 4.1 3.1 3.1M4 16l.8-3.6 8.4-8.4a1.3 1.3 0 0 1 1.8 0l1 1a1.3 1.3 0 0 1 0 1.8l-8.4 8.4L4 16Z" /></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6.2h11M8 3.7h4M6.2 6.2l.6 9.1c0 .6.5 1 1.1 1h4.2c.6 0 1.1-.4 1.1-1l.6-9.1M8.4 8.7v4.8m3.2-4.8v4.8" /></svg>;
}
