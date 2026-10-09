"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAppearance } from "../components/AppearanceProvider";
import KlineViewportControls from "../components/KlineViewportControls";
import SiteBanner from "../components/SiteBanner";
import { plotIndexFromPointer } from "../lib/chartInteraction";
import { analyzeShanghaiIndexHistory, GLOBAL_INDEXES, type FearGaugeCandle, type FearGaugeQuote, type GlobalIndexFeed, type GlobalIndexQuote, type GlobalRegion, type ShanghaiIndexCandle } from "../lib/globalIndexes";
import {
  getKlineWheelIntent,
  normalizeWheelDelta,
  panKlineRange,
  rangeForLatest,
  resolveKlineDragIntent,
  wheelDeltaToKlinePan,
  zoomKlineRange,
  type KlineDragIntent,
  type KlineRange,
} from "../lib/klineViewport";
import { projectRobinsonPoint } from "../lib/robinsonProjection";
import { US_INDEXES, type USIndexSessionQuote, type USMarketPhase } from "../lib/usMarketIndexes";
import "./global-markets.css";

type FeedState = "loading" | "live" | "refreshing" | "error";
const mapLabelOffsets: Record<string, { x: number; y: number }> = {
  tsx: { x: -116, y: -52 },
  dow: { x: 17, y: 13 },
  bovespa: { x: 18, y: -18 },
  ftse: { x: -126, y: -48 },
  dax: { x: 18, y: -52 },
  cac: { x: 20, y: 17 },
  sensex: { x: -150, y: 30 },
  shanghai: { x: 18, y: 19 },
  hsi: { x: 18, y: 41 },
  kospi: { x: -66, y: -58 },
  nikkei: { x: 17, y: -13 },
  sti: { x: -126, y: 15 },
  asx: { x: -124, y: 13 },
};
const mapTickerLabels: Record<string, string> = {
  tsx: "TSX", dow: "DOW", bovespa: "BVSP", ftse: "FTSE", dax: "DAX", cac: "CAC", sensex: "SENSEX",
  shanghai: "上证", hsi: "恒指", kospi: "KOSPI", nikkei: "日经", sti: "STI", asx: "ASX",
};

export default function GlobalMarketsPage() {
  const { appearance, toggleAppearance } = useAppearance();
  const [quotes, setQuotes] = useState<GlobalIndexQuote[]>([]);
  const [usQuotes, setUSQuotes] = useState<USIndexSessionQuote[]>([]);
  const [fearGauges, setFearGauges] = useState<FearGaugeQuote[]>([]);
  const [shanghaiHistory, setShanghaiHistory] = useState<ShanghaiIndexCandle[]>([]);
  const [feedState, setFeedState] = useState<FeedState>("loading");
  const [fetchedAt, setFetchedAt] = useState("");
  const [error, setError] = useState("");
  const [preservedStock, setPreservedStock] = useState("");
  const [mobileChapter, setMobileChapter] = useState<"overview" | "trend" | "map" | "regions">("overview");
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    document.title = "全球市场 · TrendSight";
    return () => { document.title = "TrendSight · 市场研究工作台"; };
  }, []);

  const refresh = useCallback(async (silent = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (!silent) setFeedState((current) => current === "loading" ? "loading" : "refreshing");
    try {
      const response = await fetch("/api/global-indexes", { cache: "no-store", signal: controller.signal });
      const body = await response.json() as GlobalIndexFeed & { error?: string };
      if (!response.ok) throw new Error(body.error || "全球指数行情暂不可用");
      setQuotes(body.quotes ?? []);
      setUSQuotes(body.usQuotes ?? []);
      setFearGauges(body.fearGauges ?? []);
      setShanghaiHistory(body.shanghaiHistory ?? []);
      setFetchedAt(body.fetchedAt ?? new Date().toISOString());
      setError("");
      setFeedState("live");
    } catch (reason) {
      if ((reason as { name?: string })?.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "全球指数刷新失败");
      setFeedState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stock = new URLSearchParams(window.location.search).get("stock") ?? "";
      if (/^\d{6}$/.test(stock)) setPreservedStock(stock);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 10_000);
    const handleVisibility = () => { if (document.visibilityState === "visible") void refresh(true); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      requestRef.current?.abort();
    };
  }, [refresh]);

  const quoteById = useMemo(() => new Map(quotes.map((quote) => [quote.id, quote])), [quotes]);
  const usQuoteById = useMemo(() => new Map(usQuotes.map((quote) => [quote.id, quote])), [usQuotes]);
  const fearGaugeByMarket = useMemo(() => new Map(fearGauges.map((quote) => [quote.market, quote])), [fearGauges]);
  const marketMoves = [
    ...quotes.map((quote) => ({ name: quote.name, changePct: quote.changePct })),
    ...usQuotes.flatMap((quote) => quote.cashChangePct == null ? [] : [{ name: quote.name, changePct: quote.cashChangePct }]),
  ];
  const openMarketMoves = [
    ...quotes.filter((quote) => quote.marketStatus === "交易中").map((quote) => ({ name: quote.name, changePct: quote.changePct })),
    ...usQuotes.flatMap((quote) => quote.phase === "盘中" && quote.phaseChangePct != null ? [{ name: quote.name, changePct: quote.phaseChangePct }] : []),
  ];
  const openRising = openMarketMoves.filter((quote) => quote.changePct > 0).length;
  const openFalling = openMarketMoves.filter((quote) => quote.changePct < 0).length;
  const snapshotRising = marketMoves.filter((quote) => quote.changePct > 0).length;
  const snapshotFalling = marketMoves.filter((quote) => quote.changePct < 0).length;
  const openMarkets = quotes.filter((quote) => quote.marketStatus === "交易中").length + (usQuotes[0]?.phase === "盘中" ? 1 : 0);
  const leader = [...marketMoves].sort((left, right) => Math.abs(right.changePct) - Math.abs(left.changePct))[0];
  const shanghaiQuote = quoteById.get("shanghai");
  const usFearGauge = fearGaugeByMarket.get("美股");
  const openBreadthTotal = openRising + openFalling;
  const openBreadthPct = openBreadthTotal ? Math.round((openRising / openBreadthTotal) * 100) : 0;
  const snapshotBreadthTotal = snapshotRising + snapshotFalling;
  const snapshotBreadthPct = snapshotBreadthTotal ? Math.round((snapshotRising / snapshotBreadthTotal) * 100) : 0;
  const coveredIndexes = quotes.length + usQuotes.length || GLOBAL_INDEXES.length + US_INDEXES.length;
  const mappedMarkets = [
    ...GLOBAL_INDEXES.filter((item) => item.map).map((definition) => ({
      id: definition.id,
      city: definition.city,
      name: definition.name,
      longitude: definition.map!.longitude,
      latitude: definition.map!.latitude,
      changePct: quoteById.get(definition.id)?.changePct,
    })),
    ...US_INDEXES.filter((item) => item.map).map((definition) => ({
      id: definition.id,
      city: "纽约",
      name: definition.name,
      longitude: definition.map!.longitude,
      latitude: definition.map!.latitude,
      changePct: usQuoteById.get(definition.id)?.cashChangePct ?? undefined,
    })),
  ];
  const mappedMarketCount = mappedMarkets.length;
  const hasMarketData = quotes.length + usQuotes.length > 0;
  const loading = feedState === "loading" || feedState === "refreshing";
  const chapters = [
    { id: "overview", label: "市场概览", target: "global-overview" },
    { id: "trend", label: "上证趋势", target: "shanghai-index" },
    { id: "map", label: "市场地图", target: "global-map" },
    { id: "regions", label: "区域行情", target: "global-regions" },
  ] as const;
  const navigateChapter = (chapter: typeof chapters[number]) => {
    setMobileChapter(chapter.id);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(chapter.target);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    });
  };

  return (
    <div className="global-page">
      <SiteBanner
        activePage="global"
        currentStockCode={preservedStock}
        appearance={appearance}
        onToggleAppearance={toggleAppearance}
        statusText={fetchedAt ? `${feedLabel(feedState)} · ${formatFetchedAt(fetchedAt)}` : feedLabel(feedState)}
      />
      <main className="app-shell global-page-shell">
      <aside className="app-sidebar global-sidebar global-navigation-sidebar">
        <section className="sidebar-menu-summary sidebar-preview-card global-sidebar-summary" aria-label="全球市场汇总">
          <header className="sidebar-preview-header">
            <div>
              <span>全球市场</span>
              <strong>{!hasMarketData ? loading ? "正在连接行情" : "行情暂不可用" : openMarkets ? "实时交易中" : "主要市场休市"}</strong>
              <small>{fetchedAt ? `更新于 ${formatFetchedAt(fetchedAt)}` : loading ? "正在连接全球行情" : "等待有效行情"}</small>
            </div>
            <em className={`sidebar-status-pill ${openMarkets ? "is-live" : ""}`}><i />{!hasMarketData ? "待更新" : openMarkets ? `${openMarkets} 开盘` : "休市"}</em>
          </header>
          <div className="sidebar-preview-hero" aria-label="全球股指实时汇总">
            <span>当前开市广度</span>
            <strong>{openBreadthTotal ? `${openBreadthPct}%` : "—"}</strong>
            <em className={openBreadthTotal ? openBreadthPct >= 55 ? "is-up" : openBreadthPct <= 45 ? "is-down" : "is-flat" : "is-flat"}>{openBreadthTotal ? `${openRising} 涨 / ${openFalling} 跌` : hasMarketData ? "当前无开市样本" : "等待有效行情"}</em>
            <div className="sidebar-breadth-track" aria-hidden="true"><i style={{ width: `${openBreadthPct}%` }} /></div>
            <small>跨市场最近快照 {snapshotBreadthTotal ? `${snapshotBreadthPct}% · ${snapshotRising} 涨/${snapshotFalling} 跌` : "等待行情"}</small>
          </div>
          <div className="sidebar-preview-metrics global-sidebar-snapshot">
            <div>
              <span>上证指数</span>
              <strong>{shanghaiQuote ? formatPrice(shanghaiQuote.price) : "—"}</strong>
              <em className={tone(shanghaiQuote?.changePct)}>{shanghaiQuote ? signedPercent(shanghaiQuote.changePct) : "行情连接中"}</em>
            </div>
            <div>
              <span>美股波动</span>
              <strong>{usFearGauge ? formatPrice(usFearGauge.value) : "—"}</strong>
              <em className={fearTone(usFearGauge?.value)}>{usFearGauge?.level ?? "VIX 等待更新"}</em>
            </div>
          </div>
          <dl className="sidebar-preview-strip" aria-label="全球市场覆盖摘要">
            <div><dt>覆盖指数</dt><dd>{coveredIndexes}</dd></div>
            <div><dt>交易中</dt><dd>{hasMarketData ? openMarkets : "—"}</dd></div>
            <div><dt>波动焦点</dt><dd className={tone(leader?.changePct)} title={leader?.name}>{leader ? signedPercent(leader.changePct) : "—"}</dd></div>
          </dl>
          <small className="sidebar-preview-source">焦点 · {leader?.name ?? "等待实时数据"}</small>
        </section>
        <nav className="workspace-nav global-workspace-nav" aria-label="全球股指快速导航">
          <p className="sidebar-nav-heading">快速定位</p>
          <a href="#global-overview"><span>市场概览</span><small>Overview</small></a>
          <a href="#a-share-indexes"><span>A股核心</span><small>A Share</small></a>
          <a href="#shanghai-index"><span>上证指数</span><small>Shanghai</small></a>
          <a href="#global-map"><span>全球地图</span><small>Map</small></a>
          <a href="#us-indexes"><span>美股指数</span><small>US</small></a>
          <a href="#americas-indexes"><span>美洲市场</span><small>Americas</small></a>
          <a href="#europe-indexes"><span>欧洲市场</span><small>Europe</small></a>
          <a href="#asia-indexes"><span>亚太市场</span><small>Asia</small></a>
        </nav>
      </aside>

      <div className="app-workspace-shell global-main">
        <header className="global-workspace-heading">
          <div><p>GLOBAL MARKETS</p><h1>全球市场</h1><span>先看市场广度，再看量价趋势与区域表现。</span></div>
          <div className="global-heading-actions">
            <div className={`global-heading-status ${error ? "has-error" : ""}`} role="status">
              <strong><i aria-hidden="true" />{loading ? "正在更新行情" : error ? hasMarketData ? "暂用上次行情" : "行情连接异常" : hasMarketData ? "行情已更新" : "暂无可用行情"}</strong>
              <small>{fetchedAt ? `更新 ${formatFetchedAt(fetchedAt)} · 每 10 秒刷新` : "可见页面每 10 秒自动刷新"}</small>
            </div>
            <button
              className="global-mobile-refresh"
              type="button"
              disabled={loading}
              onClick={() => void refresh()}
            >
              {loading ? "更新中…" : "刷新行情"}
            </button>
          </div>
        </header>
        <nav className="global-chapter-nav" aria-label="选择全球市场信息层">
          {chapters.map((chapter) => <button key={chapter.id} type="button" aria-pressed={mobileChapter === chapter.id} aria-controls={chapter.target} onClick={() => navigateChapter(chapter)}>{chapter.label}</button>)}
        </nav>
        {error ? <div className="global-error" role="status"><strong>{hasMarketData ? "本次刷新未成功" : "暂时无法获取行情"}</strong><span>{error}。{hasMarketData ? "已保留上一份有效行情，" : ""}页面将在下一个刷新周期自动重试，也可点击“刷新行情”。</span></div> : null}

        <div className="platform-mobile-chapter" data-active={mobileChapter === "overview"}>
          <section id="global-overview" className="global-summary" aria-label="全球市场概览" tabIndex={-1} aria-busy={loading}>
            <article><span>覆盖指数</span><strong>{quotes.length + usQuotes.length || GLOBAL_INDEXES.length + US_INDEXES.length}</strong><small>美股 · A股 · 美洲 · 欧洲 · 亚太</small></article>
            <article><span>当前开市广度 · 涨 / 跌</span><strong><em className="is-up">{hasMarketData ? openRising : "—"}</em><b>/</b><em className="is-down">{hasMarketData ? openFalling : "—"}</em></strong><small>{openBreadthTotal ? `上涨占比 ${openBreadthPct}% · 仅统计交易中市场` : hasMarketData ? "当前没有交易中样本" : "等待有效行情"}</small></article>
            <article><span>跨市场最近快照 · 涨 / 跌</span><strong><em className="is-up">{hasMarketData ? snapshotRising : "—"}</em><b>/</b><em className="is-down">{hasMarketData ? snapshotFalling : "—"}</em></strong><small>各市场时点不同，不视为同步收盘比较</small></article>
            <article><span>交易中市场</span><strong>{hasMarketData ? openMarkets : "—"}</strong><small>依据各交易所当地时段</small></article>
            <article><span>波动焦点</span><strong className={tone(leader?.changePct)}>{leader ? signedPercent(leader.changePct) : "—"}</strong><small>{leader?.name ?? "等待实时数据"}</small></article>
          </section>

          <section id="a-share-indexes" className="global-a-share-board" aria-label="A股核心指数行情" tabIndex={-1}>
            <RegionPanel region="A股" definitions={GLOBAL_INDEXES.filter((item) => item.region === "A股")} quoteById={quoteById} fearGauge={fearGaugeByMarket.get("A股")} feedState={feedState} onRetry={() => void refresh()} />
          </section>
        </div>

        <div className="platform-mobile-chapter" data-active={mobileChapter === "trend"}>
          <ShanghaiIndexPanel key={`shanghai-${shanghaiHistory.length}`} candles={shanghaiHistory} feedState={feedState} onRetry={() => void refresh()} />
        </div>

        <section id="global-map" className="global-map-card platform-mobile-visibility" data-active={mobileChapter === "map"} aria-label="全球主要股指地图" tabIndex={-1}>
          <header>
            <div><p>MARKET REGIONS</p><h2>全球主要市场板块</h2></div>
            <div className="global-map-header-meta">
              <span className="global-map-count">{mappedMarketCount} 个主要市场</span>
              <div className="global-legend"><span className="is-up">上涨</span><span className="is-down">下跌</span><span>平盘</span></div>
            </div>
          </header>
          <div className="global-map-stage">
            <div className="global-map-viewport">
              {/* The land silhouette and every market use the exact same Robinson viewBox. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="global-map-land" src="/world-map-robinson.svg" alt="" aria-hidden="true" />
              {mappedMarkets.map((market) => <MarketMapMarker key={market.id} {...market} />)}
            </div>
            <div className="global-map-mobile-list" aria-label="全球主要市场行情列表">
              {mappedMarkets.map((market) => {
                const changeLabel = market.changePct == null ? "等待行情" : signedPercent(market.changePct);
                return (
                  <article key={market.id} className={tone(market.changePct)} aria-label={`${market.city}，${market.name}，${changeLabel}`}>
                    <span><small>{market.city}</small><strong>{compactIndexName(market.name)}</strong></span>
                    <b>{market.changePct == null ? "—" : changeLabel}</b>
                  </article>
                );
              })}
            </div>
          </div>
          <footer><span>按交易所所在位置展示 · 跨市场行情时点可能不同</span><span>红涨绿跌 · 行情每 10 秒刷新</span></footer>
        </section>

        <section id="global-regions" className="global-region-board platform-mobile-visibility" data-active={mobileChapter === "regions"} aria-label="全球指数行情列表" tabIndex={-1}>
          <nav className="global-region-jumps" aria-label="选择市场区域"><span>按区域查看</span><a href="#us-indexes">美股核心</a><a href="#americas-indexes">美洲</a><a href="#europe-indexes">欧洲</a><a href="#asia-indexes">亚太</a></nav>
          <USMarketPanel quotes={usQuotes} fearGauge={fearGaugeByMarket.get("美股")} feedState={feedState} onRetry={() => void refresh()} />
          {(["美洲", "欧洲", "亚太"] as GlobalRegion[]).map((region) => (
            <RegionPanel key={region} region={region} definitions={GLOBAL_INDEXES.filter((item) => item.region === region)} quoteById={quoteById} feedState={feedState} onRetry={() => void refresh()} />
          ))}
        </section>
      </div>
      </main>
    </div>
  );
}

function ShanghaiIndexPanel({ candles, feedState, onRetry }: { candles: ShanghaiIndexCandle[]; feedState: FeedState; onRetry: () => void }) {
  const [range, setRange] = useState<KlineRange>(() => rangeForLatest(candles.length, 60));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    range: KlineRange;
    pointerId: number;
    intent: KlineDragIntent;
  } | null>(null);
  const visible = useMemo(() => candles.slice(range.from, range.to + 1), [candles, range]);
  const analysis = useMemo(() => analyzeShanghaiIndexHistory(candles), [candles]);
  const latest = candles.at(-1);

  const width = 960;
  const height = 370;
  const padding = { top: 18, right: 72, bottom: 25, left: 10 };
  const plotWidth = width - padding.left - padding.right;
  const priceHeight = 222;
  const amountTop = 270;
  const amountHeight = 68;
  const low = visible.length ? Math.min(...visible.map((candle) => candle.low)) : 0;
  const high = visible.length ? Math.max(...visible.map((candle) => candle.high)) : 1;
  const rangePadding = Math.max((high - low) * .08, 8);
  const minimum = Math.max(0, low - rangePadding);
  const maximum = high + rangePadding;
  const step = plotWidth / Math.max(1, visible.length);
  const bodyWidth = Math.max(2.4, Math.min(9, step * .58));
  const barWidth = Math.max(2.4, Math.min(10, step * .68));
  const priceY = (value: number) => padding.top + ((maximum - value) / Math.max(.001, maximum - minimum)) * priceHeight;
  const amountValues = visible.map((candle) => candle.amountCny / 100_000_000);
  const maximumAmount = Math.max(1, ...amountValues) * 1.08;
  const amountY = (value: number) => amountTop + amountHeight - (value / maximumAmount) * amountHeight;
  const visibleOffset = range.from;
  const amountMa20 = visible.map((_, index) => {
    const globalIndex = visibleOffset + index;
    const window = candles.slice(Math.max(0, globalIndex - 19), globalIndex + 1);
    return window.reduce((sum, candle) => sum + candle.amountCny, 0) / Math.max(1, window.length) / 100_000_000;
  });
  const ma20Path = amountMa20.map((value, index) => `${index ? "L" : "M"}${padding.left + (index + .5) * step},${amountY(value)}`).join(" ");
  const activeIndex = hoverIndex == null || !visible.length ? null : Math.min(visible.length - 1, hoverIndex);
  const active = activeIndex == null ? undefined : visible[activeIndex];
  const activeX = activeIndex == null ? 0 : padding.left + (activeIndex + .5) * step;
  const visibleLatest = visible.at(-1);
  const activePrevious = activeIndex == null ? undefined : candles[visibleOffset + activeIndex - 1];
  const activeAmountChangePct = active && activePrevious ? ((active.amountCny / activePrevious.amountCny) - 1) * 100 : 0;
  const activeVolumeState = volumeState(activeAmountChangePct);

  return (
    <section id="shanghai-index" className="global-shanghai-panel" aria-label="上证指数日K与沪深两市成交额" tabIndex={-1}>
      <header className="global-shanghai-header">
        <div><p>SHANGHAI COMPOSITE · 000001</p><h2>上证指数日 K 与沪深两市成交额</h2><small>上证指数价格 · 沪深两市成交额 · 单位亿元</small></div>
        <div className="global-shanghai-latest">
          <span>最近收盘</span><strong>{latest ? formatPrice(latest.close) : "—"}</strong>
          <em className={tone(analysis?.priceChangePct)}>{analysis ? signedPercent(analysis.priceChangePct) : "—"}</em>
        </div>
        <div className="global-kline-actions">
          <div className="global-fear-periods" aria-label="上证指数K线周期">
            {([20, 60, 120] as const).map((value) => {
              const active = visible.length === Math.min(value, candles.length) && range.to === candles.length - 1;
              return <button key={value} type="button" disabled={!candles.length} className={active && candles.length ? "is-active" : ""} aria-pressed={Boolean(active && candles.length)} onClick={() => { setRange(rangeForLatest(candles.length, value)); setHoverIndex(null); }}>{value}日</button>;
            })}
          </div>
          <KlineViewportControls className="is-inline is-apple" range={range} total={candles.length} minVisible={12} resetVisible={60} onRangeChange={(next) => { setRange(next); setHoverIndex(null); }} />
        </div>
      </header>

      <div className="global-shanghai-analysis" aria-label="上证指数量价分析">
        <article>
          <span>最新量能</span>
          <strong>{latest ? `${formatAmountHundredMillion(latest.amountCny)} 亿` : "—"}</strong>
          <small className={volumeStateTone(analysis?.volumeState)}>{analysis ? `${analysis.volumeState} ${signedPercent(analysis.amountChangePct)}` : "等待历史成交额"}</small>
        </article>
        <article>
          <span>量价配合</span>
          <strong>{analysis?.signal ?? "—"}</strong>
          <small>{analysis?.headline ?? "历史日线载入后自动判断"}</small>
        </article>
        <article>
          <span>20日量能位置</span>
          <strong className={tone(analysis?.amountVs20DayPct)}>{analysis ? signedPercent(analysis.amountVs20DayPct) : "—"}</strong>
          <small>{analysis ? `${analysis.amountVs20DayPct >= 0 ? "高于" : "低于"}前20日均额` : "以前20个完整交易日为基准"}</small>
        </article>
        <article>
          <span>近5日指数</span>
          <strong className={tone(analysis?.fiveDayPriceChangePct)}>{analysis ? signedPercent(analysis.fiveDayPriceChangePct) : "—"}</strong>
          <small>观察短期价格方向</small>
        </article>
      </div>

      {analysis ? <p className="global-shanghai-insight"><strong>{analysis.headline}</strong><span>{analysis.detail} 单日量价关系只反映交易活跃度与价格方向，不单独构成趋势确认。</span></p> : null}

      {visible.length ? (
        <>
          <div className="global-chart-guide" id="shanghai-chart-guide"><span>日 K · {visible.length} 个交易日</span><p>拖动平移 · Ctrl / ⌘ + 滚轮缩放 · 悬停或轻触查看单日 · 双击复位</p><small>键盘：← → 平移，Enter 查看单日，+ / − 缩放，0 复位，Esc 收起详情</small></div>
          <div
            className={`global-shanghai-chart-stage ${isDragging ? "is-dragging" : ""}`}
            tabIndex={0}
            aria-describedby="shanghai-chart-guide"
            aria-label={`上证指数 K 线交互区，当前显示 ${visible.length} 根；按住 Ctrl 或 Command 并滚轮缩放，Shift 加滚轮或横向拖动平移，双击复位`}
            style={{ touchAction: "pan-y pinch-zoom" }}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              const intent = event.pointerType === "touch" ? "pending" : "horizontal";
              dragRef.current = {
                x: event.clientX,
                y: event.clientY,
                range,
                pointerId: event.pointerId,
                intent,
              };
              if (intent === "horizontal") {
                event.currentTarget.setPointerCapture(event.pointerId);
                setIsDragging(true);
                setHoverIndex(null);
              }
            }}
            onPointerLeave={() => { if (!dragRef.current) setHoverIndex(null); }}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (dragRef.current && visible.length) {
                if (dragRef.current.pointerId !== event.pointerId) return;
                if (dragRef.current.intent === "pending") {
                  dragRef.current.intent = resolveKlineDragIntent(
                    event.clientX - dragRef.current.x,
                    event.clientY - dragRef.current.y,
                  );
                  if (dragRef.current.intent === "horizontal") {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setIsDragging(true);
                    setHoverIndex(null);
                  }
                }
                if (dragRef.current.intent !== "horizontal") return;
                const candleWidth = (bounds.width * (plotWidth / width)) / visible.length;
                const delta = Math.round((dragRef.current.x - event.clientX) / Math.max(candleWidth, 1));
                setRange(panKlineRange(dragRef.current.range, candles.length, delta));
                return;
              }
              const pointerX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
              setHoverIndex(plotIndexFromPointer({ pointerX, containerWidth: bounds.width, viewBoxWidth: width, plotLeft: padding.left, plotWidth, pointCount: visible.length }));
            }}
            onPointerUp={(event) => {
              const gesture = dragRef.current;
              dragRef.current = null;
              setIsDragging(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              if (gesture?.intent === "pending") {
                const bounds = event.currentTarget.getBoundingClientRect();
                const pointerX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
                setHoverIndex(plotIndexFromPointer({ pointerX, containerWidth: bounds.width, viewBoxWidth: width, plotLeft: padding.left, plotWidth, pointCount: visible.length }));
              }
            }}
            onPointerCancel={() => { dragRef.current = null; setIsDragging(false); }}
            onLostPointerCapture={() => { dragRef.current = null; setIsDragging(false); }}
            onWheel={(event) => {
              const wheelIntent = getKlineWheelIntent(event);
              if (wheelIntent === "page") return;
              event.preventDefault();
              const wheelDelta = wheelIntent === "pan" && Math.abs(event.deltaX) > Math.abs(event.deltaY)
                ? event.deltaX
                : event.deltaY;
              const delta = normalizeWheelDelta(wheelDelta, event.deltaMode, height);
              if (wheelIntent === "pan") {
                const candleDelta = wheelDeltaToKlinePan(delta, visible.length);
                if (candleDelta) setRange(panKlineRange(range, candles.length, candleDelta));
                setHoverIndex(null);
                return;
              }
              const bounds = event.currentTarget.getBoundingClientRect();
              const pointerX = (event.clientX - bounds.left) * (width / Math.max(bounds.width, 1));
              setRange(zoomKlineRange({
                range,
                total: candles.length,
                deltaY: delta,
                anchorRatio: (pointerX - padding.left) / Math.max(plotWidth, 1),
                minVisible: 12,
              }));
              setHoverIndex(null);
            }}
            onDoubleClick={() => { setRange(rangeForLatest(candles.length, 60)); setHoverIndex(null); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setHoverIndex(null);
              } else if (event.key === "Enter") {
                event.preventDefault();
                setHoverIndex((current) => current == null ? visible.length - 1 : null);
              } else if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                setRange(zoomKlineRange({ range, total: candles.length, deltaY: -120, anchorRatio: 1, minVisible: 12 }));
                setHoverIndex(null);
              } else if (event.key === "-") {
                event.preventDefault();
                setRange(zoomKlineRange({ range, total: candles.length, deltaY: 120, anchorRatio: 1, minVisible: 12 }));
                setHoverIndex(null);
              } else if (event.key === "0") {
                event.preventDefault();
                setRange(rangeForLatest(candles.length, 60));
                setHoverIndex(null);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const direction = event.key === "ArrowRight" ? 1 : -1;
                if (hoverIndex != null) setHoverIndex(Math.max(0, Math.min(visible.length - 1, hoverIndex + direction)));
                else setRange(panKlineRange(range, candles.length, direction * Math.max(1, Math.round(visible.length * .1))));
              }
            }}
          >
            <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`上证指数最近 ${visible.length} 个交易日日K和沪深两市成交额`}>
              <defs>
                <pattern id="shanghai-volume-contraction" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" className="shanghai-volume-pattern-line" />
                </pattern>
              </defs>
              {[0, .5, 1].map((position) => {
                const gridY = padding.top + position * priceHeight;
                const label = maximum - position * (maximum - minimum);
                return (
                  <g key={position}>
                    <line className="fear-grid-line" x1={padding.left} x2={width - padding.right} y1={gridY} y2={gridY} />
                    <text className="fear-axis-label" x={width - 5} y={gridY + 3} textAnchor="end">{label.toFixed(0)}</text>
                  </g>
                );
              })}
              {[.25, .5, .75].map((position) => (
                <line className="fear-grid-line is-vertical" key={`x-${position}`} x1={padding.left + plotWidth * position} x2={padding.left + plotWidth * position} y1={padding.top} y2={amountTop + amountHeight} />
              ))}
              {visibleLatest ? (
                <g className="kline-last-price">
                  <line x1={padding.left} x2={width - padding.right} y1={priceY(visibleLatest.close)} y2={priceY(visibleLatest.close)} />
                  <text x={width - padding.right + 7} y={priceY(visibleLatest.close) + 3}>{visibleLatest.close.toFixed(0)}</text>
                </g>
              ) : null}
              <line className="shanghai-chart-divider" x1={padding.left} x2={width - padding.right} y1={amountTop - 16} y2={amountTop - 16} />
              <text className="shanghai-chart-section-label" x={padding.left} y={amountTop - 22}>成交额 · 实心放量 / 斜纹缩量 / 虚线20日均额</text>
              <text className="fear-axis-label" x={width - 5} y={amountTop + 3} textAnchor="end">{maximumAmount.toFixed(0)}亿</text>
              <text className="fear-axis-label" x={width - 5} y={amountTop + amountHeight} textAnchor="end">0</text>
              {visible.map((candle, index) => {
                const x = padding.left + (index + .5) * step;
                const openY = priceY(candle.open);
                const closeY = priceY(candle.close);
                const rising = candle.close >= candle.open;
                const previous = candles[visibleOffset + index - 1];
                const amountChangePct = previous ? ((candle.amountCny / previous.amountCny) - 1) * 100 : 0;
                const state = volumeState(amountChangePct);
                const amount = candle.amountCny / 100_000_000;
                return (
                  <g key={candle.date}>
                    <g className={rising ? "is-up" : "is-down"}>
                      <line className="fear-candle-wick" x1={x} x2={x} y1={priceY(candle.high)} y2={priceY(candle.low)} />
                      <rect className="fear-candle-body" x={x - bodyWidth / 2} y={Math.min(openY, closeY)} width={bodyWidth} height={Math.max(1.5, Math.abs(closeY - openY))} rx={1} />
                    </g>
                    <rect className={`shanghai-amount-bar ${state === "放量" ? "is-expand" : state === "缩量" ? "is-contract" : "is-steady"}`} x={x - barWidth / 2} y={amountY(amount)} width={barWidth} height={Math.max(1, amountTop + amountHeight - amountY(amount))} rx={1} />
                  </g>
                );
              })}
              <path className="shanghai-amount-ma20" d={ma20Path} />
              {active ? (
                <g>
                  <line className="fear-crosshair" x1={activeX} x2={activeX} y1={padding.top} y2={amountTop + amountHeight} />
                  <line className="fear-crosshair is-horizontal" x1={padding.left} x2={width - padding.right} y1={priceY(active.close)} y2={priceY(active.close)} />
                </g>
              ) : null}
            </svg>
            {active ? (
              <div
                className={`global-shanghai-tooltip ${activeX < width / 2 ? "is-edge-end" : "is-edge-start"}`}
                style={activeX < width / 2 ? { right: 10 } : { left: 10 }}
              >
                <strong>{active.date}</strong>
                <span>开 {active.open.toFixed(2)}</span><span>高 {active.high.toFixed(2)}</span>
                <span>低 {active.low.toFixed(2)}</span><span>收 {active.close.toFixed(2)}</span>
                <b className={volumeStateTone(activeVolumeState)}>{activeVolumeState} {activePrevious ? signedPercent(activeAmountChangePct) : "—"}</b>
                <em>两市成交额 {formatAmountHundredMillion(active.amountCny)} 亿元</em>
              </div>
            ) : null}
          </div>
          <footer className="global-shanghai-footer"><span>{visible[0]?.date ?? "—"}</span><small>搜狐财经公开日线 · 上证与深证综指成交额按日求和 · 数据可能延迟一个交易日</small><span>{visible.at(-1)?.date ?? "—"}</span></footer>
        </>
      ) : <div className="global-shanghai-chart-empty" role="status">
        {feedState === "loading" || feedState === "refreshing" ? <span className="loading-spinner" aria-hidden="true" /> : null}
        <strong>{feedState === "loading" || feedState === "refreshing" ? "正在加载历史日线与成交额" : feedState === "error" ? "历史行情暂时无法加载" : "暂无可用的历史日线"}</strong>
        <p>{feedState === "loading" || feedState === "refreshing" ? "上证日线与沪深两市成交额准备就绪后会显示在这里。" : feedState === "error" ? "可手动重新加载，页面也会自动尝试连接。" : "本次数据未包含上证日线与沪深两市成交额，可稍后刷新。"}</p>
        <button type="button" disabled={feedState === "loading" || feedState === "refreshing"} onClick={onRetry}>{feedState === "loading" || feedState === "refreshing" ? "加载中…" : "重新加载行情"}</button>
      </div>}
    </section>
  );
}

function MarketMapMarker({ id, city, name, longitude, latitude, changePct }: { id: string; city: string; name: string; longitude: number; latitude: number; changePct?: number }) {
  const projected = projectRobinsonPoint(longitude, latitude);
  const offset = mapLabelOffsets[id] ?? { x: 14, y: -18 };
  const style = {
    left: `${projected.left.toFixed(3)}%`,
    top: `${projected.top.toFixed(3)}%`,
    "--marker-label-x": `${offset.x}px`,
    "--marker-label-y": `${offset.y}px`,
  } as CSSProperties;
  const changeLabel = changePct == null ? "等待行情" : signedPercent(changePct);

  return (
    <article className={`global-map-marker ${tone(changePct)}`} style={style} title={`${city} · ${name} · ${changeLabel}`} data-map-id={id} aria-label={`${city}，${name}，${changeLabel}`}>
      <div className="global-marker-label">
        <small>{city}</small>
        <span className="global-marker-desktop-value"><strong>{compactIndexName(name)}</strong><b>{changePct == null ? "—" : changeLabel}</b></span>
        <span className="global-marker-mobile-value"><strong>{mapTickerLabels[id] ?? compactIndexName(name)}</strong><b>{changePct == null ? "—" : changeLabel}</b></span>
      </div>
    </article>
  );
}

function USMarketPanel({ quotes, fearGauge, feedState, onRetry }: { quotes: USIndexSessionQuote[]; fearGauge?: FearGaugeQuote; feedState: FeedState; onRetry: () => void }) {
  const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
  const phase = quotes[0]?.phase;
  return (
    <section id="us-indexes" className="global-region-card is-us-market" tabIndex={-1}>
      <header>
        <div><span>US</span><h3>美股核心指数</h3></div>
        <small>{phase ? `当前阶段 · ${phase}` : feedState === "loading" || feedState === "refreshing" ? "正在连接美股行情" : "美股行情暂不可用"}</small>
      </header>
      <div className="global-us-disclosure">
        <span>盘中显示现货指数；盘前、盘后使用对应 ETF，夜盘使用指数期货作为方向代理。</span>
        <b>代理值与现货指数点位口径不同</b>
      </div>
      <FearGaugeCard gauge={fearGauge} market="美股" feedState={feedState} onRetry={onRetry} />
      <div className="global-us-index-list">
        {US_INDEXES.map((definition) => {
          const quote = quoteById.get(definition.id);
          const usesProxy = quote?.phaseIsProxy ?? false;
          const spotValue = usesProxy ? quote?.closePrice : quote?.phaseValue;
          const spotChangePct = usesProxy ? quote?.cashChangePct : quote?.phaseChangePct;
          const spotLabel = usesProxy ? quote?.closeLabel : quote?.phase === "盘中" ? "现货指数" : quote?.closeLabel;
          return (
            <article key={definition.id}>
              <div className="global-us-index-head">
                <div><span className="global-country-code">{definition.code}</span><strong>{definition.name}</strong></div>
                <span className={`global-us-phase ${phaseTone(quote?.phase)}`}>{quote?.phase ?? (feedState === "loading" || feedState === "refreshing" ? "连接中" : "暂无行情")}</span>
              </div>
              <div className="global-us-stage-value">
                <div><small>{spotLabel ?? "最近现货指数"}</small><strong>{spotValue == null ? "—" : formatPrice(spotValue)}</strong></div>
                <span className={tone(spotChangePct ?? undefined)}>{spotChangePct == null ? "—" : signedPercent(spotChangePct)}</span>
              </div>
              <p>{usesProxy ? "现货指数为主口径；延长时段代理只表示方向，不比较绝对价格。" : quote?.phaseInstrument ?? (feedState === "loading" || feedState === "refreshing" ? "正在获取现货与扩展时段数据" : "本次未获取到此指数行情")}</p>
              {usesProxy ? <div className="global-us-close-row is-proxy">
                <span>方向代理 · {quote?.phaseInstrument}</span>
                <strong className={tone(quote?.phaseChangePct ?? undefined)}>{quote?.phaseChangePct == null ? "—" : signedPercent(quote.phaseChangePct)}</strong>
              </div> : quote?.phase === "盘中" ? <div className="global-us-close-row">
                <span>{quote.closeLabel}</span>
                <strong>{quote.closePrice == null ? "—" : formatPrice(quote.closePrice)}</strong>
              </div> : null}
              <small className="global-us-quote-time">{quote?.phaseUpdatedAt ? `行情时间 ${quote.phaseUpdatedAt}` : "行情时间 —"}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RegionPanel({ region, definitions, quoteById, fearGauge, feedState, onRetry }: { region: GlobalRegion; definitions: typeof GLOBAL_INDEXES; quoteById: Map<string, GlobalIndexQuote>; fearGauge?: FearGaugeQuote; feedState: FeedState; onRetry: () => void }) {
  const open = definitions.filter((definition) => quoteById.get(definition.id)?.marketStatus === "交易中").length;
  const available = definitions.filter((definition) => quoteById.has(definition.id)).length;
  const waiting = feedState === "loading" || feedState === "refreshing";
  const anchorId = region === "美洲" ? "americas-indexes" : region === "欧洲" ? "europe-indexes" : region === "亚太" ? "asia-indexes" : undefined;
  return (
    <section id={anchorId} className={`global-region-card ${region === "A股" ? "is-a-share" : ""}`} tabIndex={-1}>
      <header><div><span>{regionCode(region)}</span><h3>{region === "A股" ? "A股核心指数" : `${region}市场`}</h3></div><small>{!available ? waiting ? "正在连接行情" : "暂无可用行情" : open ? `${open} 交易中` : "当前休市"}</small></header>
      {region === "A股" ? <FearGaugeCard gauge={fearGauge} market="A股" feedState={feedState} onRetry={onRetry} /> : null}
      <div className="global-index-list">
        {definitions.map((definition) => {
          const quote = quoteById.get(definition.id);
          return (
            <article key={definition.id}>
              <div><span className="global-country-code">{definition.code}</span><strong>{definition.name}</strong><small>{definition.city} · {quote?.marketStatus ?? (waiting ? "等待行情" : "暂无行情")}</small></div>
              <div className="global-index-value"><strong>{quote ? formatPrice(quote.price) : "—"}</strong><span className={tone(quote?.changePct)}>{quote ? signedPercent(quote.changePct) : "—"}</span></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FearGaugeCard({ gauge, market, feedState, onRetry }: { gauge?: FearGaugeQuote; market: "A股" | "美股"; feedState: FeedState; onRetry: () => void }) {
  const metricName = market === "A股" ? "市场压力温度" : "恐慌指标";
  const waiting = feedState === "loading" || feedState === "refreshing";
  return (
    <article className={`global-fear-card ${market === "美股" ? "has-chart" : ""} ${fearTone(gauge?.value)}`} aria-label={`${market}${metricName}`}>
      <div className="global-fear-heading">
        <span>{gauge?.code ?? (market === "美股" ? "VIX" : "CN-PRESSURE")}</span>
        <div><strong>{gauge?.name ?? `${market}${metricName}`}</strong><small>{gauge ? gauge.official ? "官方指数 · 延时行情" : "市场压力代理 · 非交易所官方指数" : "等待指标来源与时点"}</small></div>
      </div>
      <div className="global-fear-value">
        <strong>{gauge ? gauge.value.toFixed(1) : "—"}</strong>
        <span>{gauge?.level ?? (waiting ? "连接中" : "暂不可用")}</span>
        {gauge?.changePct == null ? null : <em className={tone(gauge.changePct)}>{signedPercent(gauge.changePct)}</em>}
      </div>
      <p>{gauge?.description ?? (waiting ? "正在获取并计算最新市场压力数据。" : "本次未获取到可用压力指标，请稍后刷新行情。")}</p>
      <small>{gauge ? `${gauge.source} · ${gauge.updatedAt}` : "行情时间 —"}</small>
      {market === "A股" && gauge ? (
        <div className="global-fear-scale" aria-label={`A股市场压力温度 ${gauge.value.toFixed(1)} 分，满分 100`}>
          <div><i style={{ width: `${Math.max(0, Math.min(100, gauge.value))}%` }} /></div>
          <span>0 压力低</span><b>{gauge.value.toFixed(1)} / 100</b><span>100 压力高</span>
        </div>
      ) : null}
      {gauge ? (
        <details className="global-pressure-details">
          <summary>查看计算口径与构成 <span>{gauge.components.length} 项参考</span></summary>
        <dl className="global-pressure-components">
          <div><dt>计算公式</dt><dd>{gauge.formula}</dd></div>
          {gauge.components.map((component) => <div key={component.label}><dt>{component.label}</dt><dd>{component.value}</dd></div>)}
          <div><dt>历史分位</dt><dd>{gauge.historyPercentile == null ? "历史序列不足，暂不展示" : `${Math.round(gauge.historyPercentile * 100)}%`}</dd></div>
        </dl>
        </details>
      ) : null}
      {market === "美股" ? <FearKlineChart key={`vix-${gauge?.history.length ?? 0}`} candles={gauge?.history ?? []} feedState={feedState} onRetry={onRetry} /> : null}
    </article>
  );
}

function FearKlineChart({ candles, feedState, onRetry }: { candles: FearGaugeCandle[]; feedState: FeedState; onRetry: () => void }) {
  const [range, setRange] = useState<KlineRange>(() => rangeForLatest(candles.length, 60));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    range: KlineRange;
    pointerId: number;
    intent: KlineDragIntent;
  } | null>(null);
  const visible = useMemo(() => candles.slice(range.from, range.to + 1), [candles, range]);

  const width = 720;
  const height = 210;
  const padding = { top: 12, right: 52, bottom: 24, left: 8 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const low = visible.length ? Math.min(...visible.map((candle) => candle.low)) : 0;
  const high = visible.length ? Math.max(...visible.map((candle) => candle.high)) : 1;
  const rangePadding = Math.max((high - low) * .08, .6);
  const minimum = Math.max(0, low - rangePadding);
  const maximum = high + rangePadding;
  const step = plotWidth / Math.max(1, visible.length);
  const bodyWidth = Math.max(2.2, Math.min(8, step * .58));
  const y = (value: number) => padding.top + ((maximum - value) / Math.max(.001, maximum - minimum)) * plotHeight;
  const activeIndex = hoverIndex == null || !visible.length ? null : Math.min(visible.length - 1, hoverIndex);
  const active = activeIndex == null ? undefined : visible[activeIndex];
  const activeX = activeIndex == null ? 0 : padding.left + (activeIndex + .5) * step;
  const visibleLatest = visible.at(-1);

  return (
    <section className="global-fear-chart" aria-label="CBOE VIX 历史日 K">
      <header>
        <div><span>VIX DAILY</span><strong>恐慌指数日 K</strong></div>
        <div className="global-kline-actions">
          <div className="global-fear-periods" aria-label="VIX K线周期">
            {([20, 60, 120] as const).map((value) => {
              const active = visible.length === Math.min(value, candles.length) && range.to === candles.length - 1;
              return <button key={value} type="button" disabled={!candles.length} className={active && candles.length ? "is-active" : ""} aria-pressed={Boolean(active && candles.length)} onClick={() => { setRange(rangeForLatest(candles.length, value)); setHoverIndex(null); }}>{value}日</button>;
            })}
          </div>
          <KlineViewportControls className="is-inline is-apple is-compact" range={range} total={candles.length} minVisible={10} resetVisible={60} onRangeChange={(next) => { setRange(next); setHoverIndex(null); }} />
        </div>
      </header>
      {visible.length ? (
        <>
          <div className="global-chart-guide" id="vix-chart-guide"><span>日 K · {visible.length} 个交易日</span><p>拖动平移 · Ctrl / ⌘ + 滚轮缩放 · 悬停或轻触查看单日</p><small>键盘：← → 平移，Enter 查看单日，+ / − 缩放，0 复位，Esc 收起详情</small></div>
          <div
            className={`global-fear-chart-stage ${isDragging ? "is-dragging" : ""}`}
            tabIndex={0}
            aria-describedby="vix-chart-guide"
            aria-label={`VIX K 线交互区，当前显示 ${visible.length} 根；按住 Ctrl 或 Command 并滚轮缩放，Shift 加滚轮或横向拖动平移，双击复位`}
            style={{ touchAction: "pan-y pinch-zoom" }}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              const intent = event.pointerType === "touch" ? "pending" : "horizontal";
              dragRef.current = {
                x: event.clientX,
                y: event.clientY,
                range,
                pointerId: event.pointerId,
                intent,
              };
              if (intent === "horizontal") {
                event.currentTarget.setPointerCapture(event.pointerId);
                setIsDragging(true);
                setHoverIndex(null);
              }
            }}
            onPointerLeave={() => { if (!dragRef.current) setHoverIndex(null); }}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (dragRef.current && visible.length) {
                if (dragRef.current.pointerId !== event.pointerId) return;
                if (dragRef.current.intent === "pending") {
                  dragRef.current.intent = resolveKlineDragIntent(
                    event.clientX - dragRef.current.x,
                    event.clientY - dragRef.current.y,
                  );
                  if (dragRef.current.intent === "horizontal") {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setIsDragging(true);
                    setHoverIndex(null);
                  }
                }
                if (dragRef.current.intent !== "horizontal") return;
                const candleWidth = (bounds.width * (plotWidth / width)) / visible.length;
                const delta = Math.round((dragRef.current.x - event.clientX) / Math.max(candleWidth, 1));
                setRange(panKlineRange(dragRef.current.range, candles.length, delta));
                return;
              }
              const pointerX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
              setHoverIndex(plotIndexFromPointer({
                pointerX,
                containerWidth: bounds.width,
                viewBoxWidth: width,
                plotLeft: padding.left,
                plotWidth,
                pointCount: visible.length,
              }));
            }}
            onPointerUp={(event) => {
              const gesture = dragRef.current;
              dragRef.current = null;
              setIsDragging(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              if (gesture?.intent === "pending") {
                const bounds = event.currentTarget.getBoundingClientRect();
                const pointerX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
                setHoverIndex(plotIndexFromPointer({
                  pointerX,
                  containerWidth: bounds.width,
                  viewBoxWidth: width,
                  plotLeft: padding.left,
                  plotWidth,
                  pointCount: visible.length,
                }));
              }
            }}
            onPointerCancel={() => { dragRef.current = null; setIsDragging(false); }}
            onLostPointerCapture={() => { dragRef.current = null; setIsDragging(false); }}
            onWheel={(event) => {
              const wheelIntent = getKlineWheelIntent(event);
              if (wheelIntent === "page") return;
              event.preventDefault();
              const wheelDelta = wheelIntent === "pan" && Math.abs(event.deltaX) > Math.abs(event.deltaY)
                ? event.deltaX
                : event.deltaY;
              const delta = normalizeWheelDelta(wheelDelta, event.deltaMode, height);
              if (wheelIntent === "pan") {
                const candleDelta = wheelDeltaToKlinePan(delta, visible.length);
                if (candleDelta) setRange(panKlineRange(range, candles.length, candleDelta));
                setHoverIndex(null);
                return;
              }
              const bounds = event.currentTarget.getBoundingClientRect();
              const pointerX = (event.clientX - bounds.left) * (width / Math.max(bounds.width, 1));
              setRange(zoomKlineRange({
                range,
                total: candles.length,
                deltaY: delta,
                anchorRatio: (pointerX - padding.left) / Math.max(plotWidth, 1),
                minVisible: 10,
              }));
              setHoverIndex(null);
            }}
            onDoubleClick={() => { setRange(rangeForLatest(candles.length, 60)); setHoverIndex(null); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setHoverIndex(null);
              } else if (event.key === "Enter") {
                event.preventDefault();
                setHoverIndex((current) => current == null ? visible.length - 1 : null);
              } else if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                setRange(zoomKlineRange({ range, total: candles.length, deltaY: -120, anchorRatio: 1, minVisible: 10 }));
                setHoverIndex(null);
              } else if (event.key === "-") {
                event.preventDefault();
                setRange(zoomKlineRange({ range, total: candles.length, deltaY: 120, anchorRatio: 1, minVisible: 10 }));
                setHoverIndex(null);
              } else if (event.key === "0") {
                event.preventDefault();
                setRange(rangeForLatest(candles.length, 60));
                setHoverIndex(null);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const direction = event.key === "ArrowRight" ? 1 : -1;
                if (hoverIndex != null) setHoverIndex(Math.max(0, Math.min(visible.length - 1, hoverIndex + direction)));
                else setRange(panKlineRange(range, candles.length, direction * Math.max(1, Math.round(visible.length * .1))));
              }
            }}
          >
            <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`VIX 最近 ${visible.length} 个交易日日 K`}>
              {[0, .5, 1].map((position) => {
                const gridY = padding.top + position * plotHeight;
                const label = maximum - position * (maximum - minimum);
                return (
                  <g key={position}>
                    <line className="fear-grid-line" x1={padding.left} x2={width - padding.right} y1={gridY} y2={gridY} />
                    <text className="fear-axis-label" x={width - 4} y={gridY + 3} textAnchor="end">{label.toFixed(1)}</text>
                  </g>
                );
              })}
              {[.25, .5, .75].map((position) => (
                <line className="fear-grid-line is-vertical" key={`x-${position}`} x1={padding.left + plotWidth * position} x2={padding.left + plotWidth * position} y1={padding.top} y2={height - padding.bottom} />
              ))}
              {visibleLatest ? (
                <g className="kline-last-price">
                  <line x1={padding.left} x2={width - padding.right} y1={y(visibleLatest.close)} y2={y(visibleLatest.close)} />
                  <text x={width - padding.right + 6} y={y(visibleLatest.close) + 3}>{visibleLatest.close.toFixed(1)}</text>
                </g>
              ) : null}
              {visible.map((candle, index) => {
                const x = padding.left + (index + .5) * step;
                const openY = y(candle.open);
                const closeY = y(candle.close);
                const rising = candle.close >= candle.open;
                return (
                  <g className={rising ? "is-up" : "is-down"} key={candle.date}>
                    <line className="fear-candle-wick" x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} />
                    <rect className="fear-candle-body" x={x - bodyWidth / 2} y={Math.min(openY, closeY)} width={bodyWidth} height={Math.max(1.5, Math.abs(closeY - openY))} rx={1} />
                  </g>
                );
              })}
              {active ? (
                <g>
                  <line className="fear-crosshair" x1={activeX} x2={activeX} y1={padding.top} y2={height - padding.bottom} />
                  <line className="fear-crosshair is-horizontal" x1={padding.left} x2={width - padding.right} y1={y(active.close)} y2={y(active.close)} />
                </g>
              ) : null}
            </svg>
            {active ? (
              <div
                className={`global-fear-tooltip ${activeX < width / 2 ? "is-edge-end" : "is-edge-start"}`}
                style={activeX < width / 2 ? { right: 10 } : { left: 10 }}
              >
                <strong>{active.date}</strong>
                <span>开 {active.open.toFixed(2)}</span><span>高 {active.high.toFixed(2)}</span>
                <span>低 {active.low.toFixed(2)}</span><span>收 {active.close.toFixed(2)}</span>
              </div>
            ) : null}
          </div>
          <footer><span>{visible[0]?.date ?? "—"}</span><small>CBOE 官方日线 · 延时行情</small><span>{visible.at(-1)?.date ?? "—"}</span></footer>
        </>
      ) : <div className="global-fear-chart-empty" role="status">
        {feedState === "loading" || feedState === "refreshing" ? <span className="loading-spinner" aria-hidden="true" /> : null}
        <strong>{feedState === "loading" || feedState === "refreshing" ? "正在加载 CBOE VIX 历史日线" : feedState === "error" ? "VIX 历史行情暂时无法加载" : "暂无可用的 VIX 历史日线"}</strong>
        <p>历史日线准备就绪后会显示在这里；上方指标与现货指数独立展示。</p>
        <button type="button" disabled={feedState === "loading" || feedState === "refreshing"} onClick={onRetry}>{feedState === "loading" || feedState === "refreshing" ? "加载中…" : "重新加载行情"}</button>
      </div>}
    </section>
  );
}

function feedLabel(state: FeedState) { return state === "loading" ? "连接中" : state === "refreshing" ? "刷新中" : state === "error" ? "自动重试" : "实时行情"; }
function regionCode(region: GlobalRegion) { return region === "美洲" ? "AMER" : region === "欧洲" ? "EMEA" : region === "亚太" ? "APAC" : "CN-A"; }
function phaseTone(phase: USMarketPhase | undefined) { return phase === "盘中" ? "is-regular" : phase === "盘前" ? "is-pre" : phase === "盘后" ? "is-post" : phase === "夜盘" ? "is-night" : "is-closed"; }
function fearTone(value: number | undefined) { return (value ?? 0) >= 40 ? "is-high" : (value ?? 0) >= 30 ? "is-watch" : "is-calm"; }
function tone(value: number | undefined) { return (value ?? 0) > 0 ? "is-up" : (value ?? 0) < 0 ? "is-down" : "is-flat"; }
function signedPercent(value: number) { return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }
function volumeState(value: number) { return value > 5 ? "放量" : value < -5 ? "缩量" : "量能平稳"; }
function volumeStateTone(value: string | undefined) { return value === "放量" ? "is-volume-up" : value === "缩量" ? "is-volume-down" : "is-flat"; }
function compactIndexName(value: string) { return value.replace("加拿大 ", "").replace("澳大利亚 ", "").replace("巴西 ", "").replace("英国", "").replace("德国 ", "").replace("法国 ", "").replace("印度 ", ""); }
function formatPrice(value: number) { return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: value >= 10_000 ? 0 : 2, maximumFractionDigits: 2 }).format(value); }
function formatAmountHundredMillion(value: number) { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value / 100_000_000); }
function formatFetchedAt(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "刚刚" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }
