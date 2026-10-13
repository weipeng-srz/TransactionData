"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "./components/AuthProvider";
import GuestHome from "./components/GuestHome";
import { accountStorage } from "./lib/accountStorage";
import StockReviewEntry from "./features/review/StockReviewEntry";
import SignalBacktestCard from "./components/SignalBacktestCard";
import AdvancedResearchPanel from "./components/AdvancedResearchPanel";
import HoldingProfitCard from "./components/HoldingProfitCard";
import HoldingRiskSummary from "./components/HoldingRiskSummary";
import StockScoreCard from "./components/StockScoreCard";
import BeginnerGuideCard from "./components/BeginnerGuideCard";
import { useAppearance } from "./components/AppearanceProvider";
import PortfolioHome from "./components/PortfolioHome";
import SiteBanner from "./components/SiteBanner";
import StockWorkspaceHeader from "./components/StockWorkspaceHeader";
import StockModelContent from "./features/stock/StockModelContent";
import { WorkspaceTabs, WorkspacePanel } from "./components/WorkspaceTabs";
import { useWorkspaceView } from "./hooks/useWorkspaceView";
import { useResearchPrint } from "./hooks/useResearchPrint";
import { financialWorkspaceView } from "./lib/financialNavigation";
import { workspaceAnchor, workspaceNavigationEvent } from "./lib/workspaceNavigation";
import workspaceStyles from "./components/StockWorkspace.module.css";
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
  type HolderStructure,
} from "./lib/financials";
import {
  backtestGuideSignals,
  buildChartEvents,
  buildResearchReport,
  calculateRiskMetrics,
  type ChartAnnotation,
  type SavedWorkspace,
} from "./lib/research";
import { buildEventStudies, buildFactorProfile } from "./lib/advancedResearch";
import { readCachedText, writeCachedText } from "./lib/browserCache";
import { reportTelemetry } from "./lib/telemetry";
import type { RealtimeSnapshot } from "./lib/realtimeMarket";
import { mergeClosedCnRealtimeDay } from "./lib/closedMarketDay";
import { mergeCnRealtimeDailyCandle } from "./lib/realtimeDailyCandle";
import { parseHoldings, type StockHoldings } from "./lib/holdings";
import { buildHoldingRiskPlan } from "./lib/holdingRisk";
import { buildStockScore } from "./lib/stockScore";
import { publicStockLookupError } from "./lib/stockLookupError";
import { resolveStoredViewMode, type ViewMode } from "./lib/viewMode";
import {
  cnStockCodePattern,
  currencySymbol,
  isUSStockSymbol,
  marketLabel,
  normalizeUSSymbol,
  parseStockRoute,
  stockRouteKey,
  stockStorageKey,
  type StockCurrency,
  type StockIdentity,
  type StockMarket,
} from "./lib/security";

const loadMarketChart = () => import("./components/MarketChart");
const loadRealtimeTradingPanel = () => import("./components/RealtimeTradingPanel");
const loadFinancialDashboard = () => import("./components/FinancialDashboard");
const loadNextDayPredictionCard = () => import("./components/NextDayPredictionCard");

const MarketChart = dynamic(loadMarketChart);
const RealtimeTradingPanel = dynamic(loadRealtimeTradingPanel);
const FinancialDashboard = dynamic(loadFinancialDashboard);
const NextDayPredictionCard = dynamic(loadNextDayPredictionCard);

function preloadStockPanels() {
  return Promise.all([
    loadMarketChart(),
    loadRealtimeTradingPanel(),
    loadFinancialDashboard(),
    loadNextDayPredictionCard(),
  ]);
}

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
  market?: StockMarket;
  currency?: StockCurrency;
  queriedAt: number;
};

const stockCodePattern = /^(?:(?:sh|sz)\d{6}|\d{6}(?:\.(?:sh|sz))?)$/i;
const recentStocksStorageKey = "ticklens.recent-stocks.v1";
const workspaceStorageKey = "ticklens.saved-workspace.v1";
const annotationsStorageKey = "ticklens.annotations.v1";
const viewModeStorageKey = "ticklens.view-mode.v1";
const holdingsStorageKey = "ticklens.holdings.v1";
const maxRecentStocks = 20;
const requestTimeoutMs = 18_000;
const stockViews = ["overview", "market", "financials", "news", "models", "notes"] as const;
const stockAnchors = {
  "stock-score": "overview", "stock-market": "market", "realtime-trading": "market", "kline-analysis": "market",
  "stock-financials": "financials", "finance-*": "financials", "stock-news": "news",
  "next-day-prediction": "models", "signal-backtest": "models", "advanced-research": "models", "research-tools": "notes",
} as const;

function defaultRange(length: number, timeframe: Timeframe) {
  const visibleCount = timeframe === "1d" ? Math.min(length, 120) : Math.min(length, 140);
  return { from: Math.max(0, length - visibleCount), to: Math.max(0, length - 1) };
}

async function resolveStockQuery(value: string, signal?: AbortSignal): Promise<StockIdentity> {
  if (stockCodePattern.test(value)) {
    return {
      code: value.replace(/^(?:sh|sz)/i, "").replace(/\.(?:sh|sz)$/i, ""),
      name: "",
      market: "CN",
      currency: "CNY",
    };
  }
  const routeIdentity = parseStockRoute(value);
  const queryLooksUS = Boolean(routeIdentity?.market === "US" || /^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(value.trim()));
  const lookup = async (endpoint: string) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: routeIdentity?.code ?? value }),
      signal,
    });
    const body = await response.text();
    let payload: { code?: unknown; name?: unknown; market?: unknown; currency?: unknown; error?: unknown } = {};
    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      if (body.trim()) payload.error = body.trim();
    }
    if (!response.ok) throw new Error(String(payload.error || "没有找到匹配的股票"));
    const code = String(payload.code ?? "").trim();
    const name = String(payload.name ?? "").trim();
    const market: StockMarket = payload.market === "US" || endpoint.includes("us-stock") ? "US" : "CN";
    if (!(market === "US" ? isUSStockSymbol(code) : cnStockCodePattern.test(code)) || !name) throw new Error("股票名称查询返回了无效结果");
    const currency: StockCurrency = market === "US" ? "USD" : "CNY";
    return { code: market === "US" ? normalizeUSSymbol(code) : code, name, market, currency };
  };
  if (queryLooksUS) {
    try { return await lookup("/api/us-stock-lookup"); } catch (reason) { throw publicStockLookupError([reason]); }
  }
  try {
    return await lookup("/api/local-stock-lookup");
  } catch (cnReason) {
    try { return await lookup("/api/us-stock-lookup"); } catch (usReason) { throw publicStockLookupError([cnReason, usReason]); }
  }
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "AbortError";
}

function parseRecentStocks(value: unknown): RecentStock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const stock = item as Partial<RecentStock>;
    const market: StockMarket = stock.market === "US" ? "US" : "CN";
    const code = market === "US" ? normalizeUSSymbol(stock.code) : String(stock.code ?? "").trim();
    const name = String(stock.name ?? "").trim();
    const queriedAt = Number(stock.queriedAt);
    if (!(market === "US" ? isUSStockSymbol(code) : cnStockCodePattern.test(code)) || !name || !Number.isFinite(queriedAt)) return [];
    return [market === "US" ? { code, name, market, currency: "USD" as const, queriedAt } : { code, name, queriedAt }];
  }).slice(0, maxRecentStocks);
}

function benchmarkMatchesMarket(code: string, market: StockMarket): boolean {
  return market === "US" ? isUSStockSymbol(code) : cnStockCodePattern.test(code);
}

export default function Home() {
  const { user } = useAuth();
  const [analysisCode, setAnalysisCode] = useState<string | null>(null);
  const portfolioReturnRef = useRef("/");

  useEffect(() => {
    const syncRoute = () => {
      const stock = new URLSearchParams(window.location.search).get("stock") ?? "";
      setAnalysisCode(parseStockRoute(stock) ? stock : null);
      if (!parseStockRoute(stock)) portfolioReturnRef.current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    };
    syncRoute();
    window.addEventListener("popstate", syncRoute);
    window.addEventListener(workspaceNavigationEvent, syncRoute);
    return () => { window.removeEventListener("popstate", syncRoute); window.removeEventListener(workspaceNavigationEvent, syncRoute); };
  }, []);

  const navigateToStock = useCallback((code: string, view?: "models") => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("stock", code);
    if (view) url.searchParams.set("tab", view);
    window.history.pushState({ stock: code }, "", url);
    window.dispatchEvent(new Event(workspaceNavigationEvent));
    setAnalysisCode(code);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const navigateHome = useCallback(() => {
    const url = new URL(portfolioReturnRef.current, window.location.origin);
    window.history.pushState({ portfolio: true }, "", url);
    window.dispatchEvent(new Event(workspaceNavigationEvent));
    setAnalysisCode(null);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  return analysisCode
    ? <StockAnalysisPage key={analysisCode} initialStockCode={analysisCode} onBackHome={navigateHome} onOpenStock={navigateToStock} />
    : user ? <PortfolioHome onOpenStock={navigateToStock} /> : <GuestHome onOpenStock={navigateToStock} />;
}

function StockAnalysisPage({ initialStockCode, onBackHome, onOpenStock }: { initialStockCode: string; onBackHome: () => void; onOpenStock: (code: string) => void }) {
  const { user } = useAuth();
  const { appearance, toggleAppearance } = useAppearance();
  const initialIdentity = parseStockRoute(initialStockCode) ?? { code: initialStockCode, market: "CN" as const, currency: "CNY" as const };
  const [initialRouteState, setInitialRouteState] = useState<"loading" | "ready" | "error">("loading");
  const [initialRouteError, setInitialRouteError] = useState("");
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
  const [isDemo, setIsDemo] = useState(false);
  const [selectedCode, setSelectedCode] = useState(initialIdentity.code);
  const [selectedMarket, setSelectedMarket] = useState<StockMarket>(initialIdentity.market);
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [bsVersion, setBsVersion] = useState<"stable" | "v2">("stable");
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
  const [queryText, setQueryText] = useState(initialStockCode);
  const [, setRecentStocks] = useState<RecentStock[]>([]);
  const [fetchingStock, setFetchingStock] = useState(false);
  const [newsFilter, setNewsFilter] = useState<"全部" | NewsSentiment>("全部");
  const [pendingQuery, setPendingQuery] = useState("");
  const [lastAttemptedQuery, setLastAttemptedQuery] = useState("");
  const [newsExpanded, setNewsExpanded] = useState(false);
  const [hasSavedView, setHasSavedView] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [, setFreshness] = useState({ market: "", financial: "", news: "" });
  const [viewMode, setViewMode] = useState<ViewMode>("basic");
  const [stockView, setStockView] = useWorkspaceView(stockViews, "overview", "tab", stockAnchors);
  const [printing, printResearch] = useResearchPrint(preloadStockPanels);
  const [roundTripCostPct, setRoundTripCostPct] = useState(0.25);
  const [benchmarkCode, setBenchmarkCode] = useState(initialIdentity.market === "US" ? "SPY" : "000300");
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);
  const [savedWorkspace, setSavedWorkspace] = useState<SavedWorkspace | null>(null);
  const [holdings, setHoldings] = useState<StockHoldings>({});
  const [storageHydrated, setStorageHydrated] = useState(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const realtimeControllerRef = useRef<AbortController | null>(null);
  const candleSeriesRef = useRef({ key: "", length: 0 });
  const requestVersionRef = useRef(0);
  const sharedStateAppliedRef = useRef(false);

  useEffect(() => {
    if (initialRouteState !== "ready") return;
    let frame = 0;
    const reveal = () => {
      const anchor = workspaceAnchor(window.location.hash);
      if (!anchor) return true;
      const target = document.getElementById(anchor);
      if (!target) return false;
      for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      frame = requestAnimationFrame(() => {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
      return true;
    };
    window.addEventListener("hashchange", reveal);
    if (reveal()) return () => { window.removeEventListener("hashchange", reveal); cancelAnimationFrame(frame); };
    // Dynamic panels may finish loading after the route becomes ready.
    const observer = new MutationObserver(() => { if (reveal()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 10_000);
    return () => { window.removeEventListener("hashchange", reveal); observer.disconnect(); window.clearTimeout(timeout); cancelAnimationFrame(frame); };
  }, [initialRouteState, stockView]);

  useEffect(() => {
    void preloadStockPanels();
  }, []);

  useEffect(() => {
    let storedStocks: RecentStock[] = [];
    let storedAnnotations: ChartAnnotation[] = [];
    let storedWorkspace: SavedWorkspace | null = null;
    let storedHoldings: StockHoldings = {};
    let storedViewMode: ViewMode = "basic";
    try {
      storedStocks = parseRecentStocks(JSON.parse(accountStorage.getItem(recentStocksStorageKey) ?? "[]"));
    } catch {
      accountStorage.removeItem(recentStocksStorageKey);
    }
    try {
      storedWorkspace = JSON.parse(accountStorage.getItem(workspaceStorageKey) ?? "null") as SavedWorkspace | null;
    } catch { accountStorage.removeItem(workspaceStorageKey); }
    try {
      storedAnnotations = parseAnnotations(JSON.parse(accountStorage.getItem(annotationsStorageKey) ?? "[]"));
    } catch { accountStorage.removeItem(annotationsStorageKey); }
    try {
      storedHoldings = parseHoldings(JSON.parse(accountStorage.getItem(holdingsStorageKey) ?? "[]"));
    } catch { accountStorage.removeItem(holdingsStorageKey); }
    storedViewMode = resolveStoredViewMode(accountStorage.getItem(viewModeStorageKey));
    let storedBenchmark = "";
    try {
      const benchmarks = JSON.parse(accountStorage.getItem("ticklens.benchmark-code.v1") ?? "{}");
      if (typeof benchmarks?.[selectedMarket] === "string" && benchmarkMatchesMarket(benchmarks[selectedMarket], selectedMarket)) storedBenchmark = benchmarks[selectedMarket];
    } catch { /* Use the market default when the preference is absent. */ }
    const frame = window.requestAnimationFrame(() => {
      setRecentStocks(storedStocks);
      setSavedWorkspace(storedWorkspace);
      setHasSavedView(Boolean(storedWorkspace));
      setAnnotations(storedAnnotations);
      setHoldings(storedHoldings);
      setViewMode(storedViewMode);
      if (storedBenchmark) setBenchmarkCode(storedBenchmark);
      setStorageHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedMarket]);

  useEffect(() => {
    if (isDemo) return;
    const controller = new AbortController();
    const loadBenchmark = async () => {
      try {
        const response = await fetch(selectedMarket === "US" ? "/api/us-stock-data" : "/api/local-stock-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: benchmarkCode, days: 1250, ...(selectedMarket === "CN" ? { kind: "index" } : {}) }),
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
  }, [benchmarkCode, isDemo, selectedMarket]);

  const refreshRealtime = useCallback(async (code: string, silent = false) => {
    if (!(selectedMarket === "US" ? isUSStockSymbol(code) : cnStockCodePattern.test(code))) return;
    if (realtimeControllerRef.current) {
      if (silent) return;
      realtimeControllerRef.current.abort();
    }
    const controller = new AbortController();
    realtimeControllerRef.current = controller;
    if (!silent) setRealtimeLoad({ phase: "loading", detail: selectedMarket === "US" ? "正在获取美股最新报价…" : "正在获取当前交易日分钟 K 线与五档买卖盘…" });
    try {
      const response = await fetch(selectedMarket === "US" ? "/api/us-stock-realtime" : "/api/realtime-market", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), cache: "no-store", signal: controller.signal });
      const body = await response.json() as RealtimeSnapshot | { error?: unknown };
      if (!response.ok) throw new Error(String((body as { error?: unknown }).error || "实时行情获取失败"));
      const snapshot = body as RealtimeSnapshot;
      if (snapshot.code !== code) return;
      setRealtimeSnapshot(snapshot);
      setRealtimeLoad({ phase: "success", detail: selectedMarket === "US" ? `${snapshot.date} ${snapshot.time} · 美东时间 · 延时报价` : `${snapshot.date} ${snapshot.time} · ${snapshot.minuteCandles.length} 根分钟 K 线` });
    } catch (reason) {
      if (!isAbortError(reason) && !silent) setRealtimeLoad({ phase: "error", detail: reason instanceof Error ? reason.message : "实时行情获取失败" });
    } finally {
      if (realtimeControllerRef.current === controller) realtimeControllerRef.current = null;
    }
  }, [selectedMarket]);

  useEffect(() => {
    if (!(selectedMarket === "US" ? isUSStockSymbol(selectedCode) : cnStockCodePattern.test(selectedCode))) return;
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
  }, [isDemo, realtimeSnapshot?.marketStatus, refreshRealtime, selectedCode, selectedMarket]);

  useEffect(() => {
    if (!storageHydrated || !user) return;
    try {
      accountStorage.setItem(holdingsStorageKey, JSON.stringify(Object.values(holdings)));
    } catch {
      // The in-memory holding remains usable when browser storage is unavailable.
    }
  }, [holdings, storageHydrated, user]);

  useEffect(() => {
    if (!storageHydrated) return;
    try { accountStorage.setItem(viewModeStorageKey, viewMode); } catch { /* The selected view remains active for this page. */ }
  }, [storageHydrated, viewMode]);

  useEffect(() => {
    if (!storageHydrated || !user) return;
    let benchmarks: Record<string, string> = {};
    try { benchmarks = JSON.parse(accountStorage.getItem("ticklens.benchmark-code.v1") ?? "{}"); } catch { /* Reset invalid preferences. */ }
    accountStorage.setItem("ticklens.benchmark-code.v1", JSON.stringify({ ...benchmarks, [selectedMarket]: benchmarkCode }));
  }, [benchmarkCode, selectedMarket, storageHydrated, user]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);
  useEffect(() => { reportTelemetry("app_loaded", performance.now()); }, []);

  const analyticalDataset = useMemo(
    () => selectedMarket === "CN" && realtimeSnapshot?.code === selectedCode
      ? mergeClosedCnRealtimeDay(dataset, realtimeSnapshot)
      : dataset,
    [dataset, realtimeSnapshot, selectedCode, selectedMarket],
  );
  const historicalDailyCandles = useMemo(
    () => aggregateCandles(analyticalDataset.rows, selectedCode, "1d"),
    [analyticalDataset.rows, selectedCode],
  );
  const realtimeDailySeries = useMemo(
    () => selectedMarket === "CN" && realtimeSnapshot?.code === selectedCode
      ? mergeCnRealtimeDailyCandle(historicalDailyCandles, analyticalDataset, realtimeSnapshot)
      : { candles: historicalDailyCandles, included: false, provisional: false, date: "", time: "" },
    [analyticalDataset, historicalDailyCandles, realtimeSnapshot, selectedCode, selectedMarket],
  );
  const dailyCandles = realtimeDailySeries.candles;
  const candles = useMemo(
    () => timeframe === "1d" ? dailyCandles : aggregateCandles(analyticalDataset.rows, selectedCode, timeframe),
    [analyticalDataset.rows, dailyCandles, selectedCode, timeframe],
  );
  useEffect(() => {
    const key = `${selectedCode}:${timeframe}`;
    const previous = candleSeriesRef.current;
    if (previous.key === key && candles.length > previous.length) {
      setRange((current) => {
        if (current.to < previous.length - 1) return current;
        const span = Math.max(0, current.to - current.from);
        const to = candles.length - 1;
        return { from: Math.max(0, to - span), to };
      });
    }
    candleSeriesRef.current = { key, length: candles.length };
  }, [candles.length, selectedCode, timeframe]);
  const benchmarkCandles = useMemo(() => benchmarkDataset ? aggregateCandles(benchmarkDataset.rows, benchmarkDataset.codes[0], "1d") : [], [benchmarkDataset]);
  const indicators = useMemo(() => calculateIndicators(candles, { version: bsVersion }), [candles, bsVersion]);
  const dailyIndicators = useMemo(() => calculateIndicators(dailyCandles, { version: bsVersion }), [dailyCandles, bsVersion]);
  const todayGuide = realtimeDailySeries.included ? dailyIndicators.guidePoints.at(-1) ?? null : null;
  const signalBacktest = useMemo(() => backtestGuideSignals(candles, indicators, [5, 10, 20], {
    benchmark: timeframe === "1d" ? benchmarkCandles : [],
    roundTripCostPct,
    market: selectedMarket,
    code: selectedCode,
    name: dataset.stockNames[selectedCode] ?? "",
    costModel: "liquidity",
    positionValue: 80_000,
  }), [benchmarkCandles, candles, dataset.stockNames, indicators, roundTripCostPct, selectedCode, selectedMarket, timeframe]);
  const scoreBacktest = useMemo(() => backtestGuideSignals(dailyCandles, dailyIndicators, [5, 10, 20], {
    benchmark: benchmarkCandles,
    roundTripCostPct,
    market: selectedMarket,
    code: selectedCode,
    name: dataset.stockNames[selectedCode] ?? "",
    costModel: "liquidity",
    positionValue: 80_000,
  }), [benchmarkCandles, dailyCandles, dailyIndicators, dataset.stockNames, roundTripCostPct, selectedCode, selectedMarket]);
  const riskMetrics = useMemo(() => calculateRiskMetrics(dailyCandles, benchmarkCandles), [benchmarkCandles, dailyCandles]);

  const selectedIndex = hoverIndex ?? Math.max(0, candles.length - 1);
  const selectedCandle = candles[selectedIndex];
  const klineConclusion = useMemo(
    () => analyzeKlineConclusion(candles, indicators, selectedIndex),
    [candles, indicators, selectedIndex],
  );
  const { firstRow, lastRow } = useMemo(() => {
    let first: ParsedDataset["rows"][number] | undefined;
    let last: ParsedDataset["rows"][number] | undefined;
    for (const row of analyticalDataset.rows) {
      if (row.code !== selectedCode) continue;
      if (!first) first = row;
      last = row;
    }
    return { firstRow: first, lastRow: last };
  }, [analyticalDataset.rows, selectedCode]);
  const intent = useMemo(
    () => lastRow ? analyzeMarketIntent(analyticalDataset, selectedCode, lastRow.date) : null,
    [analyticalDataset, selectedCode, lastRow],
  );
  const latest = candles[candles.length - 1];
  const latestDaily = dailyCandles.at(-1);
  const selectedName = dataset.stockNames[selectedCode] ?? "";
  useEffect(() => {
    document.title = `${selectedName ? `${selectedName} ` : ""}${selectedCode} · TrendSight`;
    return () => { document.title = "TrendSight · 市场研究工作台"; };
  }, [selectedCode, selectedName]);
  const liveQuote = realtimeSnapshot?.code === selectedCode ? realtimeSnapshot : null;
  const currentPrice = liveQuote?.price ?? latest?.close ?? null;
  const selectedIdentity = useMemo(() => ({ code: selectedCode, market: selectedMarket, currency: selectedMarket === "US" ? "USD" as const : "CNY" as const }), [selectedCode, selectedMarket]);
  const selectedHoldingKey = useMemo(() => stockStorageKey(selectedIdentity), [selectedIdentity]);
  const currentHolding = holdings[selectedHoldingKey] ?? null;
  const holdingRiskPlan = useMemo(() => (
    !isDemo && marketLoad.phase === "success"
      ? buildHoldingRiskPlan({
        holding: currentHolding,
        code: selectedCode,
        market: selectedMarket,
        candles: dailyCandles,
        priceBasis: dataset.priceBasis,
        chartAdjustmentFactor: lastRow?.adjustmentFactor,
        provisionalDate: realtimeDailySeries.provisional ? realtimeDailySeries.date : undefined,
      })
      : null
  ), [currentHolding, dailyCandles, dataset.priceBasis, isDemo, lastRow?.adjustmentFactor, marketLoad.phase, realtimeDailySeries.date, realtimeDailySeries.provisional, selectedCode, selectedMarket]);
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
  const factorProfile = useMemo(() => buildFactorProfile(dailyCandles, financialDataset, riskMetrics), [dailyCandles, financialDataset, riskMetrics]);
  const eventStudies = useMemo(() => buildEventStudies(chartEvents, dailyCandles), [chartEvents, dailyCandles]);
  const inspectPredictionDate = useCallback((date: string) => {
    const index = dailyCandles.findIndex((candle) => candle.date === date);
    if (index < 0) return;
    setStockView("market");
    setTimeframe("1d");
    setHoverIndex(index);
    setRange({ from: Math.max(0, index - 30), to: Math.min(dailyCandles.length - 1, index + 30) });
    window.requestAnimationFrame(() => document.getElementById("stock-market")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [dailyCandles, setStockView]);
  const stockScore = useMemo(() => buildStockScore({
    candles: dailyCandles,
    indicators: dailyIndicators,
    currentPrice,
    intent,
    financials: financialDataset,
    newsItems: selectedNews,
    risk: riskMetrics,
    backtest: scoreBacktest,
    dataQuality: dataset.quality,
  }), [currentPrice, dailyCandles, dailyIndicators, dataset.quality, financialDataset, intent, riskMetrics, scoreBacktest, selectedNews]);
  const latestSidebarGuide = [...dailyIndicators.guidePoints].reverse().find((guide) => guide != null);
  const sidebarChangePct = liveQuote?.changePct ?? latestDaily?.changePct ?? null;
  const sidebarMarketStatus = liveQuote?.marketStatus ?? (latestDaily ? "最近收盘" : "等待行情");
  const sidebarOpen = liveQuote?.open ?? latestDaily?.open ?? null;
  const sidebarHigh = liveQuote?.high ?? latestDaily?.high ?? null;
  const sidebarLow = liveQuote?.low ?? latestDaily?.low ?? null;
  const sidebarVolume = liveQuote?.volume ?? latestDaily?.volume ?? null;
  const sidebarAmount = liveQuote?.amount ?? latestDaily?.amount ?? null;
  const sidebarTurnoverPct = latestDaily?.turnoverPct ?? null;
  const sidebarVolumeText = sidebarVolume == null ? "—" : sidebarVolume >= 10_000_000 ? `${formatNumber(sidebarVolume / 100_000_000, 2)}亿` : compactNumber(sidebarVolume);
  const sidebarAmountText = sidebarAmount == null ? "—" : compactNumber(sidebarAmount);
  const sidebarVolumeTitle = sidebarVolume == null ? undefined : `${formatNumber(sidebarVolume, 0)} 股`;
  const sidebarAmountTitle = sidebarAmount == null ? undefined : `${currencySymbol(selectedIdentity.currency)}${formatNumber(sidebarAmount, 0)}`;
  const dailyOnly = dataset.dataLevel.includes("日K聚合");

  const rememberRecentStock = useCallback((code: string, name: string, market: StockMarket) => {
    const normalizedCode = code.trim();
    const normalizedName = name.trim();
    if (!(market === "US" ? isUSStockSymbol(normalizedCode) : cnStockCodePattern.test(normalizedCode)) || !normalizedName) return;
    setRecentStocks((current) => {
      const identity = market === "US" ? { code: normalizedCode, name: normalizedName, market, currency: "USD" as const, queriedAt: Date.now() } : { code: normalizedCode, name: normalizedName, queriedAt: Date.now() };
      const key = stockStorageKey(identity);
      const next = [
        identity,
        ...current.filter((item) => stockStorageKey(item) !== key),
      ].slice(0, maxRecentStocks);
      try {
        accountStorage.setItem(recentStocksStorageKey, JSON.stringify(next));
      } catch {
        // Recent queries are a convenience only; data loading should still succeed.
      }
      return next;
    });
  }, []);

  const saveHolding = useCallback((shares: number, cost: number) => {
    if (isDemo || !(selectedMarket === "US" ? isUSStockSymbol(selectedCode) : cnStockCodePattern.test(selectedCode))) return;
    setHoldings((current) => ({
      ...current,
      [selectedHoldingKey]: selectedMarket === "US" ? {
        code: selectedCode,
        name: dataset.stockNames[selectedCode] || selectedCode,
        market: "US",
        currency: "USD",
        shares,
        cost,
        updatedAt: new Date().toISOString(),
      } : { code: selectedCode, name: dataset.stockNames[selectedCode] || selectedCode, shares, cost, updatedAt: new Date().toISOString() },
    }));
  }, [dataset.stockNames, isDemo, selectedCode, selectedHoldingKey, selectedMarket]);

  const clearHolding = useCallback(() => {
    setHoldings((current) => {
      if (!current[selectedHoldingKey]) return current;
      const next = { ...current };
      delete next[selectedHoldingKey];
      return next;
    });
  }, [selectedHoldingKey]);

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
      const market = resolved.market;
      const endpoints = market === "US" ? {
        market: "/api/us-stock-data",
        news: "/api/us-stock-news",
        financials: "/api/us-stock-financials",
      } : {
        market: "/api/local-stock-data",
        news: "/api/local-stock-news",
        financials: "/api/local-stock-financials",
      };
      const resolvedLabel = `${resolved.name ? `${resolved.name} · ` : ""}${normalizedCode}`;
      setSelectedMarket(market);
      setBenchmarkCode((current) => market === "US" ? (isUSStockSymbol(current) ? current : "SPY") : (cnStockCodePattern.test(current) ? current : "000300"));
      setQueryText(resolved.name || normalizedCode);
      setPendingQuery(resolvedLabel);
      setNewsSourceLabel(`${resolvedLabel} · 最新新闻`);
      setFinancialSourceLabel(`${resolvedLabel} · 基本面`);
      setMarketLoad({ phase: "loading", detail: `正在获取 ${resolvedLabel} 最多约 5 年的${market === "US" ? "美股" : "前复权"}日 K；旧图表暂时保留` });
      setNewsLoad({ phase: "loading", detail: "正在从 HTTPS 新闻服务获取并去重…" });
      setFinancialLoad({ phase: "loading", detail: market === "US" ? "正在从 SEC 获取 Company Facts…" : "正在获取估值、分红与三张财务报表…" });
      const sourceStartedAt = performance.now();

      // The three data sources run concurrently. Each branch updates its section
      // as soon as its own response arrives, without waiting for the other one.
      const marketTask = requestCsv(endpoints.market, { code: normalizedCode, days: 1250, ...(market === "CN" ? { kind: "stock" } : {}) }, "获取行情数据失败")
        .then((csv) => {
          if (requestVersion !== requestVersionRef.current) return;
          const parsed = parseMarketCsv(csv);
          const resultCode = parsed.codes[0] ?? normalizedCode;
          const resultName = parsed.stockNames[resultCode] ?? resolved.name;
          const resultCandles = aggregateCandles(parsed.rows, resultCode, "1d");
          applyDataset(parsed, `${resultName ? `${resultName} · ` : ""}${resultCode} · 最多5年前复权日K`);
          rememberRecentStock(resultCode, resultName, market);
          setMarketLoad({
            phase: "success",
            detail: `${resultCandles.length.toLocaleString("zh-CN")} 个交易日日K已加载，图表与风险指标已更新`,
          });
          setInitialRouteState((current) => current === "loading" ? "ready" : current);
          setInitialRouteError("");
          setFreshness((current) => ({ ...current, market: new Date().toISOString() }));
          reportTelemetry("market_success", performance.now() - sourceStartedAt);
        })
        .catch((reason) => {
          if (isAbortError(reason) || requestVersion !== requestVersionRef.current) throw reason;
          const message = reason instanceof Error ? reason.message : "获取失败";
          setMarketLoad({ phase: "error", detail: `${message}；仍显示 ${selectedName || selectedCode} 的上一份成功行情` });
          setInitialRouteState((current) => current === "loading" ? "error" : current);
          setInitialRouteError(message);
          reportTelemetry("market_error", performance.now() - sourceStartedAt);
          throw new Error(`行情：${message}`);
        });

      const newsTask = requestCsv(endpoints.news, { code: normalizedCode, limit: 30 }, "获取新闻数据失败")
        .then((csv) => {
          if (requestVersion !== requestVersionRef.current) return;
          const parsed = parseNewsCsv(csv);
          const resultCode = parsed.codes[0] ?? normalizedCode;
          const resultName = parsed.stockNames[resultCode] ?? resolved.name;
          applyNewsDataset(parsed, `${resultName ? `${resultName} · ` : ""}${resultCode} · 新闻`);
          rememberRecentStock(resultCode, resultName, market);
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
        endpoints.financials,
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
          rememberRecentStock(parsed.code, resultName, market);
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
      setInitialRouteState((current) => current === "loading" ? "error" : current);
      setInitialRouteError(message);
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setFetchingStock(false);
        setPendingQuery("");
      }
    }
  }, [applyDataset, applyNewsDataset, queryText, rememberRecentStock, selectedCode, selectedName]);

  const resetDemo = () => {
    requestControllerRef.current?.abort();
    requestVersionRef.current += 1;
    const demo = createDemoDataset();
    setDataset(demo);
    setSelectedMarket("CN");
    setBenchmarkCode("000300");
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
    setBenchmarkDataset(null);
    setTimeframe("1d");
    setFreshness({ market: "", financial: "", news: "" });
  };

  const exportCandles = () => {
    if (!candles.length) return;
    const rows = [
      ["时间", "开盘", "最高", "最低", "收盘", selectedMarket === "US" ? "VWAP(USD)" : "VWAP(前复权)", "涨跌", "涨跌幅(%)", "成交量(股)", selectedMarket === "US" ? "成交额(USD)" : "成交额(元)", "换手率(%)"],
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
      if (sharedCode && parseStockRoute(sharedCode)) await fetchStockData(sharedCode);
      if (sharedMode === "basic" || sharedMode === "pro") setViewMode(sharedMode);
      const sharedMarket = parseStockRoute(sharedCode)?.market ?? selectedMarket;
      if (sharedBenchmark && benchmarkMatchesMarket(sharedBenchmark, sharedMarket)) setBenchmarkCode(sharedBenchmark);
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
  }, [fetchStockData, selectedMarket]);

  const currentWorkspace = (): SavedWorkspace => ({
    version: 1,
    code: selectedCode,
    market: selectedMarket,
    isDemo,
    timeframe,
    lowerIndicator,
    overlays: Object.entries(overlays).filter(([, active]) => active).map(([key]) => key),
    range,
    savedAt: new Date().toISOString(),
  });

  const copyWorkspaceLink = async () => {
    const workspace = currentWorkspace();
    const url = new URL(window.location.href);
    url.search = "";
    if (!workspace.isDemo) url.searchParams.set("stock", stockRouteKey({ code: workspace.code, market: selectedMarket }));
    url.searchParams.set("tf", workspace.timeframe);
    url.searchParams.set("lower", workspace.lowerIndicator);
    url.searchParams.set("ov", workspace.overlays.join(","));
    url.searchParams.set("from", String(workspace.range.from));
    url.searchParams.set("to", String(workspace.range.to));
    url.searchParams.set("mode", viewMode);
    url.searchParams.set("benchmark", benchmarkCode);
    url.searchParams.set("tab", stockView);
    if (stockView === "financials") {
      url.searchParams.set("finance", financialWorkspaceView(new URL(window.location.href)));
    }
    url.hash = "";
    try {
      if (navigator.share) {
        await navigator.share({ title: `${selectedName || selectedCode} · TrendSight研究视图`, text: "打开后可恢复股票、周期、指标和对比基准。", url: url.toString() });
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
      accountStorage.setItem(workspaceStorageKey, JSON.stringify(workspace));
      setSavedWorkspace(workspace);
      setHasSavedView(true);
      setWorkspaceNotice("研究视图已加入保存队列，数据库保存状态见页面提示。");
      reportTelemetry("workspace_saved");
    } catch {
      setWorkspaceNotice("保存研究视图失败，请查看同步状态并重试。");
    }
  };

  const restoreWorkspace = async () => {
    try {
      const workspace = savedWorkspace ?? JSON.parse(accountStorage.getItem(workspaceStorageKey) ?? "null") as SavedWorkspace | null;
      if (!workspace || workspace.version !== 1) throw new Error("未找到有效视图");
      if (!workspace.isDemo && (cnStockCodePattern.test(workspace.code) || isUSStockSymbol(workspace.code))) await fetchStockData(workspace.market === "US" ? `US:${workspace.code}` : workspace.code);
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

  if (initialRouteState !== "ready") {
    return (
      <div className="research-page">
        <SiteBanner activePage="stock" currentStockCode={initialStockCode} appearance={appearance} onToggleAppearance={toggleAppearance} onOpenStock={onOpenStock} onOpenPortfolio={onBackHome} statusText={initialRouteState === "loading" ? `正在加载 ${initialStockCode}` : "数据连接待重试"} />
        <StockInitialLoading
          code={initialStockCode}
          phase={initialRouteState}
          error={initialRouteError}
          onBackHome={onBackHome}
          onRetry={() => {
            setInitialRouteState("loading");
            setInitialRouteError("");
            void fetchStockData(initialStockCode);
          }}
        />
      </div>
    );
  }

  return (
    <div className="research-page">
      <SiteBanner activePage="stock" currentStockCode={selectedCode} currentStockMarket={selectedMarket} appearance={appearance} onToggleAppearance={toggleAppearance} onOpenStock={onOpenStock} onOpenPortfolio={onBackHome} statusText={fetchingStock ? "行情、基本面与新闻更新中" : `${selectedName || selectedCode} · ${[marketLoad, financialLoad, newsLoad].filter((source) => source.phase === "success").length}/3 项数据已就绪${[marketLoad, financialLoad, newsLoad].some((source) => source.phase === "error") ? "，部分数据待重试" : ""}`} />
      <main className={`app-shell view-${viewMode} ${workspaceStyles.workspace} ${printing ? workspaceStyles.printing : ""}`}>
      <div className={workspaceStyles.content}>
      <StockWorkspaceHeader
        name={selectedName || selectedCode} code={selectedCode} market={marketLabel(selectedMarket)}
        status={sidebarMarketStatus} source={liveQuote?.source ?? dataset.dataLevel} dataLevel={dataset.dataLevel}
        dateRange={`${firstRow?.date ?? "—"} → ${lastRow?.date ?? "—"}`}
        price={currentPrice == null ? "—" : `${currencySymbol(selectedIdentity.currency)}${formatNumber(currentPrice, 3)}`}
        change={sidebarChangePct == null ? "等待行情" : `${(liveQuote?.change ?? latestDaily?.change ?? 0) >= 0 ? "+" : ""}${formatNumber(liveQuote?.change ?? latestDaily?.change ?? 0, 3)} · ${sidebarChangePct >= 0 ? "+" : ""}${formatNumber(sidebarChangePct, 2)}%${selectedMarket === "US" ? " · 延时报价" : ""}`}
        direction={directionClass} viewMode={viewMode} onViewModeChange={setViewMode}
        onBack={onBackHome} onRefresh={() => void fetchStockData(selectedCode)} onShare={() => void copyWorkspaceLink()} busy={busy}
        stats={[
          { label: "开盘", value: sidebarOpen == null ? "—" : formatNumber(sidebarOpen, 3) },
          { label: "最高", value: sidebarHigh == null ? "—" : formatNumber(sidebarHigh, 3) },
          { label: "最低", value: sidebarLow == null ? "—" : formatNumber(sidebarLow, 3) },
          { label: "成交量", value: sidebarVolumeText, title: sidebarVolumeTitle },
          { label: "成交额", value: sidebarAmountText, title: sidebarAmountTitle },
          { label: "换手率", value: sidebarTurnoverPct == null ? "—" : `${formatNumber(sidebarTurnoverPct, 2)}%` },
        ]}
        selection={dataset.codes.length > 1 ? (
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
          ) : null}
      />
      <details className={workspaceStyles.sources} open={Boolean(error) || fetchingStock}>
        <summary>数据来源与连接状态 · {[marketLoad, financialLoad, newsLoad].filter((item) => item.phase === "success").length}/3 已就绪</summary>
      <section className={`query-strip ${fetchingStock ? "is-loading" : ""}`} aria-label="股票查询与数据源状态">
        <div className="query-sources" aria-live="polite">
          <div className="query-source">
            <div className={`source-icon ${marketLoad.phase === "loading" ? "is-loading" : ""}`}>K线</div>
            <div>
              <div className="source-title-row">
                <strong title={marketSourceLabel}>{marketSourceLabel}</strong>
                <LoadBadge phase={marketLoad.phase} />
              </div>
              <p title={marketLoad.detail}>{marketLoad.detail}</p>
            </div>
          </div>
          <div className="source-divider" aria-hidden="true" />
          <div className="query-source financial-source">
            <div className={`source-icon financial-icon ${financialLoad.phase === "loading" ? "is-loading" : ""}`}>基本面</div>
            <div>
              <div className="source-title-row">
                <strong title={financialSourceLabel}>{financialSourceLabel}</strong>
                <LoadBadge phase={financialLoad.phase} />
              </div>
              <p title={financialLoad.detail}>{financialLoad.detail}</p>
            </div>
          </div>
          <div className="source-divider" aria-hidden="true" />
          <div className="query-source news-source">
            <div className={`source-icon news-icon ${newsLoad.phase === "loading" ? "is-loading" : ""}`}>舆情</div>
            <div>
              <div className="source-title-row">
                <strong title={newsSourceLabel}>{newsSourceLabel}</strong>
                <LoadBadge phase={newsLoad.phase} />
              </div>
              <p title={newsLoad.detail}>{newsLoad.detail}</p>
            </div>
          </div>
        </div>
        {error ? (
          <div className="query-actions">
            <span className="error-message" role="alert">{error}</span>
            {lastAttemptedQuery ? <button className="retry-button" type="button" onClick={() => void fetchStockData(lastAttemptedQuery)} disabled={busy}>重试</button> : null}
          </div>
        ) : null}
      </section>

      </details>
      <WorkspaceTabs id="stock" label="个股研究视图" value={stockView} onChange={setStockView} tabs={[
        { id: "overview", label: "概览" }, { id: "market", label: "行情与技术" },
        { id: "financials", label: "财务" }, { id: "news", label: "新闻" },
        { id: "models", label: "模型与风险" }, { id: "notes", label: "交易复盘" },
      ]} />

      {fetchingStock ? (
        <div className="stale-data-banner" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          正在加载 {pendingQuery || "新股票"}；下方行情仍是 {selectedName || selectedCode} 的上一份成功数据，加载完成前不会替换。
        </div>
      ) : null}

      <WorkspacePanel id="stock" view="overview" active={stockView}>
        <div className={workspaceStyles.overviewSummary}><div><span>研究评分</span><strong>{stockScore.score}/100</strong><small>{stockScore.signal.action} · 覆盖 {stockScore.coverage}%</small></div><div><span>近期规则证据</span><strong>{latestSidebarGuide ? `${latestSidebarGuide.confidence === "watch" ? "弱B观察" : latestSidebarGuide.type === "buy" ? "正向规则" : "风险规则"} · ${latestSidebarGuide.score}` : "近 5 日无规则"}</strong></div></div>
        {user && viewMode === "basic" ? (
          <BeginnerGuideCard
            report={stockScore}
            stockName={selectedName || selectedCode}
            dataWarnings={dataset.quality.warnings.length}
            newsCount={newsDataset.items.length}
          />
        ) : null}

        <StockScoreCard report={stockScore} stockName={selectedName || selectedCode} />
      </WorkspacePanel>

      <WorkspacePanel id="stock" view="market" active={stockView}>
        <section className={workspaceStyles.market} id="stock-market" aria-label="K 线与技术分析">
        <div className={`chart-card ${fetchingStock ? "is-stale" : ""}`}>
          <div className="chart-toolbar">
            <div className="chart-toolbar-title">
              <span aria-hidden="true">⌁</span>
              <div>
                <strong>价格走势</strong>
                <small>{timeframes.find((item) => item.key === timeframe)?.label} · {selectedMarket === "US" ? "美元日K" : "前复权"} · {benchmarkCandles.length ? `对比${selectedMarket === "US" ? benchmarkCode : "沪深300"}` : "等待基准"}{timeframe === "1d" && realtimeDailySeries.included ? ` · 含今日${realtimeDailySeries.time.slice(0, 5)}${realtimeDailySeries.provisional ? "盘中" : "收盘"}K线` : ""}</small>
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
                    const nextLength = key === "1d" ? dailyCandles.length : aggregateCandles(analyticalDataset.rows, selectedCode, key).length;
                    setRange(defaultRange(nextLength, key));
                    setHoverIndex(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <details className={workspaceStyles.chartSettings} open={viewMode === "pro"}>
              <summary>指标、比较基准与图表操作</summary><div>
              <label className="benchmark-select">基准
              <select value={benchmarkCode} onChange={(event) => setBenchmarkCode(event.target.value)} aria-label="相对表现比较基准">
                {selectedMarket === "US" ? <><option value="SPY">标普500 ETF（SPY）</option><option value="QQQ">纳斯达克100 ETF（QQQ）</option><option value="DIA">道琼斯 ETF（DIA）</option></> : <><option value="000300">沪深300</option><option value="000001">上证指数</option><option value="399001">深证成指</option><option value="399006">创业板指</option></>}
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
              {timeframe === "1d" && realtimeDailySeries.included ? (
                <span className="event-count" title="今日 K 线和 B/S 使用实时快照计算，收盘前会随行情变化">
                  今日{realtimeDailySeries.provisional ? "盘中预估" : "收盘确认"} · {todayGuide ? `${todayGuide.type === "buy" ? "B" : "S"}${todayGuide.score}` : "观察"} @ {formatNumber(liveQuote?.price ?? dailyCandles.at(-1)?.close ?? 0, 3)} · {realtimeDailySeries.time.slice(0, 5)}
                </span>
              ) : null}
              {chartEvents.length ? <span className="event-count" title="N 新闻 · F 财报 · D 分红">事件 {chartEvents.length}</span> : null}
              <button className="icon-button" type="button" onClick={exportCandles} title="导出当前周期K线" aria-label="导出当前周期K线">⇩</button>
              <button className="icon-button" type="button" onClick={() => document.getElementById("stock-market")?.requestFullscreen?.()} title="全屏研究图表" aria-label="全屏研究图表">⛶</button>
            </div></details>
          </div>

          <div className="ohlc-ribbon" aria-live="polite">
            <span>{selectedCandle?.key ?? "—"}</span>
            <span>开 <b>{selectedCandle ? formatNumber(selectedCandle.open, 3) : "—"}</b></span>
            <span>高 <b>{selectedCandle ? formatNumber(selectedCandle.high, 3) : "—"}</b></span>
            <span>低 <b>{selectedCandle ? formatNumber(selectedCandle.low, 3) : "—"}</b></span>
            <span>收 <b className={(selectedCandle?.change ?? 0) >= 0 ? "is-up" : "is-down"}>{selectedCandle ? formatNumber(selectedCandle.close, 3) : "—"}</b></span>
            <span>幅 <b className={(selectedCandle?.changePct ?? 0) >= 0 ? "is-up" : "is-down"}>{selectedCandle ? `${selectedCandle.changePct >= 0 ? "+" : ""}${formatNumber(selectedCandle.changePct, 2)}%` : "—"}</b></span>
          </div>

          <HoldingRiskSummary plan={holdingRiskPlan} currentPrice={liveQuote?.price ?? lastRow?.rawPrice ?? null} />

          <MarketChart
            appearance={appearance}
            candles={candles}
            benchmarkCandles={timeframe === "1d" ? benchmarkCandles : []}
            benchmarkName={selectedMarket === "US" ? benchmarkCode : ({ "000300": "沪深300", "000001": "上证指数", "399001": "深证成指", "399006": "创业板指" } as Record<string, string>)[benchmarkCode] ?? benchmarkCode}
            indicators={indicators}
            overlays={overlays}
            lowerIndicator={lowerIndicator}
            range={range}
            resetVisible={timeframe === "1d" ? 120 : 140}
            events={chartEvents}
            annotations={annotations.filter((item) => item.code === selectedCode)}
            holdingRiskPlan={holdingRiskPlan}
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

        <aside className={workspaceStyles.analysis}>
          <section className="rail-card conclusion-card" id="kline-analysis">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">KLINE READOUT</p>
                <h3>K线研判</h3>
              </div>
              <span className="calc-badge">{timeframe.toUpperCase()}</span>
            </div>
            <label className="method-note">BS 规则
              <select aria-label="BS 规则版本" value={bsVersion} onChange={(event) => setBsVersion(event.target.value === "v2" ? "v2" : "stable")}>
                <option value="stable">标准版（默认）</option>
                <option value="v2">九转降权研究版</option>
              </select>
            </label>
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
              <p className="method-note">B 点须由 RSI 超卖回升或 BOLL 下轨承接锚定，含量能的总分至少 3 分。{bsVersion === "v2" ? "研究版将下跌九转从3分降为1分；留出股票的信号胜率略升，但组合表现下降，尚不能认定整体改善。" : "标准版保留原评分权重。"}量能确认表示不低于前 5 根均量，不等于显著放量。黄色小写 b 为 2 分弱B观察，不进入回测、评分或组合交易；B/S 分别去重。盘中信号随当日 K 线变化，不是交易指令。</p>
              </>
            ) : <p className="empty-note">当前周期暂无足够 K 线用于研判。</p>}
          </section>

          <details className={workspaceStyles.technicalDetails} open={viewMode === "pro"}>
            <summary>资金行为、当前 K 线、持仓与技术快照</summary>
            <div className={workspaceStyles.technicalGrid}>
          <section className="rail-card data-card">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">DATASET</p>
                <h3>数据概览</h3>
              </div>
              <span className="live-indicator"><i /> {isDemo ? "DEMO" : "HTTPS"}</span>
            </div>
            <div className="data-grid">
              <Stat label="行情数据点" value={analyticalDataset.rows.length.toLocaleString("zh-CN")} />
              <Stat label="K线数量" value={candles.length.toLocaleString("zh-CN")} />
              <Stat label="股票数量" value={String(dataset.codes.length)} />
              <Stat label="跳过异常" value={String(dataset.skipped)} />
              <Stat label="性质覆盖" value={`${formatNumber(dataset.quality.sideCoverage * 100, 1)}%`} />
              <Stat label="疑似重复" value={`${formatNumber(dataset.quality.duplicateRate * 100, 2)}%`} />
            </div>
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
                  <span>{intent.confidence}% 置信 · {intent.basis === "level1" ? "L1" : "日线量价"}</span>
                </div>
                <div className="confidence-track" aria-label={`代理信号置信度 ${intent.confidence}%`}>
                  <i style={{ width: `${intent.confidence}%` }} />
                </div>
                <div className="intent-grid">
                  <IntentMetric label={intent.basis === "level1" ? "主动净额" : "量价方向额"} value={signedCompact(intent.activeNetAmount)} tone={intent.activeNetAmount} />
                  <IntentMetric label={intent.basis === "level1" ? "主动净比" : "日线资金强度"} value={signedPercent(intent.activeNetRatio)} tone={intent.activeNetRatio} />
                  <IntentMetric label={intent.basis === "level1" ? "大额净额" : "量能加权额"} value={signedCompact(intent.largeNetAmount)} tone={intent.largeNetAmount} />
                  <IntentMetric label={intent.basis === "level1" ? "尾盘净比" : "收盘/开盘"} value={signedPercent(intent.tailNetRatio)} tone={intent.tailNetRatio} />
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
            ) : <p className="empty-note">当前日期没有可分析的行情记录。</p>}
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
              <Detail label="买卖指引" value={currentIndicator.guide ? `${currentIndicator.guide.confidence === "watch" ? "b" : currentIndicator.guide.type === "buy" ? "B" : "S"}${currentIndicator.guide.score}` : "—"} />
              {realtimeDailySeries.included ? <Detail label={`今日B/S（${realtimeDailySeries.provisional ? "盘中预估" : "收盘确认"}）`} value={`${todayGuide ? `${todayGuide.confidence === "watch" ? "b" : todayGuide.type === "buy" ? "B" : "S"}${todayGuide.score}` : "观察"} @ ${formatNumber(liveQuote?.price ?? dailyCandles.at(-1)?.close ?? 0, 3)} · ${realtimeDailySeries.time.slice(0, 5)}`} /> : null}
              <Detail label="换手率" value={selectedCandle?.turnoverPct == null ? "—" : `${formatNumber(selectedCandle.turnoverPct, 2)}%`} />
            </dl>
          </section>

          {user && <HoldingProfitCard
            key={`${selectedCode}-${currentHolding?.updatedAt ?? "new"}`}
            code={selectedCode}
            name={selectedName}
            currentPrice={currentPrice}
            holding={currentHolding}
            currency={selectedIdentity.currency}
            isDemo={isDemo}
            onSave={saveHolding}
            onClear={clearHolding}
          />}

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
            </div>
          </details>
        </aside>
        </section>
        <div className={workspaceStyles.supplement}><RealtimeTradingPanel snapshot={realtimeSnapshot} load={realtimeLoad} market={selectedMarket} onRefresh={() => void refreshRealtime(selectedCode)} /></div>
      </WorkspacePanel>

      <WorkspacePanel id="stock" view="models" active={stockView} className={workspaceStyles.models}>
        {user ? <>
        <StockModelContent active={stockView === "models" || printing || viewMode === "pro"}>
        <NextDayPredictionCard
          candles={dailyCandles}
          benchmarkCandles={benchmarkCandles}
          benchmarkName={selectedMarket === "US" ? benchmarkCode : ({ "000300": "沪深300", "000001": "上证指数", "399001": "深证成指", "399006": "创业板指" } as Record<string, string>)[benchmarkCode] ?? benchmarkCode}
          newsItems={selectedNews}
          realtimeSnapshot={liveQuote}
          market={selectedMarket}
          stockName={selectedName || selectedCode}
          onInspectDate={inspectPredictionDate}
        />
        <SignalBacktestCard backtest={signalBacktest} benchmarkName={selectedMarket === "US" ? benchmarkCode : "沪深300"} market={selectedMarket} priceBasis={dataset.priceBasis ?? ""} onCostChange={setRoundTripCostPct} />
        <AdvancedResearchPanel risk={riskMetrics} factors={factorProfile} events={eventStudies} benchmarkName={selectedMarket === "US" ? benchmarkCode : ({ "000300": "沪深300", "000001": "上证指数", "399001": "深证成指", "399006": "创业板指" } as Record<string, string>)[benchmarkCode] ?? benchmarkCode} />
        </StockModelContent>
        </> : <MemberNotice />}
      </WorkspacePanel>

      <WorkspacePanel id="stock" view="financials" active={stockView}>
        <FinancialDashboard dataset={financialDataset} load={financialLoad} currency={selectedIdentity.currency} />
        {selectedMarket === "CN" ? <details className="legacy-financial-summary">
          <summary>查看原始报告摘要、估值与分红明细</summary>
          <FundamentalsPanel dataset={financialDataset} load={financialLoad} />
          <FinancialReports dataset={financialDataset} load={financialLoad} />
        </details> : null}
        <section className={`rail-card ${workspaceStyles.supplement}`}><HolderMix structure={financialDataset.holderStructure} loading={financialLoad.phase === "loading"} /></section>
      </WorkspacePanel>

      <WorkspacePanel id="stock" view="notes" active={stockView}>
        {user ? <StockReviewEntry
          key={`${selectedMarket}:${selectedCode}`}
          code={selectedCode}
          name={selectedName}
          market={selectedMarket}
          active={stockView === "notes" || printing}
          legacyAnnotations={annotations.filter((item) => item.code === selectedCode)}
          researchTools={<>
            <button type="button" onClick={saveWorkspace}>保存视图</button>
            <button type="button" onClick={() => void restoreWorkspace()} disabled={!hasSavedView || busy}>恢复视图</button>
            <button type="button" onClick={exportResearchReport}>导出报告</button>
            <button type="button" onClick={() => void printResearch()}>打印 / PDF</button>
            {workspaceNotice && <p role="status">{workspaceNotice}</p>}
          </>}
        /> : <MemberNotice />}
      </WorkspacePanel>

      <WorkspacePanel id="stock" view="news" active={stockView}>
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
              <div className={workspaceStyles.newsSummary}><span>正面 {newsDataset.summary.positive}</span><span>中性 {newsDataset.summary.neutral}</span><span>负面 {newsDataset.summary.negative}</span></div>
              <p>关键词情绪仅用于新闻初筛，不理解反讽、否定和复杂上下文。</p>
              <p>新闻来自公开检索入口，相关性与情绪分数用于排序和初筛。请打开原文核验事实、发布时间及上下文。</p>
            </aside>
            <div className="news-feed" aria-live="polite">
              {visibleNews.length > 0 ? (viewMode === "basic" && !newsExpanded ? visibleNews.slice(0, 3) : visibleNews).map((item) => (
                <NewsArticle key={`${item.url}-${item.publishedAt}`} item={item} />
              )) : <div className="news-empty-filter"><p>当前筛选条件下没有新闻。</p><button className="retry-button" type="button" onClick={() => setNewsFilter("全部")}>查看全部新闻</button></div>}
              {viewMode === "basic" && visibleNews.length > 3 ? <button className="basic-news-more" type="button" onClick={() => setNewsExpanded((value) => !value)}>{newsExpanded ? "收起新闻列表" : `查看全部 ${visibleNews.length} 条新闻`}</button> : null}
            </div>
          </div>
        ) : (
          <div className={`news-empty-state ${newsLoad.phase === "loading" ? "is-loading" : ""}`} aria-live="polite">
            <div className="news-empty-mark">{newsLoad.phase === "loading" ? <span className="loading-spinner" /> : "NEWS"}</div>
            <div>
              <h4>{newsLoad.phase === "loading" ? "新闻数据加载中" : newsLoad.phase === "error" ? "新闻暂时无法加载" : "暂无相关股票新闻"}</h4>
              <p>{newsLoad.phase === "loading" ? "正在汇总最新报道，完成后会自动显示。" : newsLoad.phase === "error" ? "行情与财务仍可查看，可以稍后重新获取新闻。" : "当前数据源没有提供相关报道，可以继续查看行情与财务信息。"}</p>
              {newsLoad.phase === "error" ? <button className="retry-button" type="button" disabled={busy} onClick={() => void fetchStockData(lastAttemptedQuery || selectedCode)}>重新获取数据</button> : null}
            </div>
          </div>
        )}
      </section>
      </WorkspacePanel>

      <footer className="footer-note">
        <span>输入股票后，行情、估值分红、历史财报诊断与新闻会同步获取，先完成的数据会先更新页面。</span>
        <span>日K聚合、Level-1、九转、B/S、因子、主力行为与新闻情绪均为研究代理，只供投资参考，不构成投资建议。</span>
      </footer>
      </div>
      </main>
    </div>
  );
}

function StockInitialLoading({
  code,
  phase,
  error,
  onBackHome,
  onRetry,
}: {
  code: string;
  phase: "loading" | "error";
  error: string;
  onBackHome: () => void;
  onRetry: () => void;
}) {
  return (
    <main className="stock-initial-shell">
      <header className="stock-initial-header">
        <button type="button" onClick={onBackHome} aria-label="返回自选股"><span aria-hidden="true">‹</span> 返回自选股</button>
        <div className="stock-initial-brand"><i aria-hidden="true" /><span><strong>TrendSight</strong><small>市场研究工作台</small></span></div>
        <span className="stock-initial-code">{code}</span>
      </header>
      <section className={`stock-initial-card ${phase === "error" ? "is-error" : ""}`} aria-live="polite">
        <div className="stock-initial-orbit" aria-hidden="true"><i /><i /><span>{phase === "loading" ? "···" : "!"}</span></div>
        <p>STOCK RESEARCH</p>
        <h1>{phase === "loading" ? `正在加载 ${code}` : `${code} 暂时加载失败`}</h1>
        <h2>{phase === "loading" ? "个股研究数据加载中" : error || "数据服务暂时不可用"}</h2>
        <div className="stock-initial-sources">
          {[
            ["行情与 K 线", "价格、成交量、技术指标"],
            ["基本面", "估值、分红、财务报表"],
            ["舆情资讯", "新闻、事件与情绪"],
          ].map(([name, detail], index) => (
            <div key={name}>
              <i className={phase === "loading" ? `delay-${index}` : "is-stopped"} aria-hidden="true" />
              <span><strong>{name}</strong><small>{detail}</small></span>
              <em>{phase === "loading" ? "加载中" : "未完成"}</em>
            </div>
          ))}
        </div>
        {phase === "error" ? <button className="stock-initial-retry" type="button" onClick={onRetry}>重新加载</button> : <small className="stock-initial-note">数据就绪后将自动进入分析页面</small>}
      </section>
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
    <section className="financial-card" id="stock-financial-reports">
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
        {item.eventType ? <span>{item.eventType}</span> : null}
        {item.sourceQuality ? <span title={item.sourceQualityReason}>来源质量 {item.sourceQuality}</span> : null}
        {(item.duplicateCount ?? 1) > 1 ? <span>同事件 {item.duplicateCount} 篇已合并</span> : null}
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

function HolderMix({ structure, loading }: { structure: HolderStructure; loading: boolean }) {
  if (structure.institutionalRatio == null || structure.retailProxyRatio == null) {
    return (
      <section className="ownership-block is-empty" aria-label="主力与散户持仓比例">
        <header><div><span>HOLDER MIX</span><strong>最新持仓结构</strong></div></header>
        <p>{loading ? "正在获取最新流通股东数据…" : "查询股票后展示最新前十流通股东结构。"}</p>
      </section>
    );
  }
  const change = structure.institutionalChangePp;
  return (
    <section className="ownership-block" aria-label="主力与散户持仓比例">
      <header>
        <div><span>HOLDER MIX</span><strong>最新持仓结构</strong></div>
        <small>{structure.asOfDate || "—"}</small>
      </header>
      <div className="ownership-ratio-grid">
        <div><span>主力持仓</span><strong>{formatNumber(structure.institutionalRatio, 2)}%</strong><small>前十机构</small></div>
        <div><span>散户持仓</span><strong>{formatNumber(structure.retailProxyRatio, 2)}%</strong><small>其余流通盘代理</small></div>
      </div>
      <div className="ownership-bar" role="img" aria-label={`前十机构 ${formatNumber(structure.institutionalRatio, 2)}%，其余流通盘代理 ${formatNumber(structure.retailProxyRatio, 2)}%`}>
        <i style={{ width: `${structure.institutionalRatio}%` }} />
        <i style={{ width: `${structure.retailProxyRatio}%` }} />
      </div>
      <dl className="ownership-facts">
        <div><dt>前三机构</dt><dd>{structure.topThreeInstitutionalRatio == null ? "—" : `${formatNumber(structure.topThreeInstitutionalRatio, 2)}%`}</dd></div>
        <div><dt>较上期</dt><dd className={(change ?? 0) > 0 ? "is-up" : (change ?? 0) < 0 ? "is-down" : ""}>{change == null ? "—" : `${change >= 0 ? "+" : ""}${formatNumber(change, 2)}pp`}</dd></div>
        <div><dt>机构席位</dt><dd>{structure.institutionCount} / 10</dd></div>
      </dl>
      <p className="ownership-analysis">{structure.analysis}</p>
      {structure.topInstitutions.length ? (
        <details className="ownership-details">
          <summary>查看主要机构</summary>
          <ol>{structure.topInstitutions.slice(0, 3).map((holder) => <li key={`${holder.name}-${holder.ratio}`}><span>{holder.name}</span><b>{formatNumber(holder.ratio, 2)}%</b></li>)}</ol>
        </details>
      ) : null}
      <p className="method-note">“主力”仅统计最新一期前十流通股东中的机构；“散户”是 100% 减去该比例的剩余流通盘代理，可能包含未进入前十的机构。</p>
    </section>
  );
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

function MemberNotice() {
  return <section className="member-notice"><h2>登录后使用个人研究工具</h2><p>注册账号即可保存自选、持仓、研究记录与复盘，并在不同设备间继续使用。</p><a href="/login">登录</a><a href="/register">创建账号</a></section>;
}
