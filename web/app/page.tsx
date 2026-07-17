"use client";

import { useEffect, useMemo, useState } from "react";
import MarketChart from "./components/MarketChart";
import FinancialDashboard from "./components/FinancialDashboard";
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
import { pickStockLookupResult } from "./lib/stockLookup";
import {
  emptyFinancialDataset,
  type FinancialDataset,
  type FinancialReport,
} from "./lib/financials";

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

const stockCodePattern = /^(?:(?:sh|sz)\d{6}|\d{6}(?:\.(?:sh|sz))?)$/i;
const recentStocksStorageKey = "ticklens.recent-stocks.v1";
const maxRecentStocks = 8;

function defaultRange(length: number, timeframe: Timeframe) {
  const visibleCount = timeframe === "1d" ? length : Math.min(length, 140);
  return { from: Math.max(0, length - visibleCount), to: Math.max(0, length - 1) };
}

async function resolveStockQuery(value: string): Promise<{ code: string; name: string }> {
  if (stockCodePattern.test(value)) {
    return {
      code: value.replace(/^(?:sh|sz)/i, "").replace(/\.(?:sh|sz)$/i, ""),
      name: "",
    };
  }
  try {
    const response = await fetch("/api/local-stock-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: value }),
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
  } catch {
    return lookupStockWithJsonp(value);
  }
}

function lookupStockWithJsonp(query: string): Promise<{ code: string; name: string }> {
  return new Promise((resolve, reject) => {
    const callbackName = `__ticklensLookup_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const callbackHost = window as unknown as Record<string, unknown>;
    const script = document.createElement("script");
    const endpoint = new URL("https://searchapi.eastmoney.com/api/suggest/get");
    endpoint.searchParams.set("input", query);
    endpoint.searchParams.set("type", "14");
    endpoint.searchParams.set("token", "D43BF722C8E33BDC906FB84D85E326E8");
    endpoint.searchParams.set("cb", callbackName);
    let timeout = 0;
    const cleanup = () => {
      window.clearTimeout(timeout);
      delete callbackHost[callbackName];
      script.remove();
    };
    callbackHost[callbackName] = (payload: unknown) => {
      try {
        resolve(pickStockLookupResult(payload, query));
      } catch (reason) {
        reject(reason);
      } finally {
        cleanup();
      }
    };
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = endpoint.toString();
    script.onerror = () => {
      cleanup();
      reject(new Error("股票名称查询服务暂时不可用，请稍后重试"));
    };
    timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("股票名称查询超时，请稍后重试"));
    }, 10_000);
    document.head.appendChild(script);
  });
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
  const [recentStocks, setRecentStocks] = useState<RecentStock[]>([]);
  const [fetchingStock, setFetchingStock] = useState(false);
  const [newsFilter, setNewsFilter] = useState<"全部" | NewsSentiment>("全部");

  useEffect(() => {
    let storedStocks: RecentStock[] = [];
    try {
      storedStocks = parseRecentStocks(JSON.parse(localStorage.getItem(recentStocksStorageKey) ?? "[]"));
    } catch {
      localStorage.removeItem(recentStocksStorageKey);
    }
    const frame = window.requestAnimationFrame(() => setRecentStocks(storedStocks));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const candles = useMemo(
    () => aggregateCandles(dataset.rows, selectedCode, timeframe),
    [dataset.rows, selectedCode, timeframe],
  );
  const indicators = useMemo(() => calculateIndicators(candles), [candles]);

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
    () => lastRow ? analyzeMarketIntent(dataset, selectedCode, lastRow.date) : null,
    [dataset, selectedCode, lastRow],
  );
  const latest = candles[candles.length - 1];
  const selectedName = dataset.stockNames[selectedCode] ?? "";
  const directionClass = (latest?.change ?? 0) >= 0 ? "is-up" : "is-down";
  const busy = fetchingStock;
  const selectedNews = useMemo(() => {
    const matching = newsDataset.items.filter((item) => item.code === selectedCode);
    return matching.length > 0 ? matching : newsDataset.items;
  }, [newsDataset.items, selectedCode]);
  const visibleNews = useMemo(
    () => newsFilter === "全部" ? selectedNews : selectedNews.filter((item) => item.sentiment === newsFilter),
    [newsFilter, selectedNews],
  );

  const rememberRecentStock = (code: string, name: string) => {
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
  };

  const clearRecentStocks = () => {
    setRecentStocks([]);
    try {
      localStorage.removeItem(recentStocksStorageKey);
    } catch {
      // Ignore storage restrictions and keep the in-memory list cleared.
    }
  };

  const applyDataset = (parsed: ParsedDataset, name: string) => {
    const code = parsed.codes[0];
    setDataset(parsed);
    setSelectedCode(code);
    setRange(defaultRange(aggregateCandles(parsed.rows, code, "1d").length, "1d"));
    setHoverIndex(null);
    setMarketSourceLabel(name);
    setIsDemo(false);
    setTimeframe("1d");
  };

  const applyNewsDataset = (parsed: ParsedNewsDataset, name: string) => {
    setNewsDataset(parsed);
    setNewsSourceLabel(name);
    setNewsFilter("全部");
  };

  const fetchStockData = async (queryValue = queryText) => {
    const query = queryValue.trim();
    if (!query) {
      setError("请输入股票代码或名称，例如 平安银行、002747 或 sh600000");
      return;
    }
    setFetchingStock(true);
    setError("");
    setMarketSourceLabel(`${query} · 正在识别`);
    setNewsSourceLabel(`${query} · 等待行情`);
    setFinancialSourceLabel(`${query} · 等待识别`);
    setMarketLoad({ phase: "loading", detail: "正在识别股票名称或代码…" });
    setNewsLoad({ phase: "loading", detail: "识别完成后将并行获取新闻…" });
    setFinancialLoad({ phase: "loading", detail: "识别完成后将并行获取基本面…" });
    setNewsDataset(emptyNewsDataset());
    setFinancialDataset(emptyFinancialDataset());
    setNewsFilter("全部");

    const requestCsv = async (endpoint: string, payload: unknown, fallback: string) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.text();
      if (!response.ok) {
        let message = fallback;
        try {
          message = String((JSON.parse(body) as { error?: unknown }).error || message);
        } catch {
          if (body.trim()) message = body.trim();
        }
        throw new Error(message);
      }
      return body;
    };

    const requestJson = async <T,>(endpoint: string, payload: unknown, fallback: string): Promise<T> => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.text();
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
      const resolved = await resolveStockQuery(query);
      const normalizedCode = resolved.code;
      const resolvedLabel = `${resolved.name ? `${resolved.name} · ` : ""}${normalizedCode}`;
      setQueryText(resolved.name || normalizedCode);
      setMarketSourceLabel(`${resolvedLabel} · 90日行情`);
      setNewsSourceLabel(`${resolvedLabel} · 最新新闻`);
      setFinancialSourceLabel(`${resolvedLabel} · 基本面`);
      setMarketLoad({ phase: "loading", detail: "stock-ticks 正在获取交易数据…" });
      setNewsLoad({ phase: "loading", detail: "stock-news 正在获取新闻数据…" });
      setFinancialLoad({ phase: "loading", detail: "正在获取估值、分红与三张财务报表…" });

      // The three data sources run concurrently. Each branch updates its section
      // as soon as its own response arrives, without waiting for the other one.
      const marketTask = requestCsv("/api/local-stock-data", { code: normalizedCode, days: 90 }, "获取行情数据失败")
        .then((csv) => {
          const parsed = parseMarketCsv(csv);
          const resultCode = parsed.codes[0] ?? normalizedCode;
          const resultName = parsed.stockNames[resultCode] ?? resolved.name;
          applyDataset(parsed, `${resultName ? `${resultName} · ` : ""}${resultCode} · 90日行情`);
          rememberRecentStock(resultCode, resultName);
          setMarketLoad({
            phase: "success",
            detail: `${parsed.rows.length.toLocaleString("zh-CN")} 条分笔已加载，图表已更新`,
          });
        })
        .catch((reason) => {
          const message = reason instanceof Error ? reason.message : "获取失败";
          setMarketLoad({ phase: "error", detail: message });
          throw new Error(`行情：${message}`);
        });

      const newsTask = requestCsv("/api/local-stock-news", { code: normalizedCode, limit: 30 }, "获取新闻数据失败")
        .then((csv) => {
          const parsed = parseNewsCsv(csv);
          const resultCode = parsed.codes[0] ?? normalizedCode;
          const resultName = parsed.stockNames[resultCode] ?? resolved.name;
          applyNewsDataset(parsed, `${resultName ? `${resultName} · ` : ""}${resultCode} · 新闻`);
          rememberRecentStock(resultCode, resultName);
          setNewsLoad({
            phase: "success",
            detail: `${parsed.items.length.toLocaleString("zh-CN")} 条新闻已加载，舆情已更新`,
          });
        })
        .catch((reason) => {
          const message = reason instanceof Error ? reason.message : "获取失败";
          setNewsLoad({ phase: "error", detail: message });
          throw new Error(`新闻：${message}`);
        });

      const financialTask = requestJson<FinancialDataset>(
        "/api/local-stock-financials",
        { code: normalizedCode },
        "获取基本面数据失败",
      )
        .then((parsed) => {
          if (!Array.isArray(parsed.reports) || parsed.reports.length === 0) {
            throw new Error("基本面服务未返回可用数据");
          }
          setFinancialDataset(parsed);
          const resultName = parsed.name || resolved.name;
          setFinancialSourceLabel(`${resultName ? `${resultName} · ` : ""}${parsed.code} · 基本面`);
          rememberRecentStock(parsed.code, resultName);
          setFinancialLoad({
            phase: "success",
            detail: `估值、股息与 ${parsed.analysis?.periods?.length || parsed.reports.length} 个报告期已加载`,
          });
        })
        .catch((reason) => {
          const message = reason instanceof Error ? reason.message : "获取失败";
          setFinancialLoad({ phase: "error", detail: message });
          throw new Error(`基本面：${message}`);
        });

      const results = await Promise.allSettled([marketTask, newsTask, financialTask]);
      const failures = results.flatMap((result) =>
        result.status === "rejected"
          ? [result.reason instanceof Error ? result.reason.message : "数据获取失败"]
          : [],
      );
      setError(failures.join("；"));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "获取股票数据失败";
      setMarketLoad({ phase: "error", detail: message });
      setNewsLoad({ phase: "error", detail: "未能识别股票，新闻查询未启动" });
      setFinancialLoad({ phase: "error", detail: "未能识别股票，财报查询未启动" });
      setError(message);
    } finally {
      setFetchingStock(false);
    }
  };

  const resetDemo = () => {
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
    setNewsSourceLabel("等待查询");
    setFinancialSourceLabel("等待查询");
    setNewsLoad({ phase: "idle", detail: "输入股票代码或名称后自动获取最新新闻" });
    setFinancialLoad({ phase: "idle", detail: "输入股票后自动获取估值、分红与历史财报诊断" });
    setNewsFilter("全部");
    setIsDemo(true);
    setError("");
    setQueryText("");
    setTimeframe("1d");
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
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">TL</div>
          <div>
            <p className="eyebrow">TICKLENS / 分笔实验室</p>
            <h1>行情、基本面与舆情工作台</h1>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="privacy-dot" aria-hidden="true" />
          行情、基本面与新闻并行采集 · 浏览器分析
          <span className="build-tag">L1 · FIN · NEWS</span>
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
          {error ? <span className="error-message">{error}</span> : null}
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
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="股票名称或代码，如 平安银行 / 000001"
              autoComplete="off"
              maxLength={40}
              disabled={busy}
            />
            <button type="submit" disabled={busy}>{fetchingStock ? "数据加载中…" : "获取行情 + 基本面 + 新闻"}</button>
          </form>
          {!isDemo ? (
            <button className="button ghost" type="button" onClick={resetDemo}>
              恢复演示
            </button>
          ) : null}
        </div>
      </section>

      <section className="recent-query-strip" aria-label="最近查询的股票">
        <span className="recent-query-label">最近查询</span>
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
          )) : <span className="recent-query-empty">成功查询后会在这里保留最近 {maxRecentStocks} 只股票</span>}
        </div>
        {recentStocks.length > 0 ? (
          <button className="recent-query-clear" type="button" onClick={clearRecentStocks} disabled={busy}>清空</button>
        ) : null}
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
          <strong className={directionClass}>{latest ? formatNumber(latest.close, 3) : "—"}</strong>
          <span className={directionClass}>
            {latest ? `${latest.change >= 0 ? "+" : ""}${formatNumber(latest.change, 3)}  ${latest.changePct >= 0 ? "+" : ""}${formatNumber(latest.changePct, 2)}%` : "—"}
          </span>
        </div>
        <div className="quote-stats">
          <Stat label="开" value={latest ? formatNumber(latest.open, 3) : "—"} />
          <Stat label="高" value={latest ? formatNumber(latest.high, 3) : "—"} />
          <Stat label="低" value={latest ? formatNumber(latest.low, 3) : "—"} />
          <Stat label="量" value={latest ? compactNumber(latest.volume) : "—"} />
          <Stat label="额" value={latest ? compactNumber(latest.amount) : "—"} />
          <Stat label="换手" value={latest?.turnoverPct == null ? "—" : `${formatNumber(latest.turnoverPct, 2)}%`} />
        </div>
      </section>

      <section className="workspace-grid">
        <div className="chart-card">
          <div className="chart-toolbar">
            <div className="segmented" aria-label="K线周期">
              {timeframes.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={timeframe === key ? "active" : ""}
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
            <button className="icon-button" type="button" onClick={exportCandles} title="导出当前周期K线" aria-label="导出当前周期K线">
              ⇩
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
            candles={candles}
            indicators={indicators}
            overlays={overlays}
            lowerIndicator={lowerIndicator}
            range={range}
            onRangeChange={setRange}
            onHover={setHoverIndex}
          />

          <div className="chart-footer-controls">
            <div className="segmented compact" aria-label="副图指标">
              {lowerIndicators.map((indicator) => (
                <button key={indicator} type="button" className={lowerIndicator === indicator ? "active" : ""} onClick={() => setLowerIndicator(indicator)}>
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
              <button type="button" onClick={() => setRange({ from: 0, to: Math.max(0, candles.length - 1) })}>全部</button>
            </div>
          </div>
        </div>

        <aside className="analysis-rail">
          <section className="rail-card conclusion-card">
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
              <span className="live-indicator"><i /> LOCAL</span>
            </div>
            <div className="data-grid">
              <Stat label="分笔记录" value={dataset.rows.length.toLocaleString("zh-CN")} />
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
            ) : <p className="empty-note">当前日期没有可分析的连续竞价记录。</p>}
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
        </aside>
      </section>

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
          <span>由分笔成交在浏览器内聚合</span>
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
              <p>{newsLoad.phase === "loading" ? "stock-news 完成采集后，新闻列表与情绪统计会立即显示在这里。" : "页面会自动调用新闻应用，并展示标题、来源、摘要、情绪倾向和原文链接。"}</p>
            </div>
          </div>
        )}
      </section>

      <footer className="footer-note">
        <span>输入股票后，行情、估值分红、历史财报诊断与新闻会同步获取，先完成的数据会先更新页面。</span>
        <span>Level-1、九转、B/S、主力行为与新闻情绪均为研究代理，只供投资参考，不构成投资建议。</span>
      </footer>
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
    <button type="button" className={active ? "active" : ""} onClick={onClick}>
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
