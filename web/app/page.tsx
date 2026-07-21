"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import MarketChart from "./components/MarketChart";
import RealtimeTradingPanel from "./components/RealtimeTradingPanel";
import FinancialDashboard from "./components/FinancialDashboard";
import ResearchDock from "./components/ResearchDock";
import SignalBacktestCard from "./components/SignalBacktestCard";
import AdvancedResearchPanel from "./components/AdvancedResearchPanel";
import CommandPalette, { type CommandItem } from "./components/CommandPalette";
import {
  aggregateCandles,
  analyzeKlineConclusion,
  analyzeMarketIntent,
  calculateIndicators,
  compactNumber,
  createDemoDataset,
  formatNumber,
  parseMarketCsv,
  type LowerIndicator,
  type ParsedDataset,
  type Timeframe,
} from "./lib/market";
import {
  emptyNewsDataset,
  parseNewsCsv,
  type NewsItem,
  type NewsSentiment,
  type ParsedNewsDataset,
} from "./lib/news";
import {
  emptyFinancialDataset,
  type FinancialDataset,
  type FinancialReport,
} from "./lib/financials";
import {
  backtestGuideSignals,
  buildChartEvents,
  buildResearchReport,
  calculateRiskMetrics,
  parseWatchlist,
  type ChartAnnotation,
  type SavedWorkspace,
  type WatchlistItem,
} from "./lib/research";
import { buildEventStudies, buildFactorProfile } from "./lib/advancedResearch";
import { readCachedText, writeCachedText } from "./lib/browserCache";
import { reportTelemetry } from "./lib/telemetry";
import type { RealtimeSnapshot } from "./lib/realtimeMarket";

const timeframes: Array<{ key: Timeframe; label: string }> = [
  { key: "1d", label: "日K" },
  { key: "60m", label: "60分" },
  { key: "30m", label: "30分" },
  { key: "15m", label: "15分" },
  { key: "5m", label: "5分" },
  { key: "1m", label: "1分" },
];

const lowerIndicators: LowerIndicator[] = ["VOL", "MACD", "KDJ", "RSI"];
const initialDataset = createDemoDataset();

type LoadPhase = "idle" | "loading" | "success" | "error";

type LoadState = {
  phase: LoadPhase;
  detail: string;
};

type RecentStock = {
  code: string;
  name: string;
  queriedAt: number;
};

type Appearance = "light" | "dark";

const stockCodePattern = /^(?:(?:sh|sz)\d{6}|\d{6}(?:\.(?:sh|sz))?)$/i;
const recentStocksStorageKey = "ticklens.recent-stocks.v1";
const watchlistStorageKey = "ticklens.watchlist.v1";
const workspaceStorageKey = "ticklens.saved-workspace.v1";
const appearanceStorageKey = "ticklens.appearance.v1";
const annotationsStorageKey = "ticklens.annotations.v1";
const viewModeStorageKey = "ticklens.view-mode.v1";
const maxRecentStocks = 8;
const requestTimeoutMs = 18_000;

function defaultRange(length: number, timeframe: Timeframe) {
  const visibleCount = timeframe === "1d" ? length : Math.min(length, 140);
  return { from: Math.max(0, length - visibleCount), to: Math.max(0, length - 1) };
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function resolveStockQuery(value: string, signal?: AbortSignal): Promise<{ code: string; name: string }> {
  if (stockCodePattern.test(value)) {
    return {
      code: value.replace(/^(?:sh|sz)/i, "").replace(/\.(?:sh|sz)$/i, ""),
      name: "",
    };
  }
  const response = await fetch("/api/local-stock-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: value }),
      signal,
    });
    const body = await response.text();
    let payload: { code?: unknown; name?: unknown; error?: unknown } = {};
    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      if (body.trim()) payload.error = body.trim();
    }
    if (!response.ok) throw new Error(String(payload.error || "没有找到匹配的沪深股票"));
    const code = String(payload.code ?? "").trim();
    const name = String(payload.name ?? "").trim();
    if (!/^\d{6}$/.test(code) || !name) throw new Error("股票名称查询返回了无效结果");
  return { code, name };
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "AbortError";
}

function parseRecentStocks(value: unknown): RecentStock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const stock = item as Partial<RecentStock>;
    const code = String(stock.code ?? "").trim();
    const name = String(stock.name ?? "").trim();
    const queriedAt = Number(stock.queriedAt);
    if (!/^\d{6}$/.test(code) || !name || !Number.isFinite(queriedAt)) return [];
    return [{ code, name, queriedAt }];
  }).slice(0, maxRecentStocks);
}

export default function Home() {
  const [dataset, setDataset] = useState<ParsedDataset>(initialDataset);
  const [benchmarkDataset, setBenchmarkDataset] = useState<ParsedDataset | null>(null);
  const [newsDataset, setNewsDataset] = useState<ParsedNewsDataset>(() => emptyNewsDataset());
  const [financialDataset, setFinancialDataset] = useState<FinancialDataset>(() => emptyFinancialDataset());
  const [marketSourceLabel, setMarketSourceLabel] = useState("演示行情");
  const [newsSourceLabel, setNewsSourceLabel] = useState("等待查询");
  const [financialSourceLabel, setFinancialSourceLabel] = useState("等待查询");
  const [marketLoad, setMarketLoad] = useState<LoadState>({
    phase: "success",
    detail: `${initialDataset.rows.length.toLocaleString("zh-CN")} 条演示分笔已就绪`,
  });
  const [newsLoad, setNewsLoad] = useState<LoadState>({
    phase: "idle",
    detail: "输入股票代码或名称后自动获取最新新闻",
  });
  const [financialLoad, setFinancialLoad] = useState<LoadState>({
    phase: "idle",
    detail: "输入股票后自动获取估值、分红与历史财报诊断",
  });
  const [realtimeLoad, setRealtimeLoad] = useState<LoadState>({ phase: "idle", detail: "输入股票后自动获取当前交易日分钟 K 线与五档盘口" });
  const [realtimeSnapshot, setRealtimeSnapshot] = useState<RealtimeSnapshot | null>(null);
  const [isDemo, setIsDemo] = useState(true);
  const [selectedCode, setSelectedCode] = useState("000001");
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [lowerIndicator, setLowerIndicator] = useState<LowerIndicator>("VOL");
  const [overlays, setOverlays] = useState({
    ma5: true,
    ma10: true,
    ma20: true,
    ema: false,
    boll: false,
    vwap: true,
    nineTurn: true,
    guides: true,
  });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [range, setRange] = useState(() =>
    defaultRange(aggregateCandles(initialDataset.rows, initialDataset.codes[0], "1d").length, "1d"),
  );
  const [error, setError] = useState("");
  const [queryText, setQueryText] = useState("");
  const [stockSuggestion, setStockSuggestion] = useState<{ code: string; name: string } | null>(null);
  const [recentStocks, setRecentStocks] = useState<RecentStock[]>([]);
  const [fetchingStock, setFetchingStock] = useState(false);
  const [newsFilter, setNewsFilter] = useState<"全部" | NewsSentiment>("全部");
  const [pendingQuery, setPendingQuery] = useState("");
  const [lastAttemptedQuery, setLastAttemptedQuery] = useState("");
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [hasSavedView, setHasSavedView] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [freshness, setFreshness] = useState({ market: "", financial: "", news: "" });
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [viewMode, setViewMode] = useState<"basic" | "pro">("pro");
  const [benchmarkCode, setBenchmarkCode] = useState("000300");
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);
  const [savedWorkspace, setSavedWorkspace] = useState<SavedWorkspace | null>(null);
  const [cloudStatus, setCloudStatus] = useState<"loading" | "synced" | "local" | "error">("loading");
  const [commandOpen, setCommandOpen] = useState(false);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const realtimeControllerRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const sharedStateAppliedRef = useRef(false);
  const cloudLoadedRef = useRef(false);

  useEffect(() => {
    let storedStocks: RecentStock[] = [];
    let storedWatchlist: WatchlistItem[] = [];
    let storedAnnotations: ChartAnnotation[] = [];
    let storedWorkspace: SavedWorkspace | null = null;
    let storedViewMode: "basic" | "pro" = "pro";
    try {
      storedStocks = parseRecentStocks(JSON.parse(localStorage.getItem(recentStocksStorageKey) ?? "[]"));
    } catch {
      localStorage.removeItem(recentStocksStorageKey);
    }
    try {
      storedWatchlist = parseWatchlist(JSON.parse(localStorage.getItem(watchlistStorageKey) ?? "[]"));
    } catch {
      localStorage.removeItem(watchlistStorageKey);
    }
    try {
      storedWorkspace = JSON.parse(localStorage.getItem(workspaceStorageKey) ?? "null") as SavedWorkspace | null;
    } catch { localStorage.removeItem(workspaceStorageKey); }
    try {
      storedAnnotations = parseAnnotations(JSON.parse(localStorage.getItem(annotationsStorageKey) ?? "[]"));
    } catch { localStorage.removeItem(annotationsStorageKey); }
    storedViewMode = localStorage.getItem(viewModeStorageKey) === "basic" ? "basic" : "pro";
    const frame = window.requestAnimationFrame(() => {
      setRecentStocks(storedStocks);
      setWatchlist(storedWatchlist);
      setSavedWorkspace(storedWorkspace);
      setHasSavedView(Boolean(storedWorkspace));
      setAnnotations(storedAnnotations);
      setViewMode(storedViewMode);
      setStorageHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const query = queryText.trim();
    if (query.length < 2 || stockCodePattern.test(query) || fetchingStock) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const result = await resolveStockQuery(query, controller.signal);
        setStockSuggestion(result);
      } catch { setStockSuggestion(null); }
    }, 260);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [fetchingStock, queryText]);

  useEffect(() => {
    if (isDemo) return;
    const controller = new AbortController();
    const loadBenchmark = async () => {
      try {
        const response = await fetch("/api/local-stock-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: benchmarkCode, days: 1250, kind: "index" }),
          signal: controller.signal,
        });
        const body = await response.text();
        if (!response.ok) throw new Error(body);
        setBenchmarkDataset(parseMarketCsv(body));
      } catch (reason) {
        if (!isAbortError(reason)) setBenchmarkDataset(null);
      }
    };
    void loadBenchmark();
    return () => controller.abort();
  }, [benchmarkCode, isDemo]);

  const refreshRealtime = useCallback(async (code: string, silent = false) => {
    if (!/^\d{6}$/.test(code)) return;
    if (realtimeControllerRef.current) {
      if (silent) return;
      realtimeControllerRef.current.abort();
    }
    const controller = new AbortController();
    realtimeControllerRef.current = controller;
    if (!silent) setRealtimeLoad({ phase: "loading", detail: "正在获取当前交易日分钟 K 线与五档买卖盘…" });
    try {
      const response = await fetch("/api/realtime-market", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), cache: "no-store", signal: controller.signal });
      const body = await response.json() as RealtimeSnapshot | { error?: unknown };
      if (!response.ok) throw new Error(String((body as { error?: unknown }).error || "实时行情获取失败"));
      const snapshot = body as RealtimeSnapshot;
      if (snapshot.code !== code) return;
      setRealtimeSnapshot(snapshot);
      setRealtimeLoad({ phase: "success", detail: `${snapshot.date} ${snapshot.time} · ${snapshot.minuteCandles.length} 根分钟 K 线` });
    } catch (reason) {
      if (!isAbortError(reason) && !silent) setRealtimeLoad({ phase: "error", detail: reason instanceof Error ? reason.message : "实时行情获取失败" });
    } finally {
      if (realtimeControllerRef.current === controller) realtimeControllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!/^\d{6}$/.test(selectedCode)) return;
    const pollDelay = realtimeSnapshot?.marketStatus === "交易中" ? 1_000 : 15_000;
    const initial = window.setTimeout(() => void refreshRealtime(selectedCode), 0);
    const timer = window.setInterval(() => { if (!document.hidden) void refreshRealtime(selectedCode, true); }, pollDelay);
    const refreshWhenVisible = () => { if (!document.hidden) void refreshRealtime(selectedCode, true); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      realtimeControllerRef.current?.abort();
    };
  }, [isDemo, realtimeSnapshot?.marketStatus, refreshRealtime, selectedCode]);

  useEffect(() => {
    const controller = new AbortController();
    const loadCloudState = async () => {
      try {
        const stateResponse = await fetch("/api/research-state", { signal: controller.signal, cache: "no-store" });
        if (stateResponse.status === 401) {
          setCloudStatus("local");
          return;
        }
        if (!stateResponse.ok) throw new Error("云端研究状态暂不可用");
        const stateBody = await stateResponse.json() as { state?: unknown };
        const state = stateBody.state && typeof stateBody.state === "object" ? stateBody.state as Record<string, unknown> : null;
        if (state) {
          const cloudWatchlist = parseWatchlist(state.watchlist);
          const cloudAnnotations = parseAnnotations(state.annotations);
          if (cloudWatchlist.length) setWatchlist(cloudWatchlist);
          if (cloudAnnotations.length) setAnnotations(cloudAnnotations);
          if (state.viewMode === "basic" || state.viewMode === "pro") setViewMode(state.viewMode);
          if (typeof state.benchmarkCode === "string" && /^\d{6}$/.test(state.benchmarkCode)) setBenchmarkCode(state.benchmarkCode);
          if (state.workspace && typeof state.workspace === "object") {
            const workspace = state.workspace as SavedWorkspace;
            if (workspace.version === 1) { setSavedWorkspace(workspace); setHasSavedView(true); }
          }
        }
        cloudLoadedRef.current = true;
        setCloudStatus("synced");
      } catch (reason) {
        if (!isAbortError(reason)) setCloudStatus("error");
      }
    };
    void loadCloudState();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!storageHydrated || !cloudLoadedRef.current || cloudStatus !== "synced") return;
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/research-state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: { version: 2, watchlist, workspace: savedWorkspace, annotations, viewMode, benchmarkCode } }),
        });
        if (!response.ok) throw new Error("同步失败");
      } catch { setCloudStatus("error"); }
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [annotations, benchmarkCode, cloudStatus, savedWorkspace, storageHydrated, viewMode, watchlist]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => () => requestControllerRef.current?.abort(), []);
  useEffect(() => { reportTelemetry("app_loaded", performance.now()); }, []);

  useEffect(() => {
    let resolved: Appearance = "light";
    try {
      const stored = localStorage.getItem(appearanceStorageKey);
      resolved = stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.appearance = resolved;
    const frame = window.requestAnimationFrame(() => setAppearance(resolved));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const candles = useMemo(
    () => aggregateCandles(dataset.rows, selectedCode, timeframe),
    [dataset.rows, selectedCode, timeframe],
  );
  const benchmarkCandles = useMemo(() => benchmarkDataset ? aggregateCandles(benchmarkDataset.rows, benchmarkDataset.codes[0], "1d") : [], [benchmarkDataset]);
  const indicators = useMemo(() => calculateIndicators(candles), [candles]);
  const signalBacktest = useMemo(() => backtestGuideSignals(candles, indicators, [5, 10, 20], { benchmark: timeframe === "1d" ? benchmarkCandles : [] }), [benchmarkCandles, candles, indicators, timeframe]);
  const riskMetrics = useMemo(() => calculateRiskMetrics(timeframe === "1d" ? candles : aggregateCandles(dataset.rows, selectedCode, "1d"), benchmarkCandles), [benchmarkCandles, candles, dataset.rows, selectedCode, timeframe]);

  const selectedIndex = hoverIndex ?? Math.max(0, candles.length - 1);
  const selectedCandle = candles[selectedIndex];
  const klineConclusion = useMemo(
    () => analyzeKlineConclusion(candles, indicators, selectedIndex),
    [candles, indicators, selectedIndex],
  );
  const { firstRow, lastRow } = useMemo(() => {
    let first: ParsedDataset["rows"][number] | undefined;
    let last: ParsedDataset["rows"][number] | undefined;
    for (const row of dataset.rows) {
      if (row.code !== selectedCode) continue;
      if (!first) first = row;
      last = row;
    }
    return { firstRow: first, lastRow: last };
  }, [dataset.rows, selectedCode]);
  const intent = useMemo(
    () => lastRow && !dataset.dataLevel.includes("日K聚合") ? analyzeMarketIntent(dataset, selectedCode, lastRow.date) : null,
    [dataset, selectedCode, lastRow],
  );
  const latest = candles[candles.length - 1];
  const selectedName = dataset.stockNames[selectedCode] ?? "";
  const liveQuote = realtimeSnapshot?.code === selectedCode ? realtimeSnapshot : null;
  const displayChange = liveQuote?.change ?? latest?.change ?? 0;
  const directionClass = displayChange >= 0 ? "is-up" : "is-down";
  const busy = fetchingStock;
  const selectedNews = useMemo(() => {
    const matching = newsDataset.items.filter((item) => item.code === selectedCode);
    return matching.length > 0 ? matching : newsDataset.items;
  }, [newsDataset.items, selectedCode]);
  const visibleNews = useMemo(
    () => newsFilter === "全部" ? selectedNews : selectedNews.filter((item) => item.sentiment === newsFilter),
    [newsFilter, selectedNews],
  );
  const chartEvents = useMemo(
    () => buildChartEvents(selectedNews, financialDataset, selectedCode),
    [financialDataset, selectedCode, selectedNews],
  );
  const factorProfile = useMemo(() => buildFactorProfile(aggregateCandles(dataset.rows, selectedCode, "1d"), financialDataset, riskMetrics), [dataset.rows, financialDataset, riskMetrics, selectedCode]);
  const eventStudies = useMemo(() => buildEventStudies(chartEvents, aggregateCandles(dataset.rows, selectedCode, "1d")), [chartEvents, dataset.rows, selectedCode]);
  const dailyOnly = dataset.dataLevel.includes("日K聚合");

  const rememberRecentStock = useCallback((code: string, name: string) => {
    const normalizedCode = code.trim();
    const normalizedName = name.trim();
    if (!/^\d{6}$/.test(normalizedCode) || !normalizedName) return;
    setRecentStocks((current) => {
      const next = [
        { code: normalizedCode, name: normalizedName, queriedAt: Date.now() },
        ...current.filter((item) => item.code !== normalizedCode),
      ].slice(0, maxRecentStocks);
      try {
        localStorage.setItem(recentStocksStorageKey, JSON.stringify(next));
      } catch {
        // Recent queries are a convenience only; data loading should still succeed.
      }
      return next;
    });
  }, []);

  const clearRecentStocks = () => {
    setRecentStocks([]);
    try {
      localStorage.removeItem(recentStocksStorageKey);
    } catch {
      // Ignore storage restrictions and keep the in-memory list cleared.
    }
  };

  const applyDataset = useCallback((parsed: ParsedDataset, name: string) => {
    const code = parsed.codes[0];
    setDataset(parsed);
    setSelectedCode(code);
    setRange(defaultRange(aggregateCandles(parsed.rows, code, "1d").length, "1d"));
    setHoverIndex(null);
    setMarketSourceLabel(name);
    setIsDemo(false);
    setTimeframe("1d");
  }, []);

  const applyNewsDataset = useCallback((parsed: ParsedNewsDataset, name: string) => {
    setNewsDataset(parsed);
    setNewsSourceLabel(name);
    setNewsFilter("全部");
  }, []);

  const updateWatchedSnapshot = useCallback((code: string, values: Partial<Omit<WatchlistItem, "code">>) => {
    setWatchlist((current) => {
      const index = current.findIndex((item) => item.code === code);
      if (index < 0) return current;
      const merged = { ...current[index], ...values, updatedAt: new Date().toISOString() };
      const comparableCurrent = { ...current[index], updatedAt: "" };
      const comparableMerged = { ...merged, updatedAt: "" };
      if (JSON.stringify(comparableCurrent) === JSON.stringify(comparableMerged)) return current;
      const next = current.map((item, itemIndex) => itemIndex === index ? merged : item);
      try {
        localStorage.setItem(watchlistStorageKey, JSON.stringify(next));
      } catch {
        // Keep the in-memory comparison usable when storage is unavailable.
      }
      return next;
    });
  }, []);

  const fetchStockData = useCallback(async (queryValue = queryText) => {
    const query = queryValue.trim();
    if (!query) {
      setError("请输入股票代码或名称，例如 平安银行、002747 或 sh600000");
      return;
    }
    requestControllerRef.current?.abort();
    const requestController = new AbortController();
    requestControllerRef.current = requestController;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setFetchingStock(true);
    setStockSuggestion(null);
    setError("");
    setPendingQuery(query);
    setLastAttemptedQuery(query);
    setNewsSourceLabel(`${query} · 等待行情`);
    setFinancialSourceLabel(`${query} · 等待识别`);
    setMarketLoad({ phase: "loading", detail: `正在加载 ${query}；当前图表保留上一份成功数据` });
    setNewsLoad({ phase: "loading", detail: "识别完成后将并行获取新闻…" });
    setFinancialLoad({ phase: "loading", detail: "识别完成后将并行获取基本面…" });
    setNewsDataset(emptyNewsDataset());
    setFinancialDataset(emptyFinancialDataset());
    setRealtimeSnapshot(null);
    setRealtimeLoad({ phase: "idle", detail: "输入股票后自动获取当前交易日分钟 K 线与五档盘口" });
    setNewsFilter("全部");

    const post = async (endpoint: string, payload: unknown, fallback: string) => {
      const controller = new AbortController();
      const abortFromParent = () => controller.abort();
      requestController.signal.addEventListener("abort", abortFromParent, { once: true });
      const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        return { response, body: await response.text() };
      } catch (reason) {
        if (controller.signal.aborted && !requestController.signal.aborted) throw new Error(`${fallback}（请求超时）`);
        throw reason;
      } finally {
        window.clearTimeout(timeout);
        requestController.signal.removeEventListener("abort", abortFromParent);
      }
    };

    const requestCsv = async (endpoint: string, payload: unknown, fallback: string) => {
      let response: Response;
      let body: string;
      try {
        ({ response, body } = await post(endpoint, payload, fallback));
      } catch (reason) {
        const cached = await readCachedText(endpoint, payload);
        if (cached) {
          setWorkspaceNotice(`网络暂不可用，正在使用 ${new Date(cached.cachedAt).toLocaleString("zh-CN", { hour12: false })} 保存的只读缓存。`);
          return cached.text;
        }
        throw reason;
      }
      if (response.ok) { void writeCachedText(endpoint, payload, body); return body; }
      let message = fallback;
      try {
        message = String((JSON.parse(body) as { error?: unknown }).error || message);
      } catch {
        if (body.trim()) message = body.trim();
      }
      throw new Error(message);
    };

    const requestJson = async <T,>(endpoint: string, payload: unknown, fallback: string): Promise<T> => {
      const { response, body } = await post(endpoint, payload, fallback);
      let parsed: { error?: unknown } | T;
      try {
        parsed = JSON.parse(body) as { error?: unknown } | T;
      } catch {
        throw new Error(response.ok ? "基本面服务返回了无效数据" : body.trim() || fallback);
      }
      if (!response.ok) throw new Error(String((parsed as { error?: unknown }).error || fallback));
      return parsed as T;
    };

    try {
      const resolved = await resolveStockQuery(query, requestController.signal);
      if (requestVersion !== requestVersionRef.current) return;
      const normalizedCode = resolved.code;
      const resolvedLabel = `${resolved.name ? `${resolved.name} · ` : ""}${normalizedCode}`;
      setQueryText(resolved.name || normalizedCode);
      setPendingQuery(resolvedLabel);
      setNewsSourceLabel(`${resolvedLabel} · 最新新闻`);
      setFinancialSourceLabel(`${resolvedLabel} · 基本面`);
      setMarketLoad({ phase: "loading", detail: `正在获取 ${resolvedLabel} 最多约 5 年的前复权日 K；旧图表暂时保留` });
      setNewsLoad({ phase: "loading", detail: "正在从 HTTPS 新闻服务获取并去重…" });
      setFinancialLoad({ phase: "loading", detail: "正在获取估值、分红与三张财务报表…" });
      const sourceStartedAt = performance.now();

      // The three data sources run concurrently. Each branch updates its section
      // as soon as its own response arrives, without waiting for the other one.
      const marketTask = requestCsv("/api/local-stock-data", { code: normalizedCode, days: 1250, kind: "stock" }, "获取行情数据失败")
        .then((csv) => {
          if (requestVersion !== requestVersionRef.current) return;
          const parsed = parseMarketCsv(csv);
          const resultCode = parsed.codes[0] ?? normalizedCode;
          const resultName = parsed.stockNames[resultCode] ?? resolved.name;
          const resultCandles = aggregateCandles(parsed.rows, resultCode, "1d");
          const resultLatest = resultCandles.at(-1);
          const resultRisk = calculateRiskMetrics(resultCandles);
          const momentum20 = resultCandles.length > 20 ? ((resultCandles.at(-1)!.close / resultCandles[resultCandles.length - 21].close) - 1) * 100 : null;
          applyDataset(parsed, `${resultName ? `${resultName} · ` : ""}${resultCode} · 最多5年前复权日K`);
          rememberRecentStock(resultCode, resultName);
          if (resultLatest) {
            updateWatchedSnapshot(resultCode, { name: resultName || resultCode, price: resultLatest.close, changePct: resultLatest.changePct, momentum20, annualizedVolatility: resultRisk.annualizedVolatility, maxDrawdown: resultRisk.maxDrawdown });
          }
          setMarketLoad({
            phase: "success",
            detail: `${resultCandles.length.toLocaleString("zh-CN")} 个交易日日K已加载，图表与风险指标已更新`,
          });
          setFreshness((current) => ({ ...current, market: new Date().toISOString() }));
          reportTelemetry("market_success", performance.now() - sourceStartedAt);
        })
        .catch((reason) => {
          if (isAbortError(reason) || requestVersion !== requestVersionRef.current) throw reason;
          const message = reason instanceof Error ? reason.message : "获取失败";
          setMarketLoad({ phase: "error", detail: `${message}；仍显示 ${selectedName || selectedCode} 的上一份成功行情` });
          reportTelemetry("market_error", performance.now() - sourceStartedAt);
          throw new Error(`行情：${message}`);
        });

      const newsTask = requestCsv("/api/local-stock-news", { code: normalizedCode, limit: 30 }, "获取新闻数据失败")
        .then((csv) => {
          if (requestVersion !== requestVersionRef.current) return;
          const parsed = parseNewsCsv(csv);
          const resultCode = parsed.codes[0] ?? normalizedCode;
          const resultName = parsed.stockNames[resultCode] ?? resolved.name;
          applyNewsDataset(parsed, `${resultName ? `${resultName} · ` : ""}${resultCode} · 新闻`);
          rememberRecentStock(resultCode, resultName);
          updateWatchedSnapshot(resultCode, { name: resultName || resultCode, sentiment: parsed.summary.tone });
          setNewsLoad({
            phase: "success",
            detail: `${parsed.items.length.toLocaleString("zh-CN")} 条新闻已加载，舆情已更新`,
          });
          setFreshness((current) => ({ ...current, news: new Date().toISOString() }));
          reportTelemetry("news_success", performance.now() - sourceStartedAt);
        })
        .catch((reason) => {
          if (isAbortError(reason) || requestVersion !== requestVersionRef.current) throw reason;
          const message = reason instanceof Error ? reason.message : "获取失败";
          setNewsLoad({ phase: "error", detail: message });
          reportTelemetry("news_error", performance.now() - sourceStartedAt);
          throw new Error(`新闻：${message}`);
        });

      const financialTask = requestJson<FinancialDataset>(
        "/api/local-stock-financials",
        { code: normalizedCode },
        "获取基本面数据失败",
      )
        .then((parsed) => {
          if (requestVersion !== requestVersionRef.current) return;
          if (!Array.isArray(parsed.reports) || parsed.reports.length === 0) {
            throw new Error("基本面服务未返回可用数据");
          }
          setFinancialDataset(parsed);
          const resultName = parsed.name || resolved.name;
          setFinancialSourceLabel(`${resultName ? `${resultName} · ` : ""}${parsed.code} · 基本面`);
          rememberRecentStock(parsed.code, resultName);
          updateWatchedSnapshot(parsed.code, {
            name: resultName || parsed.code,
            peTtm: parsed.snapshot.peTtm,
            pb: parsed.snapshot.pb,
            dividendYieldTtm: parsed.snapshot.dividendYieldTtm,
          });
          setFinancialLoad({
            phase: "success",
            detail: `估值、股息与 ${parsed.analysis?.periods?.length || parsed.reports.length} 个报告期已加载`,
          });
          setFreshness((current) => ({ ...current, financial: parsed.fetchedAt || new Date().toISOString() }));
          reportTelemetry("financial_success", performance.now() - sourceStartedAt);
        })
        .catch((reason) => {
          if (isAbortError(reason) || requestVersion !== requestVersionRef.current) throw reason;
          const message = reason instanceof Error ? reason.message : "获取失败";
          setFinancialLoad({ phase: "error", detail: message });
          reportTelemetry("financial_error", performance.now() - sourceStartedAt);
          throw new Error(`基本面：${message}`);
        });

      const results = await Promise.allSettled([marketTask, newsTask, financialTask]);
      if (requestVersion !== requestVersionRef.current) return;
      const failures = results.flatMap((result) =>
        result.status === "rejected"
          ? [result.reason instanceof Error ? result.reason.message : "数据获取失败"]
          : [],
      );
      setError(failures.join("；"));
    } catch (reason) {
      if (isAbortError(reason) || requestVersion !== requestVersionRef.current) return;
      const message = reason instanceof Error ? reason.message : "获取股票数据失败";
      setMarketLoad({ phase: "error", detail: message });
      setNewsLoad({ phase: "error", detail: "未能识别股票，新闻查询未启动" });
      setFinancialLoad({ phase: "error", detail: "未能识别股票，财报查询未启动" });
      setError(message);
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setFetchingStock(false);
        setPendingQuery("");
      }
    }
  }, [applyDataset, applyNewsDataset, queryText, rememberRecentStock, selectedCode, selectedName, updateWatchedSnapshot]);

  const resetDemo = () => {
    requestControllerRef.current?.abort();
    requestVersionRef.current += 1;
    const demo = createDemoDataset();
    setDataset(demo);
    setSelectedCode(demo.codes[0]);
    setRange(defaultRange(aggregateCandles(demo.rows, demo.codes[0], "1d").length, "1d"));
    setHoverIndex(null);
    setMarketSourceLabel("演示行情");
    setMarketLoad({
      phase: "success",
      detail: `${demo.rows.length.toLocaleString("zh-CN")} 条演示分笔已就绪`,
    });
    setNewsDataset(emptyNewsDataset());
    setFinancialDataset(emptyFinancialDataset());
    setRealtimeSnapshot(null);
    setRealtimeLoad({ phase: "idle", detail: "输入股票后自动获取当前交易日分钟 K 线与五档盘口" });
    setNewsSourceLabel("等待查询");
    setFinancialSourceLabel("等待查询");
    setNewsLoad({ phase: "idle", detail: "输入股票代码或名称后自动获取最新新闻" });
    setFinancialLoad({ phase: "idle", detail: "输入股票后自动获取估值、分红与历史财报诊断" });
    setNewsFilter("全部");
    setIsDemo(true);
    setError("");
    setPendingQuery("");
    setQueryText("");
    setStockSuggestion(null);
    setBenchmarkDataset(null);
    setTimeframe("1d");
    setFreshness({ market: "", financial: "", news: "" });
  };

  const toggleAppearance = () => {
    const next: Appearance = appearance === "light" ? "dark" : "light";
    setAppearance(next);
    document.documentElement.dataset.appearance = next;
    try {
      localStorage.setItem(appearanceStorageKey, next);
    } catch {
      // Appearance still changes for the current page when storage is restricted.
    }
  };

  const exportCandles = () => {
    if (!candles.length) return;
    const rows = [
      ["时间", "开盘", "最高", "最低", "收盘", "VWAP(前复权)", "涨跌", "涨跌幅(%)", "成交量(股)", "成交额(元)", "换手率(%)"],
      ...candles.map((candle) => [
        candle.key,
        candle.open.toFixed(3),
        candle.high.toFixed(3),
        candle.low.toFixed(3),
        candle.close.toFixed(3),
        candle.vwap.toFixed(3),
        candle.change.toFixed(3),
        candle.changePct.toFixed(3),
        String(Math.round(candle.volume)),
        candle.amount.toFixed(3),
        candle.turnoverPct == null ? "" : candle.turnoverPct.toFixed(4),
      ]),
    ];
    const blob = new Blob(["\uFEFF", rows.map((row) => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedCode}-${timeframe}-kline.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const persistWatchlist = useCallback((next: WatchlistItem[]) => {
    setWatchlist(next);
    try {
      localStorage.setItem(watchlistStorageKey, JSON.stringify(next));
    } catch {
      setWorkspaceNotice("浏览器未允许保存自选股，本次修改只在当前页面有效。");
    }
  }, []);

  useEffect(() => {
    if (sharedStateAppliedRef.current) return;
    sharedStateAppliedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const sharedTimeframe = params.get("tf");
    const sharedLower = params.get("lower");
    const sharedOverlays = params.get("ov")?.split(",").filter(Boolean) ?? [];
    const sharedFrom = Number(params.get("from"));
    const sharedTo = Number(params.get("to"));
    const sharedCode = params.get("stock") ?? "";
    const sharedMode = params.get("mode");
    const sharedBenchmark = params.get("benchmark");
    const applySharedState = async () => {
      if (sharedCode && /^\d{6}$/.test(sharedCode)) await fetchStockData(sharedCode);
      if (sharedMode === "basic" || sharedMode === "pro") setViewMode(sharedMode);
      if (sharedBenchmark && /^\d{6}$/.test(sharedBenchmark)) setBenchmarkCode(sharedBenchmark);
      if (timeframes.some((item) => item.key === sharedTimeframe)) setTimeframe(sharedTimeframe as Timeframe);
      if (lowerIndicators.includes(sharedLower as LowerIndicator)) setLowerIndicator(sharedLower as LowerIndicator);
      if (sharedOverlays.length) {
        setOverlays((current) => Object.fromEntries(Object.keys(current).map((key) => [key, sharedOverlays.includes(key)])) as typeof current);
      }
      if (Number.isFinite(sharedFrom) && Number.isFinite(sharedTo) && sharedFrom >= 0 && sharedTo > sharedFrom) {
        setRange({ from: sharedFrom, to: sharedTo });
      }
      if (sharedCode) setWorkspaceNotice("已从分享链接恢复股票与图表视图。");
    };
    void applySharedState();
  }, [fetchStockData]);

  const currentWorkspace = (): SavedWorkspace => ({
    version: 1,
    code: selectedCode,
    isDemo,
    timeframe,
    lowerIndicator,
    overlays: Object.entries(overlays).filter(([, active]) => active).map(([key]) => key),
    range,
    savedAt: new Date().toISOString(),
  });

  const toggleWatch = () => {
    const existing = watchlist.some((item) => item.code === selectedCode);
    if (existing) {
      persistWatchlist(watchlist.filter((item) => item.code !== selectedCode));
      setWorkspaceNotice(`已将 ${selectedName || selectedCode} 从行情监控移除。`);
      return;
    }
    if (watchlist.length >= 20) {
      setWorkspaceNotice("行情监控最多保留 20 只股票，请先移除一只。");
      return;
    }
    const snapshot = financialDataset.code === selectedCode ? financialDataset.snapshot : null;
    persistWatchlist([...watchlist, {
      code: selectedCode,
      name: selectedName || selectedCode,
      price: latest?.close ?? null,
      changePct: latest?.changePct ?? null,
      peTtm: snapshot?.peTtm ?? null,
      pb: snapshot?.pb ?? null,
      dividendYieldTtm: snapshot?.dividendYieldTtm ?? null,
      sentiment: newsDataset.items.length ? newsDataset.summary.tone : null,
      momentum20: candles.length > 20 ? ((candles.at(-1)!.close / candles[candles.length - 21].close) - 1) * 100 : null,
      annualizedVolatility: riskMetrics.annualizedVolatility,
      maxDrawdown: riskMetrics.maxDrawdown,
      updatedAt: new Date().toISOString(),
    }]);
    setWorkspaceNotice(`已将 ${selectedName || selectedCode} 加入行情监控。`);
  };

  const copyWorkspaceLink = async () => {
    const workspace = currentWorkspace();
    const url = new URL(window.location.href);
    url.search = "";
    if (!workspace.isDemo) url.searchParams.set("stock", workspace.code);
    url.searchParams.set("tf", workspace.timeframe);
    url.searchParams.set("lower", workspace.lowerIndicator);
    url.searchParams.set("ov", workspace.overlays.join(","));
    url.searchParams.set("from", String(workspace.range.from));
    url.searchParams.set("to", String(workspace.range.to));
    url.searchParams.set("mode", viewMode);
    url.searchParams.set("benchmark", benchmarkCode);
    try {
      if (navigator.share) {
        await navigator.share({ title: `${selectedName || selectedCode} · TickLens研究视图`, text: "打开后可恢复股票、周期、指标和对比基准。", url: url.toString() });
        setWorkspaceNotice("研究视图已通过系统分享。");
      } else {
        await navigator.clipboard.writeText(url.toString());
        setWorkspaceNotice("分享链接已复制，打开后会自动恢复股票和图表视图。");
      }
    } catch {
      setWorkspaceNotice("无法写入剪贴板，请检查浏览器权限。");
    }
  };

  const saveWorkspace = () => {
    try {
      const workspace = currentWorkspace();
      localStorage.setItem(workspaceStorageKey, JSON.stringify(workspace));
      setSavedWorkspace(workspace);
      setHasSavedView(true);
      setWorkspaceNotice(cloudStatus === "synced" ? "当前研究视图已保存并将同步到云端。" : "当前研究视图已保存在此浏览器。");
      reportTelemetry("workspace_saved");
    } catch {
      setWorkspaceNotice("浏览器未允许保存研究视图。");
    }
  };

  const restoreWorkspace = async () => {
    try {
      const workspace = savedWorkspace ?? JSON.parse(localStorage.getItem(workspaceStorageKey) ?? "null") as SavedWorkspace | null;
      if (!workspace || workspace.version !== 1) throw new Error("未找到有效视图");
      if (!workspace.isDemo && /^\d{6}$/.test(workspace.code)) await fetchStockData(workspace.code);
      else resetDemo();
      setTimeframe(workspace.timeframe);
      setLowerIndicator(lowerIndicators.includes(workspace.lowerIndicator as LowerIndicator) ? workspace.lowerIndicator as LowerIndicator : "VOL");
      setOverlays((current) => Object.fromEntries(Object.keys(current).map((key) => [key, workspace.overlays.includes(key)])) as typeof current);
      setRange(workspace.range);
      setWorkspaceNotice(`已恢复 ${new Date(workspace.savedAt).toLocaleString("zh-CN", { hour12: false })} 保存的研究视图。`);
    } catch {
      setWorkspaceNotice("保存的研究视图无效或已被清除。");
    }
  };

  const toggleViewMode = () => {
    const next = viewMode === "pro" ? "basic" : "pro";
    setViewMode(next);
    try { localStorage.setItem(viewModeStorageKey, next); } catch { /* preference remains in memory */ }
    setWorkspaceNotice(next === "basic" ? "已切换基础模式：优先展示结论与关键依据。" : "已切换专业模式：展示完整风险、因子、回测与数据口径。");
  };

  const addAnnotation = (text: string) => {
    const next = [{ id: crypto.randomUUID?.() ?? `${selectedCode}-${Date.now()}`, code: selectedCode, date: selectedCandle?.date ?? latest?.date ?? "", price: selectedCandle?.close ?? latest?.close ?? null, text: text.slice(0, 180), createdAt: new Date().toISOString() }, ...annotations].slice(0, 100);
    setAnnotations(next);
    try { localStorage.setItem(annotationsStorageKey, JSON.stringify(next)); } catch { /* cloud sync may still succeed */ }
    setWorkspaceNotice("研究标注已记录，并会随研究状态同步。");
  };

  const removeAnnotation = (id: string) => {
    const next = annotations.filter((item) => item.id !== id);
    setAnnotations(next);
    try { localStorage.setItem(annotationsStorageKey, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const exportResearchReport = () => {
    const report = buildResearchReport({
      code: selectedCode,
      name: selectedName,
      timeframe,
      candles,
      conclusion: klineConclusion,
      backtest: signalBacktest,
      financialDataset,
      newsDataset,
      generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    });
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedCode}-${timeframe}-research-report.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setWorkspaceNotice("研究报告已导出；也可使用“打印 / PDF”生成版式化文件。");
    reportTelemetry("report_exported");
  };

  const commands: CommandItem[] = [
    { id: "search", label: "查询股票", description: "聚焦股票名称或代码输入框", shortcut: "/", run: () => document.getElementById("stock-query")?.focus() },
    { id: "mode", label: viewMode === "pro" ? "切换基础模式" : "切换专业模式", description: "调整页面信息密度与研究深度", shortcut: "M", run: toggleViewMode },
    { id: "refresh", label: "刷新当前股票", description: selectedName || selectedCode, shortcut: "R", run: () => { if (!isDemo) void fetchStockData(selectedCode); } },
    { id: "watch", label: watchlist.some((item) => item.code === selectedCode) ? "移出行情监控" : "加入行情监控", description: "维护当前股票的监控状态", shortcut: "W", run: toggleWatch },
    { id: "alerts", label: "打开行情监控", description: "管理跨股票价格预警", run: () => { window.location.href = "/alerts"; } },
    { id: "save", label: "保存当前研究视图", description: "保存周期、指标、范围和股票", shortcut: "S", run: saveWorkspace },
    { id: "theme", label: appearance === "light" ? "切换深色外观" : "切换浅色外观", description: "跟随不同阅读环境", shortcut: "T", run: toggleAppearance },
    { id: "market", label: "前往行情图表", description: "价格、成交量和技术指标", run: () => scrollToSection("stock-market") },
    { id: "advanced", label: "前往高级研究", description: "风险、因子和事件研究", run: () => scrollToSection("advanced-research") },
    { id: "financials", label: "前往财报诊断", description: "增长、质量、现金流与估值", run: () => scrollToSection("stock-financials") },
    { id: "news", label: "前往舆情资讯", description: "新闻、情绪和来源核验", run: () => scrollToSection("stock-news") },
  ];

  const currentIndicator = {
    ma5: indicators.ma5[selectedIndex],
    ma10: indicators.ma10[selectedIndex],
    ma20: indicators.ma20[selectedIndex],
    rsi: indicators.rsi[selectedIndex],
    dif: indicators.macdDif[selectedIndex],
    dea: indicators.macdDea[selectedIndex],
    k: indicators.k[selectedIndex],
    d: indicators.d[selectedIndex],
    j: indicators.j[selectedIndex],
    atr: indicators.atr14[selectedIndex],
    nineTurn: indicators.nineTurn[selectedIndex],
    guide: indicators.guidePoints[selectedIndex],
  };

  return (
    <main className={`app-shell view-${viewMode}`}>
      <CommandPalette open={commandOpen} commands={commands} onClose={() => setCommandOpen(false)} />
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">TL</div>
          <div>
            <strong>TickLens</strong>
            <span>市场研究工作台</span>
          </div>
        </div>

        <section className="sidebar-current" aria-label="当前股票">
          <span>当前标的</span>
          <strong>{selectedName || selectedCode}</strong>
          <small>{selectedCode} · {dataset.dataLevel}</small>
          <b className={directionClass}>{liveQuote ? formatNumber(liveQuote.price, 3) : latest ? formatNumber(latest.close, 3) : "—"}</b>
          <em className={directionClass}>{liveQuote ? `${liveQuote.changePct >= 0 ? "+" : ""}${formatNumber(liveQuote.changePct, 2)}% · 实时` : latest ? `${latest.changePct >= 0 ? "+" : ""}${formatNumber(latest.changePct, 2)}%` : "—"}</em>
        </section>

        <nav className="workspace-nav" aria-label="工作台章节导航">
          <a href="#realtime-trading"><span>实时</span><small>Live</small></a>
          <a href="#stock-market"><span>行情</span><small>Market</small></a>
          <a href="#kline-analysis"><span>研判</span><small>Insight</small></a>
          <a href="#signal-backtest"><span>回测</span><small>Backtest</small></a>
          <a href="#advanced-research"><span>高级研究</span><small>Risk & Factor</small></a>
          <a href="#research-tools"><span>研究工具</span><small>Workspace</small></a>
          <a href="#stock-financials"><span>财报</span><small>Financials</small></a>
          <a href="#stock-news"><span>新闻</span><small>News</small></a>
          <Link className="monitor-nav-link" href="/alerts"><span>行情监控</span><small>Alerts ↗</small></Link>
        </nav>

        <section className={`recent-query-strip sidebar-recents ${recentStocks.length ? "" : "is-empty"}`} aria-label="最近查询的股票">
          <div className="sidebar-section-heading">
            <span className="recent-query-label">最近查询</span>
            {recentStocks.length > 0 ? <button className="recent-query-clear" type="button" onClick={clearRecentStocks} disabled={busy}>清空</button> : null}
          </div>
          <div className="recent-query-list">
            {recentStocks.length > 0 ? recentStocks.map((stock) => (
              <button
                key={stock.code}
                type="button"
                disabled={busy}
                onClick={() => {
                  setQueryText(stock.name);
                  void fetchStockData(stock.code);
                }}
                title={`再次查询 ${stock.name} ${stock.code}`}
              >
                <strong>{stock.name}</strong>
                <span>{stock.code}</span>
              </button>
            )) : <span className="recent-query-empty">查询过的股票会显示在这里</span>}
          </div>
        </section>

        <p className="sidebar-footnote">公开数据与规则模型仅供研究参考，不构成投资建议。</p>
      </aside>

      <div className="app-workspace-shell">
      <header className="topbar">
        <div className="brand-lockup workspace-heading">
          <div>
            <p className="eyebrow">MARKET WORKSPACE</p>
            <h1>市场研究</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="topbar-sync"><i aria-hidden="true" />行情、基本面与新闻并行更新</span>
          <Link className="topbar-monitor-link" href="/alerts">行情监控</Link>
          <button className="command-trigger" type="button" onClick={() => setCommandOpen(true)}><span>⌘K</span> 命令中心</button>
          <button className="view-mode-toggle" type="button" onClick={toggleViewMode}>{viewMode === "pro" ? "专业模式" : "基础模式"}</button>
          <button className="appearance-toggle" type="button" onClick={toggleAppearance} aria-label={`切换到${appearance === "light" ? "深色" : "浅色"}外观`} title={`切换到${appearance === "light" ? "深色" : "浅色"}外观`}>
            <span aria-hidden="true">{appearance === "light" ? "◐" : "☀"}</span>
          </button>
        </div>
      </header>

      <section className={`query-strip ${fetchingStock ? "is-loading" : ""}`}>
        <div className="query-sources" aria-live="polite">
          <div className="query-source">
            <div className={`source-icon ${marketLoad.phase === "loading" ? "is-loading" : ""}`}>K线</div>
            <div>
              <div className="source-title-row">
                <strong>{marketSourceLabel}</strong>
                <LoadBadge phase={marketLoad.phase} />
              </div>
              <p>{marketLoad.detail}</p>
            </div>
          </div>
          <div className="source-divider" aria-hidden="true" />
          <div className="query-source financial-source">
            <div className={`source-icon financial-icon ${financialLoad.phase === "loading" ? "is-loading" : ""}`}>基本面</div>
            <div>
              <div className="source-title-row">
                <strong>{financialSourceLabel}</strong>
                <LoadBadge phase={financialLoad.phase} />
              </div>
              <p>{financialLoad.detail}</p>
            </div>
          </div>
          <div className="source-divider" aria-hidden="true" />
          <div className="query-source news-source">
            <div className={`source-icon news-icon ${newsLoad.phase === "loading" ? "is-loading" : ""}`}>舆情</div>
            <div>
              <div className="source-title-row">
                <strong>{newsSourceLabel}</strong>
                <LoadBadge phase={newsLoad.phase} />
              </div>
              <p>{newsLoad.detail}</p>
            </div>
          </div>
        </div>
        <div className="query-actions">
          {error ? <span className="error-message" role="alert">{error}</span> : null}
          {error && lastAttemptedQuery ? <button className="retry-button" type="button" onClick={() => void fetchStockData(lastAttemptedQuery)} disabled={busy}>重试</button> : null}
          <form
            className="stock-search"
            onSubmit={(event) => {
              event.preventDefault();
              void fetchStockData();
            }}
          >
            <label className="sr-only" htmlFor="stock-query">股票代码或名称</label>
            <input
              id="stock-query"
              value={queryText}
              onChange={(event) => { setQueryText(event.target.value); setStockSuggestion(null); }}
              placeholder="股票名称或代码，如 平安银行 / 000001"
              autoComplete="off"
              maxLength={40}
              disabled={busy}
            />
            <button type="submit" disabled={busy}>{fetchingStock ? "数据加载中…" : "获取行情 + 基本面 + 新闻"}</button>
            {stockSuggestion ? <button className="stock-suggestion" type="button" onClick={() => { setQueryText(stockSuggestion.name); void fetchStockData(stockSuggestion.code); }}><span><strong>{stockSuggestion.name}</strong><small>{stockSuggestion.code} · 沪深A股</small></span><em>打开 ↵</em></button> : null}
          </form>
          {!isDemo ? (
            <button className="button ghost" type="button" onClick={resetDemo}>
              恢复演示
            </button>
          ) : null}
        </div>
      </section>

      <section className="quote-head">
        <div className="quote-identity">
          {dataset.codes.length > 1 ? (
            <select
              aria-label="选择股票代码"
              value={selectedCode}
              onChange={(event) => {
                const code = event.target.value;
                setSelectedCode(code);
                setRange(defaultRange(aggregateCandles(dataset.rows, code, timeframe).length, timeframe));
                setHoverIndex(null);
              }}
            >
              {dataset.codes.map((code) => (
                <option key={code} value={code}>{dataset.stockNames[code] ? `${dataset.stockNames[code]} · ${code}` : code}</option>
              ))}
            </select>
          ) : (
            <h2>{selectedName || selectedCode}</h2>
          )}
          {selectedName ? <span className="stock-code">{selectedCode}</span> : null}
          <span className="market-pill">A股</span>
          <span className="level-pill">{dataset.dataLevel}</span>
          <span className="date-span">{firstRow?.date ?? "—"} → {lastRow?.date ?? "—"}</span>
        </div>
        <div className="quote-price">
          <strong className={directionClass}>{liveQuote ? formatNumber(liveQuote.price, 3) : latest ? formatNumber(latest.close, 3) : "—"}</strong>
          <span className={directionClass}>
            {liveQuote ? `${liveQuote.change >= 0 ? "+" : ""}${formatNumber(liveQuote.change, 3)}  ${liveQuote.changePct >= 0 ? "+" : ""}${formatNumber(liveQuote.changePct, 2)}% · 实时` : latest ? `${latest.change >= 0 ? "+" : ""}${formatNumber(latest.change, 3)}  ${latest.changePct >= 0 ? "+" : ""}${formatNumber(latest.changePct, 2)}%` : "—"}
          </span>
        </div>
        <div className="quote-stats">
          <Stat label="开" value={liveQuote ? formatNumber(liveQuote.open, 3) : latest ? formatNumber(latest.open, 3) : "—"} />
          <Stat label="高" value={liveQuote ? formatNumber(liveQuote.high, 3) : latest ? formatNumber(latest.high, 3) : "—"} />
          <Stat label="低" value={liveQuote ? formatNumber(liveQuote.low, 3) : latest ? formatNumber(latest.low, 3) : "—"} />
          <Stat label="量" value={liveQuote ? compactNumber(liveQuote.volume) : latest ? compactNumber(latest.volume) : "—"} />
          <Stat label="额" value={liveQuote ? compactNumber(liveQuote.amount) : latest ? compactNumber(latest.amount) : "—"} />
          <Stat label="换手" value={latest?.turnoverPct == null ? "—" : `${formatNumber(latest.turnoverPct, 2)}%`} />
        </div>
      </section>

      {fetchingStock ? (
        <div className="stale-data-banner" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          正在加载 {pendingQuery || "新股票"}；下方行情仍是 {selectedName || selectedCode} 的上一份成功数据，加载完成前不会替换。
        </div>
      ) : null}

      <RealtimeTradingPanel snapshot={realtimeSnapshot} load={realtimeLoad} onRefresh={() => void refreshRealtime(selectedCode)} />

      <section className="workspace-grid" id="stock-market">
        <div className={`chart-card ${fetchingStock ? "is-stale" : ""}`}>
          <div className="chart-toolbar">
            <div className="chart-toolbar-title">
              <span aria-hidden="true">⌁</span>
              <div>
                <strong>价格走势</strong>
                <small>{timeframes.find((item) => item.key === timeframe)?.label} · 前复权 · {benchmarkCandles.length ? "对比沪深300" : "等待基准"}</small>
              </div>
            </div>
            <div className="segmented" aria-label="K线周期">
              {timeframes.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={timeframe === key ? "active" : ""}
                  aria-pressed={timeframe === key}
                  disabled={dailyOnly && key !== "1d"}
                  title={dailyOnly && key !== "1d" ? "历史行情数据源为日 K 聚合；当前交易日 1 分钟 K 线请查看上方实时行情区域" : undefined}
                  onClick={() => {
                    setTimeframe(key);
                    setRange(defaultRange(aggregateCandles(dataset.rows, selectedCode, key).length, key));
                    setHoverIndex(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="toolbar-divider" />
            <label className="benchmark-select">基准
              <select value={benchmarkCode} onChange={(event) => setBenchmarkCode(event.target.value)} aria-label="相对表现比较基准">
                <option value="000300">沪深300</option><option value="000001">上证指数</option><option value="399001">深证成指</option><option value="399006">创业板指</option>
              </select>
            </label>
            <div className="indicator-toggles" aria-label="主图指标">
              <Toggle active={overlays.ma5} label="MA5" color="gold" onClick={() => setOverlays((value) => ({ ...value, ma5: !value.ma5 }))} />
              <Toggle active={overlays.ma10} label="MA10" color="blue" onClick={() => setOverlays((value) => ({ ...value, ma10: !value.ma10 }))} />
              <Toggle active={overlays.ma20} label="MA20" color="purple" onClick={() => setOverlays((value) => ({ ...value, ma20: !value.ma20 }))} />
              <Toggle active={overlays.ema} label="EMA" color="orange" onClick={() => setOverlays((value) => ({ ...value, ema: !value.ema }))} />
              <Toggle active={overlays.boll} label="BOLL" color="indigo" onClick={() => setOverlays((value) => ({ ...value, boll: !value.boll }))} />
              <Toggle active={overlays.vwap} label="VWAP" color="pink" onClick={() => setOverlays((value) => ({ ...value, vwap: !value.vwap }))} />
              <Toggle active={overlays.nineTurn} label="九转" color="cyan" onClick={() => setOverlays((value) => ({ ...value, nineTurn: !value.nineTurn }))} />
              <Toggle active={overlays.guides} label="B/S指引" color="red" onClick={() => setOverlays((value) => ({ ...value, guides: !value.guides }))} />
            </div>
            {chartEvents.length ? <span className="event-count" title="N 新闻 · F 财报 · D 分红">事件 {chartEvents.length}</span> : null}
            <button className="icon-button" type="button" onClick={exportCandles} title="导出当前周期K线" aria-label="导出当前周期K线">
              ⇩
            </button>
            <button className="icon-button" type="button" onClick={() => document.getElementById("stock-market")?.requestFullscreen?.()} title="全屏研究图表" aria-label="全屏研究图表">
              ⛶
            </button>
          </div>

          <div className="ohlc-ribbon" aria-live="polite">
            <span>{selectedCandle?.key ?? "—"}</span>
            <span>开 <b>{selectedCandle ? formatNumber(selectedCandle.open, 3) : "—"}</b></span>
            <span>高 <b>{selectedCandle ? formatNumber(selectedCandle.high, 3) : "—"}</b></span>
            <span>低 <b>{selectedCandle ? formatNumber(selectedCandle.low, 3) : "—"}</b></span>
            <span>收 <b className={(selectedCandle?.change ?? 0) >= 0 ? "is-up" : "is-down"}>{selectedCandle ? formatNumber(selectedCandle.close, 3) : "—"}</b></span>
            <span>幅 <b className={(selectedCandle?.changePct ?? 0) >= 0 ? "is-up" : "is-down"}>{selectedCandle ? `${selectedCandle.changePct >= 0 ? "+" : ""}${formatNumber(selectedCandle.changePct, 2)}%` : "—"}</b></span>
          </div>

          <MarketChart
            appearance={appearance}
            candles={candles}
            benchmarkCandles={timeframe === "1d" ? benchmarkCandles : []}
            indicators={indicators}
            overlays={overlays}
            lowerIndicator={lowerIndicator}
            range={range}
            events={chartEvents}
            annotations={annotations.filter((item) => item.code === selectedCode)}
            onRangeChange={setRange}
            onHover={setHoverIndex}
          />

          <div className="chart-footer-controls">
            <div className="segmented compact" aria-label="副图指标">
              {lowerIndicators.map((indicator) => (
                <button key={indicator} type="button" className={lowerIndicator === indicator ? "active" : ""} aria-pressed={lowerIndicator === indicator} onClick={() => setLowerIndicator(indicator)}>
                  {indicator}
                </button>
              ))}
            </div>
            <div className="range-control">
              <span>{candles[range.from]?.label ?? "—"}</span>
              <div className="dual-range">
                <input
                  aria-label="可视区间起点"
                  type="range"
                  min={0}
                  max={Math.max(0, candles.length - 1)}
                  value={Math.min(range.from, Math.max(0, candles.length - 1))}
                  onChange={(event) => {
                    const from = Math.min(Number(event.target.value), Math.max(0, range.to - 1));
                    setRange({ from, to: range.to });
                  }}
                />
                <input
                  aria-label="可视区间终点"
                  type="range"
                  min={0}
                  max={Math.max(0, candles.length - 1)}
                  value={Math.min(range.to, Math.max(0, candles.length - 1))}
                  onChange={(event) => {
                    const to = Math.max(Number(event.target.value), Math.min(candles.length - 1, range.from + 1));
                    setRange({ from: range.from, to });
                  }}
                />
              </div>
              <span>{candles[range.to]?.label ?? "—"}</span>
              {[20, 60, 120, 250].map((periods) => <button key={periods} type="button" onClick={() => setRange({ from: Math.max(0, candles.length - periods), to: Math.max(0, candles.length - 1) })}>{periods >= 250 ? "1年" : `${periods}日`}</button>)}
              <button type="button" onClick={() => setRange({ from: 0, to: Math.max(0, candles.length - 1) })}>全部</button>
            </div>
          </div>
          <details className="chart-data-alternative">
            <summary>图表文字摘要与可访问数据</summary>
            <p id="chart-accessible-summary">{klineConclusion?.summary ?? "当前样本不足。"} 区间收益 {riskMetrics.totalReturn == null ? "—" : `${riskMetrics.totalReturn.toFixed(2)}%`}，最大回撤 {riskMetrics.maxDrawdown == null ? "—" : `${riskMetrics.maxDrawdown.toFixed(2)}%`}。</p>
            <div className="table-wrap"><table><thead><tr><th>日期</th><th>开</th><th>高</th><th>低</th><th>收</th><th>涨跌幅</th></tr></thead><tbody>{candles.slice(-20).reverse().map((candle) => <tr key={candle.key}><td>{candle.key}</td><td>{formatNumber(candle.open, 3)}</td><td>{formatNumber(candle.high, 3)}</td><td>{formatNumber(candle.low, 3)}</td><td>{formatNumber(candle.close, 3)}</td><td>{candle.changePct.toFixed(2)}%</td></tr>)}</tbody></table></div>
          </details>
        </div>

        <aside className={`analysis-rail ${analysisExpanded ? "is-expanded" : ""}`}>
          <button className="mobile-analysis-toggle" type="button" aria-expanded={analysisExpanded} onClick={() => setAnalysisExpanded((value) => !value)}>
            {analysisExpanded ? "收起辅助分析" : "展开数据、资金行为与技术快照"}
          </button>
          <section className="rail-card conclusion-card" id="kline-analysis">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">KLINE READOUT</p>
                <h3>K线研判</h3>
              </div>
              <span className="calc-badge">{timeframe.toUpperCase()}</span>
            </div>
            {klineConclusion ? (
              <>
                <div className="conclusion-hero">
                  <strong className={klineConclusion.tone === "up" ? "is-up" : klineConclusion.tone === "down" ? "is-down" : ""}>
                    {klineConclusion.label}
                  </strong>
                  <span>{selectedCandle?.key}</span>
                </div>
                <p className="conclusion-copy">{klineConclusion.summary}</p>
                <div className="readout-grid">
                  <IntentMetric label="近20期支撑" value={formatNumber(klineConclusion.support, 3)} />
                  <IntentMetric label="近20期压力" value={formatNumber(klineConclusion.resistance, 3)} />
                  <IntentMetric label="ATR14" value={klineConclusion.atr == null ? "—" : formatNumber(klineConclusion.atr, 3)} />
                  <IntentMetric
                    label="九转阶段"
                    value={klineConclusion.nineTurn ? `${klineConclusion.nineTurn.direction === "buy" ? "下跌" : "上涨"}${klineConclusion.nineTurn.count}${klineConclusion.nineTurn.completed ? "完成" : ""}` : "—"}
                  />
                </div>
                <ul className="analysis-points">
                  {klineConclusion.points.slice(0, 5).map((point) => <li key={point}>{point}</li>)}
                </ul>
                <p className="method-note">B/S 为九转、MACD、KDJ、RSI、MA5 与 BOLL 的规则组合信号，不是交易指令。</p>
              </>
            ) : <p className="empty-note">当前周期暂无足够 K 线用于研判。</p>}
          </section>

          <section className="rail-card data-card">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">DATASET</p>
                <h3>数据概览</h3>
              </div>
              <span className="live-indicator"><i /> {isDemo ? "DEMO" : "HTTPS"}</span>
            </div>
            <div className="data-grid">
              <Stat label="行情数据点" value={dataset.rows.length.toLocaleString("zh-CN")} />
              <Stat label="K线数量" value={candles.length.toLocaleString("zh-CN")} />
              <Stat label="股票数量" value={String(dataset.codes.length)} />
              <Stat label="跳过异常" value={String(dataset.skipped)} />
              <Stat label="性质覆盖" value={`${formatNumber(dataset.quality.sideCoverage * 100, 1)}%`} />
              <Stat label="疑似重复" value={`${formatNumber(dataset.quality.duplicateRate * 100, 2)}%`} />
            </div>
          </section>

          <section className="rail-card sentiment-card">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">NEWS SENTIMENT</p>
                <h3>舆情概览</h3>
              </div>
              <span className={`sentiment-chip ${sentimentClass(newsDataset.summary.tone)}`}>{newsDataset.summary.tone}</span>
            </div>
            {newsDataset.items.length > 0 ? (
              <>
                <div className="sentiment-hero">
                  <strong className={sentimentClass(newsDataset.summary.tone)}>
                    {newsDataset.summary.averageScore >= 0 ? "+" : ""}{newsDataset.summary.averageScore.toFixed(3)}
                  </strong>
                  <span>{newsDataset.summary.total} 条 · {newsDataset.summary.portals} 个入口</span>
                </div>
                <div className="sentiment-bar" aria-label={`正面 ${newsDataset.summary.positive}，中性 ${newsDataset.summary.neutral}，负面 ${newsDataset.summary.negative}`}>
                  <i className="positive" style={{ flex: newsDataset.summary.positive }} />
                  <i className="neutral" style={{ flex: newsDataset.summary.neutral }} />
                  <i className="negative" style={{ flex: newsDataset.summary.negative }} />
                </div>
                <div className="sentiment-counts">
                  <span><i className="positive" />正面 <b>{newsDataset.summary.positive}</b></span>
                  <span><i className="neutral" />中性 <b>{newsDataset.summary.neutral}</b></span>
                  <span><i className="negative" />负面 <b>{newsDataset.summary.negative}</b></span>
                </div>
                <p className="method-note">关键词情绪仅用于新闻初筛，不理解反讽、否定和复杂上下文。</p>
              </>
            ) : <p className="empty-note">{newsLoad.phase === "loading" ? "新闻应用正在采集，完成后将自动更新。" : "输入股票名称或代码即可自动获取新闻。"}</p>}
          </section>

          <section className="rail-card intent-card">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">L1 BEHAVIOR PROXY</p>
                <h3>主力行为代理</h3>
              </div>
              <span className="calc-badge">{intent?.date ?? "—"}</span>
            </div>
            {intent ? (
              <>
                <div className="intent-hero">
                  <strong className={intent.tone === "up" ? "is-up" : intent.tone === "down" ? "is-down" : ""}>{intent.label}</strong>
                  <span>{intent.confidence}% 置信</span>
                </div>
                <div className="confidence-track" aria-label={`代理信号置信度 ${intent.confidence}%`}>
                  <i style={{ width: `${intent.confidence}%` }} />
                </div>
                <div className="intent-grid">
                  <IntentMetric label="主动净额" value={signedCompact(intent.activeNetAmount)} tone={intent.activeNetAmount} />
                  <IntentMetric label="主动净比" value={signedPercent(intent.activeNetRatio)} tone={intent.activeNetRatio} />
                  <IntentMetric label="大额净额" value={signedCompact(intent.largeNetAmount)} tone={intent.largeNetAmount} />
                  <IntentMetric label="尾盘净比" value={signedPercent(intent.tailNetRatio)} tone={intent.tailNetRatio} />
                  <IntentMetric label="收盘/VWAP" value={signedPercent(intent.closeVsVwapPct)} tone={intent.closeVsVwapPct} />
                  <IntentMetric label="换手率" value={intent.turnoverPct == null ? "—" : `${formatNumber(intent.turnoverPct, 2)}%`} />
                </div>
                <ul className="signal-list">
                  {intent.evidence.slice(0, 4).map((item) => <li key={item}>{item}</li>)}
                </ul>
                <details className="quality-note">
                  <summary>数据限制与质量提示</summary>
                  <ul>{intent.warnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </details>
              </>
            ) : <p className="empty-note">{dailyOnly ? "当前 HTTPS 行情为日 K 聚合，不包含逐笔买卖性质；L1 行为代理已自动停用。" : "当前日期没有可分析的连续竞价记录。"}</p>}
          </section>

          <section className="rail-card focus-card">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">CURSOR</p>
                <h3>当前 K 线</h3>
              </div>
              <span className="mono-date">{selectedCandle?.key ?? "—"}</span>
            </div>
            <div className="focus-price">
              <strong className={(selectedCandle?.change ?? 0) >= 0 ? "is-up" : "is-down"}>{selectedCandle ? formatNumber(selectedCandle.close, 3) : "—"}</strong>
              <span className={(selectedCandle?.changePct ?? 0) >= 0 ? "is-up" : "is-down"}>{selectedCandle ? `${selectedCandle.changePct >= 0 ? "+" : ""}${formatNumber(selectedCandle.changePct, 2)}%` : "—"}</span>
            </div>
            <dl className="detail-list">
              <Detail label="振幅" value={selectedCandle ? `${formatNumber(((selectedCandle.high - selectedCandle.low) / selectedCandle.open) * 100, 2)}%` : "—"} />
              <Detail label="成交量" value={selectedCandle ? compactNumber(selectedCandle.volume) : "—"} />
              <Detail label="成交额" value={selectedCandle ? compactNumber(selectedCandle.amount) : "—"} />
              <Detail label="VWAP" value={selectedCandle ? formatNumber(selectedCandle.vwap, 3) : "—"} />
              <Detail label="ATR14" value={currentIndicator.atr == null ? "—" : formatNumber(currentIndicator.atr, 3)} />
              <Detail label="神奇九转" value={currentIndicator.nineTurn ? `${currentIndicator.nineTurn.direction === "buy" ? "下跌" : "上涨"} ${currentIndicator.nineTurn.count}${currentIndicator.nineTurn.completed ? " · 完成" : ""}` : "—"} />
              <Detail label="买卖指引" value={currentIndicator.guide ? `${currentIndicator.guide.type === "buy" ? "B" : "S"}${currentIndicator.guide.score}` : "—"} />
              <Detail label="换手率" value={selectedCandle?.turnoverPct == null ? "—" : `${formatNumber(selectedCandle.turnoverPct, 2)}%`} />
            </dl>
          </section>

          <section className="rail-card indicator-card">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">INDICATORS</p>
                <h3>技术快照</h3>
              </div>
              <span className="calc-badge">AUTO</span>
            </div>
            <div className="indicator-list">
              <Indicator label="MA 5 / 10 / 20" values={[currentIndicator.ma5, currentIndicator.ma10, currentIndicator.ma20]} colors={["gold", "blue", "purple"]} />
              <Indicator label="MACD DIF / DEA" values={[currentIndicator.dif, currentIndicator.dea]} colors={["gold", "blue"]} />
              <Indicator label="KDJ K / D / J" values={[currentIndicator.k, currentIndicator.d, currentIndicator.j]} colors={["gold", "blue", "purple"]} />
              <Indicator label="RSI 14" values={[currentIndicator.rsi]} colors={["blue"]} />
              <Indicator label="ATR 14" values={[currentIndicator.atr]} colors={["pink"]} />
            </div>
          </section>
          <SignalBacktestCard backtest={signalBacktest} />
        </aside>
      </section>

      <ResearchDock
        key={selectedCode}
        code={selectedCode}
        name={selectedName}
        isDemo={isDemo}
        busy={busy}
        isWatched={watchlist.some((item) => item.code === selectedCode)}
        hasSavedView={hasSavedView}
        freshness={freshness}
        dataProfile={{ level: dataset.dataLevel, priceBasis: dataset.priceBasis ?? "", amountBasis: dataset.amountBasis, timePrecision: dataset.timePrecision, qualityWarnings: dataset.quality.warnings.length }}
        notice={workspaceNotice}
        cloudStatus={cloudStatus}
        annotations={annotations}
        onToggleWatch={toggleWatch}
        onRefresh={() => void fetchStockData(selectedCode)}
        onCopyLink={() => void copyWorkspaceLink()}
        onSaveView={saveWorkspace}
        onRestoreView={() => void restoreWorkspace()}
        onExportReport={exportResearchReport}
        onPrint={() => window.print()}
        onAddAnnotation={addAnnotation}
        onRemoveAnnotation={removeAnnotation}
      />

      <div className="advanced-only">
        <AdvancedResearchPanel risk={riskMetrics} factors={factorProfile} events={eventStudies} benchmarkName={({ "000300": "沪深300", "000001": "上证指数", "399001": "深证成指", "399006": "创业板指" } as Record<string, string>)[benchmarkCode] ?? benchmarkCode} />
      </div>

      <FinancialDashboard dataset={financialDataset} load={financialLoad} />
      <details className="legacy-financial-summary">
        <summary>查看原始报告摘要、估值与分红明细</summary>
        <FundamentalsPanel dataset={financialDataset} load={financialLoad} />
        <FinancialReports dataset={financialDataset} load={financialLoad} />
      </details>

      <section className="recent-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RECENT BARS</p>
            <h3>最近 K 线</h3>
          </div>
          <span>按当前数据粒度在浏览器内聚合 · 可横向滑动查看更多</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>时间</th><th>开盘</th><th>最高</th><th>最低</th><th>收盘</th><th>VWAP</th><th>涨跌幅</th><th>成交量</th><th>成交额</th><th>换手率</th></tr>
            </thead>
            <tbody>
              {candles.slice(-8).reverse().map((candle) => (
                <tr key={candle.key}>
                  <td>{candle.key}</td>
                  <td>{formatNumber(candle.open, 3)}</td>
                  <td>{formatNumber(candle.high, 3)}</td>
                  <td>{formatNumber(candle.low, 3)}</td>
                  <td>{formatNumber(candle.close, 3)}</td>
                  <td>{formatNumber(candle.vwap, 3)}</td>
                  <td className={candle.changePct >= 0 ? "is-up" : "is-down"}>{candle.changePct >= 0 ? "+" : ""}{formatNumber(candle.changePct, 2)}%</td>
                  <td>{compactNumber(candle.volume)}</td>
                  <td>{compactNumber(candle.amount)}</td>
                  <td>{candle.turnoverPct == null ? "—" : `${formatNumber(candle.turnoverPct, 2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="news-card" id="stock-news">
        <div className="section-heading news-heading">
          <div>
            <p className="eyebrow">MARKET INTELLIGENCE</p>
            <h3>舆情资讯</h3>
          </div>
          <div className="news-heading-actions">
            <div className="news-filters" aria-label="按情绪筛选新闻">
              {(["全部", "正面", "中性", "负面"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={newsFilter === filter ? "active" : ""}
                  aria-pressed={newsFilter === filter}
                  onClick={() => setNewsFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>
        {newsDataset.items.length > 0 ? (
          <div className="news-layout">
            <aside className="news-summary-panel">
              <p className="eyebrow">SENTIMENT PULSE</p>
              <strong className={sentimentClass(newsDataset.summary.tone)}>{newsDataset.summary.tone}舆情</strong>
              <span className="news-score">综合分 {newsDataset.summary.averageScore >= 0 ? "+" : ""}{newsDataset.summary.averageScore.toFixed(3)}</span>
              <dl>
                <Detail label="新闻总数" value={String(newsDataset.summary.total)} />
                <Detail label="检索入口" value={String(newsDataset.summary.portals)} />
                <Detail label="最新发布时间" value={newsDataset.summary.latestAt || "—"} />
                <Detail label="跳过异常记录" value={String(newsDataset.skipped)} />
              </dl>
              <p>新闻来自公开检索入口，相关性与情绪分数用于排序和初筛。请打开原文核验事实、发布时间及上下文。</p>
            </aside>
            <div className="news-feed" aria-live="polite">
              {visibleNews.length > 0 ? visibleNews.map((item) => (
                <NewsArticle key={`${item.url}-${item.publishedAt}`} item={item} />
              )) : <p className="news-empty-filter">当前筛选条件下没有新闻。</p>}
            </div>
          </div>
        ) : (
          <div className={`news-empty-state ${newsLoad.phase === "loading" ? "is-loading" : ""}`} aria-live="polite">
            <div className="news-empty-mark">{newsLoad.phase === "loading" ? <span className="loading-spinner" /> : "NEWS"}</div>
            <div>
              <h4>{newsLoad.phase === "loading" ? "新闻数据加载中" : "输入股票名称或代码一键获取舆情"}</h4>
              <p>{newsLoad.phase === "loading" ? "HTTPS 新闻服务完成去重后，新闻列表与情绪统计会立即显示。" : "页面会自动调用服务端新闻接口，并展示标题、来源、摘要、情绪倾向和原文链接。"}</p>
            </div>
          </div>
        )}
      </section>

      <footer className="footer-note">
        <span>输入股票后，行情、估值分红、历史财报诊断与新闻会同步获取，先完成的数据会先更新页面。</span>
        <span>日K聚合、Level-1、九转、B/S、因子、主力行为与新闻情绪均为研究代理，只供投资参考，不构成投资建议。</span>
      </footer>
      </div>
    </main>
  );
}

function LoadBadge({ phase }: { phase: LoadPhase }) {
  const label = {
    idle: "等待",
    loading: "加载中",
    success: "已就绪",
    error: "失败",
  }[phase];

  return (
    <span className={`load-badge is-${phase}`}>
      {phase === "loading" ? <i className="loading-spinner" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

function FundamentalsPanel({ dataset, load }: { dataset: FinancialDataset; load: LoadState }) {
  const latestReport = dataset.reports[0];
  const snapshot = dataset.snapshot;
  const hasFundamentals = Boolean(dataset.reports.length || snapshot.asOfDate);
  const dividendNote = snapshot.cashDividendPerShareTtm == null
    ? "近12个月暂无已实施现金分红"
    : `近12个月 ${formatPerShare(snapshot.cashDividendPerShareTtm)} · ${snapshot.dividendPaymentsTtm} 次`;

  return (
    <section className="fundamentals-card" id="stock-fundamentals" aria-live="polite">
      <div className="fundamentals-heading">
        <div>
          <p className="eyebrow">FUNDAMENTAL SNAPSHOT</p>
          <h3>基本面全景</h3>
        </div>
        <div className="fundamentals-heading-meta">
          {snapshot.industry ? <span className="industry-pill">{snapshot.industry}</span> : null}
          <span>{snapshot.asOfDate ? `估值截至 ${snapshot.asOfDate}` : "随股票查询同步更新"}</span>
          {latestReport ? <span>财报 {latestReport.periodLabel}</span> : null}
          <LoadBadge phase={load.phase} />
        </div>
      </div>
      {hasFundamentals ? (
        <>
          <div className="fundamental-groups">
            <FundamentalGroup title="估值水平" subtitle="VALUATION">
              <FundamentalMetric label="市盈率 TTM" value={formatMultiple(snapshot.peTtm)} note="滚动12个月" />
              <FundamentalMetric label="市盈率 静态" value={formatMultiple(snapshot.peStatic)} note="最近年报" />
              <FundamentalMetric label="市净率 MRQ" value={formatMultiple(snapshot.pb)} note="最近报告期" />
              <FundamentalMetric label="市销率 TTM" value={formatMultiple(snapshot.psTtm)} note="滚动12个月" />
            </FundamentalGroup>
            <FundamentalGroup title="规模与现金流" subtitle="MARKET SCALE">
              <FundamentalMetric label="总市值" value={formatFinancialAmount(snapshot.totalMarketCap)} />
              <FundamentalMetric label="流通市值" value={formatFinancialAmount(snapshot.floatMarketCap)} />
              <FundamentalMetric label="市现率 TTM" value={formatMultiple(snapshot.pcfTtm)} note="经营现金流" />
              <FundamentalMetric label="PEG" value={formatMultiple(snapshot.peg)} note="增长估值比" />
            </FundamentalGroup>
            <FundamentalGroup title="每股数据" subtitle="PER SHARE">
              <FundamentalMetric label="基本每股收益" value={formatPerShare(latestReport?.basicEps ?? null)} note={latestReport?.periodLabel} />
              <FundamentalMetric label="每股净资产" value={formatPerShare(latestReport?.bookValuePerShare ?? null)} note={latestReport?.periodLabel} />
              <FundamentalMetric label="每股经营现金流" value={formatPerShare(latestReport?.operatingCashFlowPerShare ?? null)} note={latestReport?.periodLabel} />
              <FundamentalMetric label="总股本" value={formatShares(snapshot.totalShares)} />
            </FundamentalGroup>
            <FundamentalGroup title="股东回报" subtitle="RETURN">
              <FundamentalMetric label="股息率 TTM" value={formatFinancialPercent(snapshot.dividendYieldTtm, false)} note={dividendNote} accent="gold" />
              <FundamentalMetric label="每股现金分红 TTM" value={formatPerShare(snapshot.cashDividendPerShareTtm)} note="税前已实施" />
              <FundamentalMetric label="加权 ROE" value={formatFinancialPercent(latestReport?.roe ?? null, false)} note={latestReport?.periodLabel} />
              <FundamentalMetric label="总资产净利率" value={formatFinancialPercent(latestReport?.roa ?? null, false)} note={latestReport?.periodLabel} />
            </FundamentalGroup>
            <FundamentalGroup title="成长与质量" subtitle="QUALITY">
              <FundamentalMetric label="营业收入同比" value={formatFinancialPercent(latestReport?.revenueYoY ?? null)} tone={latestReport?.revenueYoY} />
              <FundamentalMetric label="归母净利润同比" value={formatFinancialPercent(latestReport?.netProfitYoY ?? null)} tone={latestReport?.netProfitYoY} />
              <FundamentalMetric label="销售净利率" value={formatFinancialPercent(latestReport?.netMargin ?? null, false)} />
              <FundamentalMetric label="资产负债率" value={formatFinancialPercent(latestReport?.debtAssetRatio ?? null, false)} />
            </FundamentalGroup>
          </div>
          <div className="fundamentals-note">
            <span>股息率按近12个月已实施税前现金分红 ÷ 估值日收盘价计算。</span>
            {snapshot.latestDividendProfile ? (
              <span>最近分红：{snapshot.latestDividendProfile}{snapshot.latestDividendDate ? ` · ${snapshot.latestDividendDate}` : ""}</span>
            ) : null}
            <span>来源：{dataset.source}</span>
          </div>
        </>
      ) : (
        <div className={`fundamentals-empty ${load.phase === "loading" ? "is-loading" : ""}`}>
          {load.phase === "loading" ? <span className="loading-spinner" aria-hidden="true" /> : <span className="fundamentals-empty-mark">20</span>}
          <div>
            <strong>{load.phase === "loading" ? "正在汇总基本面指标" : load.phase === "error" ? "基本面暂时未加载" : "输入股票查看 20 项常用基本面指标"}</strong>
            <span>{load.detail}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function FundamentalGroup({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="fundamental-group">
      <header><strong>{title}</strong><span>{subtitle}</span></header>
      <div className="fundamental-metrics">{children}</div>
    </section>
  );
}

function FundamentalMetric({
  label,
  value,
  note,
  tone,
  accent,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: number | null;
  accent?: "gold";
}) {
  const toneClass = tone == null || !Number.isFinite(tone) ? "" : metricToneClass(tone);
  return (
    <div className={`fundamental-metric ${accent ? `is-${accent}` : ""}`} title={note || undefined}>
      <span>{label}</span>
      <strong className={toneClass}>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function FinancialReports({ dataset, load }: { dataset: FinancialDataset; load: LoadState }) {
  const chartReports = [...dataset.reports].reverse();
  const maxRevenue = Math.max(0, ...chartReports.map((report) => report.revenue ?? 0));

  return (
    <section className="financial-card" id="stock-financials">
      <div className="section-heading financial-heading">
        <div>
          <p className="eyebrow">FINANCIAL REPORTS</p>
          <h3>近三期财报</h3>
        </div>
        <div className="financial-heading-meta">
          <span>{dataset.name ? `${dataset.name} · ${dataset.code}` : "随股票查询同步更新"}</span>
          <LoadBadge phase={load.phase} />
        </div>
      </div>
      {dataset.reports.length > 0 ? (
        <div className="financial-layout">
          <div className="financial-report-list">
            {dataset.reports.map((report) => (
              <FinancialReportCard key={report.reportDate} report={report} />
            ))}
          </div>
          <figure className="revenue-figure">
            <figcaption>
              <div>
                <p className="eyebrow">REVENUE CHANGE</p>
                <h4>营业总收入变化</h4>
              </div>
              <span>报告期累计值</span>
            </figcaption>
            <div
              className="revenue-bars"
              role="img"
              aria-label={chartReports.map((report) => `${report.periodLabel}营业总收入${formatFinancialAmount(report.revenue)}`).join("，")}
            >
              {chartReports.map((report, index) => {
                const height = report.revenue == null || maxRevenue <= 0
                  ? 0
                  : Math.max(8, (Math.max(0, report.revenue) / maxRevenue) * 100);
                return (
                  <div className="revenue-column" key={report.reportDate}>
                    <span className="revenue-value">{formatFinancialAmount(report.revenue)}</span>
                    <div className="revenue-track">
                      <i className={`revenue-bar bar-${index + 1}`} style={{ height: `${height}%` }} />
                    </div>
                    <strong>{report.periodLabel}</strong>
                    <span className={metricToneClass(report.revenueYoY)}>
                      同比 {formatFinancialPercent(report.revenueYoY)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="financial-method-note">
              口径：最近三份已披露定期报告；营收为各报告期累计值，并非单季度值。来源：{dataset.source}。
            </p>
          </figure>
        </div>
      ) : (
        <div className={`financial-empty-state ${load.phase === "loading" ? "is-loading" : ""}`} aria-live="polite">
          <div className="financial-empty-mark">{load.phase === "loading" ? <span className="loading-spinner" /> : "FIN"}</div>
          <div>
            <h4>{load.phase === "loading" ? "财报数据加载中" : load.phase === "error" ? "财报暂时未加载" : "输入股票查看近三期财报"}</h4>
            <p>{load.detail}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function FinancialReportCard({ report }: { report: FinancialReport }) {
  return (
    <article className="financial-report-card">
      <header>
        <div>
          <strong>{report.periodLabel}</strong>
          <span>{report.reportType} · {report.reportDate}</span>
        </div>
        {report.noticeDate ? <span>披露 {report.noticeDate}</span> : null}
      </header>
      <div className="financial-metrics">
        <FinancialMetric label="营业总收入" value={formatFinancialAmount(report.revenue)} change={report.revenueYoY} />
        <FinancialMetric label="归母净利润" value={formatFinancialAmount(report.netProfit)} change={report.netProfitYoY} />
        <FinancialMetric label="基本每股收益" value={report.basicEps == null ? "—" : `${formatNumber(report.basicEps, 3)} 元`} />
        <FinancialMetric label="加权净资产收益率" value={formatFinancialPercent(report.roe)} />
      </div>
    </article>
  );
}

function FinancialMetric({ label, value, change }: { label: string; value: string; change?: number | null }) {
  return (
    <div className="financial-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {change !== undefined ? <small className={metricToneClass(change)}>同比 {formatFinancialPercent(change)}</small> : null}
    </div>
  );
}

function formatFinancialAmount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) return `${formatNumber(value / 100_000_000, absolute >= 10_000_000_000 ? 1 : 2)} 亿`;
  if (absolute >= 10_000) return `${formatNumber(value / 10_000, 2)} 万`;
  return `${formatNumber(value, 0)} 元`;
}

function formatFinancialPercent(value: number | null, signed = true): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${signed && value >= 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function formatMultiple(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, 2)}×`;
}

function formatPerShare(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value, 3)} 元`;
}

function formatShares(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value >= 100_000_000
    ? `${formatNumber(value / 100_000_000, 2)} 亿股`
    : `${formatNumber(value / 10_000, 2)} 万股`;
}

function metricToneClass(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value >= 0 ? "is-up" : "is-down";
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function NewsArticle({ item }: { item: NewsItem }) {
  const matchedTerms = item.sentiment === "负面" ? item.negativeTerms : item.positiveTerms;
  return (
    <article className="news-item">
      <div className="news-item-meta">
        <span className={`sentiment-chip ${sentimentClass(item.sentiment)}`}>{item.sentiment} {item.sentimentScore >= 0 ? "+" : ""}{item.sentimentScore.toFixed(3)}</span>
        <span>{item.publishedAt || "时间未知"}</span>
        <span>{item.media || item.portal || "来源未知"}</span>
        {item.relevance > 0 ? <span>相关性 {Math.round(item.relevance * 100)}%</span> : null}
      </div>
      <a href={item.url} target="_blank" rel="noreferrer">
        <h4>{item.title}</h4>
      </a>
      {item.summary ? <p>{item.summary}</p> : null}
      <div className="news-item-footer">
        <span>{[item.portal, item.channel].filter(Boolean).join(" · ")}</span>
        {matchedTerms.length > 0 ? (
          <span className="term-list">依据：{matchedTerms.slice(0, 4).join(" / ")}</span>
        ) : <span>未命中显著情绪词</span>}
      </div>
    </article>
  );
}

function sentimentClass(sentiment: NewsSentiment): string {
  if (sentiment === "正面") return "is-positive";
  if (sentiment === "负面") return "is-negative";
  return "is-neutral";
}

function IntentMetric({ label, value, tone = 0 }: { label: string; value: string; tone?: number }) {
  return <div><span>{label}</span><strong className={tone > 0 ? "is-up" : tone < 0 ? "is-down" : ""}>{value}</strong></div>;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function signedCompact(value: number): string {
  return `${value >= 0 ? "+" : "-"}${compactNumber(Math.abs(value))}`;
}

function Toggle({ active, label, color, onClick }: { active: boolean; label: string; color: string; onClick: () => void }) {
  return (
    <button type="button" className={active ? "active" : ""} aria-pressed={active} onClick={onClick}>
      <i className={`dot ${color}`} aria-hidden="true" />{label}
    </button>
  );
}

function Indicator({ label, values, colors }: { label: string; values: Array<number | null | undefined>; colors: string[] }) {
  return (
    <div className="indicator-row">
      <span>{label}</span>
      <div>
        {values.map((value, index) => (
          <b key={`${label}-${index}`} className={colors[index]}>{value == null || !Number.isFinite(value) ? "—" : formatNumber(value, 3)}</b>
        ))}
      </div>
    </div>
  );
}

function parseAnnotations(value: unknown): ChartAnnotation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const annotation = item as Partial<ChartAnnotation>;
    const id = String(annotation.id ?? "").slice(0, 80);
    const code = String(annotation.code ?? "");
    const text = String(annotation.text ?? "").trim().slice(0, 180);
    if (!id || seen.has(id) || !/^\d{6}$/.test(code) || !text) return [];
    seen.add(id);
    const price = annotation.price == null ? null : Number(annotation.price);
    return [{ id, code, text, date: String(annotation.date ?? "").slice(0, 10), price: Number.isFinite(price) ? price : null, createdAt: String(annotation.createdAt ?? "") }];
  }).slice(0, 100);
}
