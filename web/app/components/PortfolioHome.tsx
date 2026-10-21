"use client";

import { accountStorage } from "../lib/accountStorage";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  aggregateCandles,
  analyzeMarketIntent,
  calculateIndicators,
  formatNumber,
  parseMarketCsv,
  type Candle,
} from "../lib/market";
import { parseNewsCsv, type NewsItem } from "../lib/news";
import { buildNextDayPrediction } from "../lib/nextDayPrediction";
import { emptyFinancialDataset } from "../lib/financials";
import {
  exportHoldingsCsv,
  parseHoldings,
  parseHoldingsCsv,
  type StockHolding,
  type StockHoldings,
} from "../lib/holdings";
import type { GlobalIndexFeed } from "../lib/globalIndexes";
import type { RealtimeSnapshot } from "../lib/realtimeMarket";
import { createPortfolioRealtimePoller } from "../lib/portfolioRealtimePoller";
import { backtestGuideSignals, calculateRiskMetrics } from "../lib/research";
import { buildStockScore } from "../lib/stockScore";
import {
  buildPortfolioStocks,
  calculatePortfolioTotals,
  convertPortfolioTotalsToCny,
  parseWatchlist,
  upsertWatchlistStock,
  type WatchlistStock,
} from "../lib/watchlist";
import {
  buildPortfolioInsights,
  sortPortfolioWatchlist,
  type PortfolioInsightSummary,
  type PortfolioSortKey,
} from "../lib/portfolioPresentation";
import PortfolioStockList from "../features/portfolio/PortfolioStockList";
import type { PortfolioQuote } from "../features/portfolio/types";
import { formatCurrency, signedCurrency, signedPercent, currencyName } from "../features/portfolio/formatting";
import { useAppearance } from "./AppearanceProvider";
import SiteBanner from "./SiteBanner";
import PortfolioWorkbenchSummary from "./PortfolioWorkbenchSummary";
import PortfolioEarnings from "./PortfolioEarnings";
import { usePortfolioEarningsRecorder } from "../hooks/usePortfolioEarningsRecorder";
import { useWorkspaceView } from "../hooks/useWorkspaceView";
import { WorkspaceTabs, WorkspacePanel } from "./WorkspaceTabs";
import styles from "./PortfolioHome.module.css";
import { currencyOf, marketLabel, marketOf, stockRouteKey, stockStorageKey, type StockMarket } from "../lib/security";

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
  partial: false,
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
  newsItems: [],
  newsStatus: "idle",
  newsError: "",
  technicalSignal: null,
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

const portfolioViews = ["watchlist", "holdings", "earnings", "review"] as const;
const portfolioAnchors = { watchlist: "watchlist", "portfolio-overview": "holdings", "portfolio-decisions": "review" } as const;

export default function PortfolioHome({ onOpenStock }: { onOpenStock: (code: string, view?: "models") => void }) {
  const { appearance, toggleAppearance } = useAppearance();
  const [watchlist, setWatchlist] = useState<WatchlistStock[]>([]);
  const [holdings, setHoldings] = useState<StockHoldings>({});
  const portfolioStocks = useMemo(() => buildPortfolioStocks(watchlist, holdings), [watchlist, holdings]);
  const [quotes, setQuotes] = useState<Record<string, PortfolioQuote>>({});
  const [hydrated, setHydrated] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [editor, setEditor] = useState<PositionEditor | null>(null);
  const [removedStock, setRemovedStock] = useState<RemovedStock | null>(null);
  const [notice, setNotice] = useState("");
  const [sortBy, setSortBy] = useState<PortfolioSortKey>("custom");
  const [lastRealtimeRefresh, setLastRealtimeRefresh] = useState("");
  const [globalFeed, setGlobalFeed] = useState<GlobalFeedState>({ status: "loading", data: null, error: "" });
  const [fxPreference, setFxPreference] = useState<FxPreference>({ enabled: true, usdCny: "7.20", updatedAt: "" });
  const [workspaceView, setWorkspaceView] = useWorkspaceView(portfolioViews, "watchlist", "view", portfolioAnchors);
  const earningsRecorder = usePortfolioEarningsRecorder(holdings, quotes, hydrated);
  const [realtimePoller] = useState(() => createPortfolioRealtimePoller());
  const globalRequestRef = useRef<AbortController | null>(null);
  const holdingsFileRef = useRef<HTMLInputElement | null>(null);
  const positionModalRef = useRef<HTMLFormElement | null>(null);
  const positionEditorInitialFocusRef = useRef<HTMLInputElement | null>(null);
  const editorRestoreFocusRef = useRef<HTMLElement | null>(null);
  const editorOpen = editor !== null;

  useEffect(() => {
    let storedWatchlist: WatchlistStock[] = [];
    let storedHoldings: StockHoldings = {};
    let storedFxPreference: FxPreference = { enabled: true, usdCny: "7.20", updatedAt: "" };
    try {
      storedWatchlist = parseWatchlist(JSON.parse(accountStorage.getItem(watchlistStorageKey) ?? "[]"));
    } catch {
      accountStorage.removeItem(watchlistStorageKey);
    }
    try {
      storedHoldings = parseHoldings(JSON.parse(accountStorage.getItem(holdingsStorageKey) ?? "[]"));
    } catch {
      accountStorage.removeItem(holdingsStorageKey);
    }
    try {
      const parsed = JSON.parse(accountStorage.getItem(fxPreferenceStorageKey) ?? "null") as Partial<FxPreference> | null;
      const rate = Number(parsed?.usdCny);
      if (parsed && Number.isFinite(rate) && rate > 0 && rate < 20) {
        storedFxPreference = {
          enabled: true,
          usdCny: String(parsed.usdCny),
          updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
        };
      }
    } catch {
      accountStorage.removeItem(fxPreferenceStorageKey);
    }
    const frame = window.requestAnimationFrame(() => {
      setWatchlist(storedWatchlist);
      setHoldings(storedHoldings);
      setFxPreference(storedFxPreference);
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      accountStorage.setItem(watchlistStorageKey, JSON.stringify(watchlist));
    } catch {
      // The in-memory watchlist remains usable while database synchronization is pending.
    }
  }, [hydrated, watchlist]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      accountStorage.setItem(holdingsStorageKey, JSON.stringify(Object.values(holdings)));
    } catch {
      // The in-memory holdings remain usable while database synchronization is pending.
    }
  }, [holdings, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      accountStorage.setItem(fxPreferenceStorageKey, JSON.stringify(fxPreference));
    } catch {
      // The explicit conversion remains usable for the current session.
    }
  }, [fxPreference, hydrated]);

  const loadNews = useCallback(async (stock: WatchlistStock, signal: AbortSignal): Promise<NewsItem[]> => {
    const key = stockStorageKey(stock);
    const market = marketOf(stock);
    setQuotes((current) => current[key] ? ({
      ...current,
      [key]: { ...current[key], newsStatus: "loading", newsError: "" },
    }) : current);
    try {
      const response = await fetch(market === "US" ? "/api/us-stock-news" : "/api/local-stock-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: stock.code, limit: 24 }),
        signal,
      });
      const body = await response.text();
      if (!response.ok) throw new Error("消息面获取失败");
      const newsItems = parseNewsCsv(body).items;
      if (!signal.aborted) {
        setQuotes((current) => current[key] ? ({
          ...current,
          [key]: { ...current[key], newsItems, newsStatus: "ready", newsError: "" },
        }) : current);
      }
      return newsItems;
    } catch (reason) {
      if (!signal.aborted) {
        setQuotes((current) => current[key] ? ({
          ...current,
          [key]: { ...current[key], newsStatus: "error", newsError: "消息面获取失败" },
        }) : current);
      }
      throw reason;
    }
  }, []);

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
        newsStatus: "loading",
        newsError: "",
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
      let technicalSignal: PortfolioQuote["technicalSignal"] = null;
      for (let index = indicators.guidePoints.length - 1; index >= Math.max(0, indicators.guidePoints.length - 5); index -= 1) {
        const guide = indicators.guidePoints[index];
        const candle = candles[index];
        if (!guide || guide.confidence === "watch" || !candle) continue;
        technicalSignal = {
          side: guide.type === "buy" ? "B" : "S",
          date: candle.date,
          price: candle.close,
          score: guide.score,
          reasons: guide.reasons,
        };
        break;
      }
      return { candles, indicators, intent, technicalSignal, dataQuality: dataset.quality };
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
    const newsRequest = loadNews(stock, signal);
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
          partial: false,
          error: `${marketError}；${realtimeError}`,
          predictionStatus: "error",
          prediction: null,
          technicalSignal: null,
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
      partial: marketResult.status === "rejected" || realtimeResult.status === "rejected",
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
      source: realtime?.source ?? (market === "US" ? "新浪美股日K" : "新浪公开日K"),
      error: marketResult.status === "rejected" || realtimeResult.status === "rejected" ? "部分数据源暂不可用" : "",
      score: null,
      intent: marketResult.status === "fulfilled" ? marketResult.value.intent : null,
      predictionStatus: marketResult.status === "fulfilled" ? "loading" : "error",
      prediction: null,
      newsItems: [],
      newsStatus: "loading",
      newsError: "",
      technicalSignal: marketResult.status === "fulfilled" ? marketResult.value.technicalSignal : null,
    };
    setQuotes((current) => ({
      ...current,
      [key]: {
        ...quote,
        newsItems: current[key]?.newsItems ?? [],
        newsStatus: current[key]?.newsStatus ?? "loading",
        newsError: current[key]?.newsError ?? "",
      },
    }));

    const [newsResult, benchmarkResult] = await contextRequest;
    if (signal.aborted) return;
    const newsItems: NewsItem[] = newsResult.status === "fulfilled" ? newsResult.value : [];
    const benchmark = benchmarkResult.status === "fulfilled" ? benchmarkResult.value : null;
    if (marketResult.status !== "fulfilled") return;
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
          market,
          code: stock.code,
          name: stock.name,
          costModel: "liquidity",
          positionValue: 80_000,
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
          newsItems: newsResult.status === "fulfilled" ? newsItems : current[key].newsItems,
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
  }, [loadNews]);

  const refreshRealtimeQuotes = useCallback(async () => {
    if (!portfolioStocks.length || document.hidden) return;
    await realtimePoller.refresh(portfolioStocks, {
      onQuote: (stock, realtime) => {
        const key = stockStorageKey(stock);
        setQuotes((current) => {
          const previous = current[key] ?? emptyQuote;
          return {
            ...current,
            [key]: {
              ...previous,
              status: "ready",
              partial: previous.candles.length === 0,
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
              source: realtime.source || previous.source,
              error: "",
            },
          };
        });
        setLastRealtimeRefresh(new Date().toISOString());
      },
      onError: (stock) => {
        const key = stockStorageKey(stock);
        setQuotes((current) => current[key]?.status === "ready" ? {
          ...current,
          [key]: { ...current[key], error: "本次实时刷新暂不可用" },
        } : current);
      },
    });
  }, [realtimePoller, portfolioStocks]);

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
    if (!hydrated || portfolioStocks.length === 0) return;
    const controller = new AbortController();
    const loadInBatches = async () => {
      for (let index = 0; index < portfolioStocks.length && !controller.signal.aborted; index += 4) {
        await Promise.allSettled(portfolioStocks.slice(index, index + 4).map((stock) => loadQuote(stock, controller.signal)));
      }
    };
    void loadInBatches();
    return () => controller.abort();
  }, [hydrated, loadQuote, refreshVersion, portfolioStocks]);

  useEffect(() => {
    if (!hydrated || portfolioStocks.length === 0) return;
    const timer = window.setInterval(() => void refreshRealtimeQuotes(), 5_000);
    const refreshWhenVisible = () => { if (!document.hidden) void refreshRealtimeQuotes(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      realtimePoller.abort();
    };
  }, [hydrated, realtimePoller, refreshRealtimeQuotes, portfolioStocks.length]);

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
    if (holdings[key]) {
      setHoldings((current) => current[key] ? { ...current, [key]: { ...current[key], name: stock.name } } : current);
    } else {
      setQuotes((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
    setRemovedStock({ stock, index: Math.max(0, index) });
    setNotice(`已从自选股移除 ${stock.name}。${holdings[key] ? "持仓仍保留在组合中。" : ""}`);
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
      name: editor.stock.name,
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
    const key = stockStorageKey(editor.stock);
    setHoldings((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (!watchlist.some((stock) => stockStorageKey(stock) === key)) {
      setQuotes((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
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
      setNotice(`已从 CSV 导入 ${imported.stocks.length} 条持仓，并提交到账户数据库。`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "持仓 CSV 导入失败");
    } finally {
      if (holdingsFileRef.current) holdingsFileRef.current.value = "";
    }
  };

  const sortedWatchlist = useMemo(
    () => sortPortfolioWatchlist(workspaceView === "holdings" ? portfolioStocks.filter((stock) => holdings[stockStorageKey(stock)]) : watchlist, holdings, quotes, sortBy),
    [holdings, quotes, sortBy, portfolioStocks, watchlist, workspaceView],
  );

  const totals = useMemo(() => calculatePortfolioTotals(
    portfolioStocks,
    holdings,
    Object.fromEntries(Object.entries(quotes).map(([code, quote]) => [code, { price: quote.price, change: quote.change }])),
  ), [holdings, quotes, portfolioStocks]);
  const portfolioInsights = useMemo(
    () => buildPortfolioInsights(portfolioStocks, holdings, quotes),
    [holdings, quotes, portfolioStocks],
  );

  const loadingCount = portfolioStocks.filter((stock) => quotes[stockStorageKey(stock)]?.status === "loading").length;
  const readyCount = portfolioStocks.filter((stock) => quotes[stockStorageKey(stock)]?.status === "ready").length;
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
        <header className={styles.workspaceHeading}>
          <div>
            <p>MY WORKSPACE</p>
            <h1>我的工作台</h1>
          </div>
          <span>先核验数据，再判断机会</span>
        </header>
        <WorkspaceTabs id="portfolio" label="工作台视图" value={workspaceView} onChange={setWorkspaceView} tabs={[
          { id: "watchlist", label: "自选", panel: "positions", count: watchlist.length },
          { id: "holdings", label: "持仓", panel: "positions", count: Object.keys(holdings).length },
          { id: "earnings", label: "收益记录" },
          { id: "review", label: "研究复核" },
        ]} />

        {hydrated && portfolioStocks.length === 0 && workspaceView === "watchlist" ? (
          <section className={styles.getStarted} aria-labelledby="portfolio-get-started">
            <div>
              <h2 id="portfolio-get-started">从一只关注的股票开始</h2>
              <p>搜索名称或代码，查看行情并加入自选。支持沪深 A 股与美股。</p>
            </div>
            <button type="button" onClick={() => window.dispatchEvent(new Event("trendsight:open-search"))}>搜索第一只股票 <span aria-hidden="true">↗</span></button>
          </section>
        ) : null}

        <WorkspacePanel id="portfolio" view="earnings" active={workspaceView}>
          <PortfolioEarnings holdings={holdings} recorder={earningsRecorder} />
        </WorkspacePanel>
        <WorkspacePanel id="portfolio" view="review" active={workspaceView}>
          <div id="portfolio-decisions" tabIndex={-1}>
            <PortfolioWorkbenchSummary watchlist={portfolioStocks} holdings={holdings} quotes={quotes} onOpenStock={onOpenStock} onAddStock={addResolvedStock} onRetryNews={async (stock) => { await loadNews(stock, new AbortController().signal); }} />
            <PortfolioDecisionBrief summary={portfolioInsights} />
            <GlobalMarketPulse feed={globalFeed} onRetry={() => void loadGlobalFeed()} />
          </div>
        </WorkspacePanel>
        <WorkspacePanel id="portfolio" panel="positions" view={workspaceView === "holdings" ? "holdings" : "watchlist"} active={workspaceView}>
          <div id="portfolio-overview" className={styles.holdingsOverview} hidden={workspaceView !== "holdings"} tabIndex={-1}>
            <FxConversionPanel totals={totals} preference={fxPreference} latestUpdate={latestUpdate} readyCount={readyCount} onChange={setFxPreference} />
          </div>
        <section className={`${styles.watchlistCard} ${styles.chapterAnchor}`} id="watchlist" tabIndex={-1}>
          <header className={styles.listHeader}>
            <div>
              <p>PORTFOLIO</p>
              <h2>{workspaceView === "holdings" ? "我的持仓" : "我的自选股"}</h2>
              <span>{sortedWatchlist.length ? `${sortedWatchlist.length} 只股票 · 价格每 5 秒刷新` : workspaceView === "holdings" ? "账户持仓独立保存，不受移除自选影响" : "搜索或添加股票，集中跟踪行情与研究结论"}</span>
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
              {workspaceView === "holdings" ? <><button type="button" onClick={() => holdingsFileRef.current?.click()} title="导入持仓 CSV"><ImportIcon />导入持仓</button>
              <button type="button" onClick={exportPositions} title="导出可编辑的持仓 CSV"><ExportIcon />导出持仓</button></> : null}
              <button type="button" onClick={() => setRefreshVersion((value) => value + 1)} disabled={!portfolioStocks.length || loadingCount > 0}>
                <RefreshIcon />{loadingCount ? "更新中" : "刷新行情"}
              </button>
            </div>
          </header>

          {sortedWatchlist.length ? (
            <PortfolioStockList view={workspaceView === "holdings" ? "holdings" : "watchlist"} stocks={sortedWatchlist} quotes={quotes} holdings={holdings} emptyQuote={emptyQuote} onOpen={(stock) => onOpenStock(stockRouteKey(stock))} onOpenPrediction={(stock) => onOpenStock(stockRouteKey(stock), "models")} onEdit={openEditor} onRemove={removeStock} onRetry={(stock) => void loadQuote(stock, new AbortController().signal)} />
          ) : (
            <div className={styles.emptyState}>
              <div className={styles.emptyArtwork} aria-hidden="true"><i /><i /><i /><span>＋</span></div>
              <h3>{workspaceView === "holdings" ? "尚未记录持仓" : "建立你的第一份自选列表"}</h3>
              <p>{workspaceView === "holdings" ? "从自选列表编辑持仓，或导入已有持仓 CSV。" : "搜索并收藏股票，查看预测、趋势与实时行情。"}</p>
              {workspaceView === "watchlist" ? <div className={styles.exampleStocks}>
                {searchExamples.map((item) => <button key={item.code} type="button" onClick={() => addResolvedStock({ code: item.code, name: item.label, addedAt: new Date().toISOString() })}><strong>{item.label}</strong><span>{item.code}</span><em>＋</em></button>)}
              </div> : null}
            </div>
          )}
        </section>
        </WorkspacePanel>

        <footer className={styles.footer}>
          <span>持仓同步到账户数据库；预测基于历史 K 线、大盘与消息面概率计算，行情与结论可能存在延迟。</span>
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
  latestUpdate,
  readyCount,
  onChange,
}: {
  totals: ReturnType<typeof calculatePortfolioTotals>;
  preference: FxPreference;
  latestUpdate: string;
  readyCount: number;
  onChange: (value: FxPreference) => void;
}) {
  const [returnMarket, setReturnMarket] = useState("TOTAL");
  const rate = Number(preference.usdCny);
  const validRate = Number.isFinite(rate) && rate > 0 && rate < 20;
  const converted = convertPortfolioTotalsToCny(totals.byCurrency, rate);
  const cny = totals.byCurrency.CNY;
  const usd = totals.byCurrency.USD;
  const cnyReady = cny.costValue > 0 || cny.marketValue > 0;
  const usdReady = usd.costValue > 0 || usd.marketValue > 0;
  const aggregateReady = converted != null && (cnyReady || usdReady);
  const updateTime = preference.updatedAt && !Number.isNaN(Date.parse(preference.updatedAt))
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(preference.updatedAt))
    : "默认值";
  const rateSource = preference.updatedAt ? "用户输入" : "默认设定";
  const marketCards = [
    { key: "CNY", title: "A 股", subtitle: "人民币资产", badge: "A", totals: cny, ready: cnyReady, currency: "CNY" as const },
    { key: "USD", title: "美股", subtitle: "美元资产", badge: "US", totals: usd, ready: usdReady, currency: "USD" as const },
  ];

  return (
    <section className={styles.returnsSummary} aria-labelledby="portfolio-returns-title">
      <header className={styles.returnsHeader}>
        <div>
          <p>PORTFOLIO RETURNS</p>
          <h2 id="portfolio-returns-title">收益汇总</h2>
          <small>A 股与美股先按原币核算，再统一折算为人民币。</small>
        </div>
        <div className={styles.returnsHeaderMeta}>
          <span>{totals.positioned} 只持仓</span>
          <span>{totals.tracked} 只跟踪</span>
          <span>{readyCount} 只行情就绪</span>
        </div>
        <label className={`${styles.fxRateField} ${validRate ? "" : styles.fxRateInvalid}`}>
          <span>美元兑人民币</span>
          <div><b>USD/CNY</b><input inputMode="decimal" aria-label="美元兑人民币汇率" value={preference.usdCny} onChange={(event) => onChange({ ...preference, enabled: true, usdCny: event.target.value, updatedAt: new Date().toISOString() })} /></div>
          <small>{validRate ? `${rateSource} · ${updateTime}` : "请输入 0–20 之间的有效汇率"}</small>
        </label>
      </header>

      <nav className={styles.returnMarketSwitch} aria-label="收益汇总币种">
        {[["TOTAL", "人民币总计"], ["CNY", "A 股"], ["USD", "美股"]].map(([key, label]) => (
          <button key={key} type="button" aria-pressed={returnMarket === key} onClick={() => setReturnMarket(key)}>{label}</button>
        ))}
      </nav>
      <div className={styles.returnsMarkets}>
        {marketCards.map((market) => (
          <article className={styles.marketReturnCard} key={market.key} data-active={returnMarket === market.key}>
            <header>
              <span className={`${styles.marketBadge} ${market.currency === "USD" ? styles.marketBadgeUsd : styles.marketBadgeCny}`}>{market.badge}</span>
              <div><h3>{market.title}</h3><small>{market.subtitle}</small></div>
              <em>{market.key}</em>
            </header>
            <div className={styles.returnPrimary}>
              <small>持仓市值</small>
              <strong>{market.ready ? formatCurrency(market.totals.marketValue, market.currency) : "—"}</strong>
              <span>成本 {market.ready ? formatCurrency(market.totals.costValue, market.currency) : "—"}</span>
            </div>
            <dl className={styles.returnDetails}>
              <div><dt>累计收益</dt><dd className={market.ready ? toneClass(market.totals.profit) : styles.neutral}>{market.ready ? signedCurrency(market.totals.profit, market.currency) : "—"}<small>{market.ready ? signedPercent(market.totals.profitPct) : "—"}</small></dd></div>
              <div><dt>今日持仓盈亏</dt><dd className={market.ready ? toneClass(market.totals.dayProfit) : styles.neutral}>{market.ready ? signedCurrency(market.totals.dayProfit, market.currency) : "—"}</dd></div>
            </dl>
          </article>
        ))}

        <article className={`${styles.marketReturnCard} ${styles.totalReturnCard}`} data-active={returnMarket === "TOTAL"}>
          <header>
            <span className={`${styles.marketBadge} ${styles.totalBadge}`}>¥</span>
            <div><h3>人民币总计</h3><small>A 股 + 美股折算</small></div>
            <em>CNY</em>
          </header>
          <div className={styles.returnPrimary}>
            <small>组合总市值</small>
            <strong>{aggregateReady ? formatCurrency(converted!.marketValue, "CNY") : "—"}</strong>
            <span>折算成本 {aggregateReady ? formatCurrency(converted!.costValue, "CNY") : "—"}</span>
          </div>
          <dl className={styles.returnDetails}>
            <div><dt>累计收益</dt><dd className={aggregateReady ? toneClass(converted!.profit) : styles.neutral}>{aggregateReady ? signedCurrency(converted!.profit, "CNY") : "—"}<small>{aggregateReady ? signedPercent(converted!.profitPct) : "—"}</small></dd></div>
            <div><dt>今日持仓盈亏</dt><dd className={aggregateReady ? toneClass(converted!.dayProfit) : styles.neutral}>{aggregateReady ? signedCurrency(converted!.dayProfit, "CNY") : "—"}</dd></div>
          </dl>
        </article>
      </div>

      <footer className={styles.returnsFormula}>
        <div><b>换算</b><span>A 股人民币金额 + 美股美元金额 × {validRate ? preference.usdCny : "有效汇率"}</span></div>
        <small>{latestUpdate ? `行情截至 ${latestUpdate.slice(0, 16)} · ` : ""}汇率来源：{rateSource} · 更新 {updateTime} · 仅影响展示，不改写原始持仓</small>
      </footer>
    </section>
  );
}

function PortfolioDecisionBrief({ summary }: { summary: PortfolioInsightSummary }) {
  const dataHeadline = summary.tracked ? `${summary.completionPct}% 行情可用` : "等待建立自选";
  const reviewCount = summary.validation.partial + summary.validation.warning;
  const dataDetail = summary.tracked
    ? `${summary.ready}/${summary.tracked} 只可用${summary.failed ? ` · ${summary.failed} 只失败` : ""} · ${summary.validation.verified} 只通过 3 项一致性校验${reviewCount ? ` · ${reviewCount} 只待复核` : ""}${summary.latestUpdate ? ` · 最新 ${summary.latestUpdate.slice(5, 16)}` : ""}`
    : "添加股票后会显示来源、时效与完整度";
  const performanceHeadline = summary.bestHolding
    ? `${summary.bestHolding.stockName} · 持仓累计 ${signedPercent(summary.bestHolding.valuePct)}`
    : summary.strongestMove
      ? `${summary.strongestMove.stockName} · 当日波动 ${signedPercent(summary.strongestMove.valuePct)}`
      : "等待收益与波动数据";
  const riskDetails = [
    summary.highestConcentration
      ? `集中度：${summary.highestConcentration.topStockName} 占${currencyName(summary.highestConcentration.currency)}子组合 ${formatNumber(summary.highestConcentration.topWeightPct, 1)}%`
      : "尚无可计算的持仓集中度",
    summary.weakestHolding
      ? `最弱持仓：${summary.weakestHolding.stockName} ${signedPercent(summary.weakestHolding.valuePct)}`
      : "",
  ].filter(Boolean).join(" · ");
  const lead = summary.bestHolding;
  const leadQuoteTime = lead?.quoteDate
    ? `${lead.quoteDate.slice(5)}${lead.quoteTime ? ` ${lead.quoteTime.slice(0, 5)}` : ""}`
    : "时点待确认";
  const verificationLabel = lead?.verification.status === "verified"
    ? `${lead.verification.passedChecks}/${lead.verification.totalChecks} 项一致性校验通过`
    : lead
      ? `${lead.verification.passedChecks}/${lead.verification.totalChecks} 项通过 · 仍需复核`
      : "";
  const verificationIssue = lead?.verification.status === "verified" ? "" : lead?.verification.issues[0] ?? "";

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
          <small>{dataDetail}</small>
        </article>
        <article className={styles.performanceDecision}>
          <span>2 · 收益与风险线索</span>
          <strong>{performanceHeadline}</strong>
          {lead ? (
            <>
              <div className={styles.performanceMetrics}>
                <span><small>当日涨跌</small><b className={toneClass(lead.dayChangePct)}>{lead.dayChangePct == null ? "—" : signedPercent(lead.dayChangePct)}</b></span>
                <span><small>现价 / 成本</small><b>{formatCurrency(lead.price, lead.currency)} / {formatCurrency(lead.cost, lead.currency)}</b></span>
                <span><small>持仓盈亏</small><b className={toneClass(lead.profit)}>{signedCurrency(lead.profit, lead.currency)}</b></span>
              </div>
              <p className={styles.verificationLine}>
                <b className={lead.verification.status === "verified" ? styles.verified : styles.needsReview}>{verificationLabel}</b>
                <span>行情 {leadQuoteTime} · {lead.quoteSource || "来源待确认"}{verificationIssue ? ` · 提示：${verificationIssue}` : ""}</span>
              </p>
              <small className={styles.performanceNote}>复算口径：(现价 − 平均成本) ÷ 平均成本；成本录入 {lead.holdingUpdatedAt.slice(0, 10)}。未计手续费、税费、分红及公司行动。</small>
            </>
          ) : null}
          <small>{riskDetails}；风险判断保留原币口径，人民币总计仅采用顶部明确汇率。</small>
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
        <em>风险敞口不采用隐含汇率</em>
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

function formatMarketValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
