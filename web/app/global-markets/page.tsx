"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import KlineViewportControls from "../components/KlineViewportControls";
import SiteBanner from "../components/SiteBanner";
import { plotIndexFromPointer } from "../lib/chartInteraction";
import { analyzeShanghaiIndexHistory, GLOBAL_INDEXES, type FearGaugeCandle, type FearGaugeQuote, type GlobalIndexFeed, type GlobalIndexQuote, type GlobalRegion, type ShanghaiIndexCandle } from "../lib/globalIndexes";
import { normalizeWheelDelta, panKlineRange, rangeForLatest, zoomKlineRange, type KlineRange } from "../lib/klineViewport";
import { projectRobinsonPoint } from "../lib/robinsonProjection";
import { US_INDEXES, type USIndexSessionQuote, type USMarketPhase } from "../lib/usMarketIndexes";
import "./global-markets.css";

type FeedState = "loading" | "live" | "refreshing" | "error";
type Appearance = "light" | "dark";

const appearanceStorageKey = "ticklens.appearance.v1";
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

export default function GlobalMarketsPage() {
  const [quotes, setQuotes] = useState<GlobalIndexQuote[]>([]);
  const [usQuotes, setUSQuotes] = useState<USIndexSessionQuote[]>([]);
  const [fearGauges, setFearGauges] = useState<FearGaugeQuote[]>([]);
  const [shanghaiHistory, setShanghaiHistory] = useState<ShanghaiIndexCandle[]>([]);
  const [feedState, setFeedState] = useState<FeedState>("loading");
  const [fetchedAt, setFetchedAt] = useState("");
  const [error, setError] = useState("");
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [preservedStock, setPreservedStock] = useState("");
  const requestRef = useRef<AbortController | null>(null);

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
      let next: Appearance = "light";
      try {
        next = localStorage.getItem(appearanceStorageKey) === "dark" ? "dark" : "light";
      } catch { /* Appearance remains available for the current page. */ }
      setAppearance(next);
      document.documentElement.dataset.appearance = next;
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
  const rising = marketMoves.filter((quote) => quote.changePct > 0).length;
  const falling = marketMoves.filter((quote) => quote.changePct < 0).length;
  const openMarkets = quotes.filter((quote) => quote.marketStatus === "交易中").length + (usQuotes[0]?.phase === "盘中" ? 1 : 0);
  const leader = [...marketMoves].sort((left, right) => Math.abs(right.changePct) - Math.abs(left.changePct))[0];
  const shanghaiQuote = quoteById.get("shanghai");
  const usFearGauge = fearGaugeByMarket.get("美股");
  const breadthTotal = rising + falling;
  const breadthPct = breadthTotal ? Math.round((rising / breadthTotal) * 100) : 0;
  const mappedMarketCount = GLOBAL_INDEXES.filter((item) => item.map).length + US_INDEXES.filter((item) => item.map).length;

  const toggleAppearance = () => {
    const next: Appearance = appearance === "light" ? "dark" : "light";
    setAppearance(next);
    document.documentElement.dataset.appearance = next;
    try { localStorage.setItem(appearanceStorageKey, next); } catch { /* Preference remains in memory. */ }
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
        <section className="sidebar-menu-summary global-sidebar-summary" aria-label="全球市场汇总">
          <span>全球市场</span>
          <strong>{openMarkets ? "实时交易中" : "主要市场休市"}</strong>
          <small>{rising} 涨 · {falling} 跌 · {openMarkets} 个市场交易中</small>
          <div className="sidebar-snapshot-grid global-sidebar-snapshot" aria-label="全球股指实时汇总">
            <div className="sidebar-snapshot-primary">
              <span>市场广度</span>
              <strong>{breadthTotal ? `${breadthPct}%` : "—"}</strong>
              <em className={breadthPct >= 55 ? "is-up" : breadthPct <= 45 ? "is-down" : "is-flat"}>{breadthTotal ? `${rising} 涨 / ${falling} 跌` : "等待行情"}</em>
            </div>
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
            <div>
              <span>波动焦点</span>
              <strong>{leader ? signedPercent(leader.changePct) : "—"}</strong>
              <em className={tone(leader?.changePct)}>{leader?.name ?? "等待数据"}</em>
            </div>
          </div>
          <button className="global-sidebar-refresh" type="button" disabled={feedState === "refreshing"} onClick={() => void refresh()}>{feedState === "refreshing" ? "刷新中…" : "刷新行情"}</button>
        </section>
        <nav className="workspace-nav global-workspace-nav" aria-label="全球股指快速导航">
          <a href="#global-overview"><span>市场概览</span><small>Overview</small></a>
          <a href="#a-share-indexes"><span>A股核心</span><small>A Share</small></a>
          <a href="#shanghai-index"><span>上证指数</span><small>Shanghai</small></a>
          <a href="#global-map"><span>全球地图</span><small>Map</small></a>
          <a href="#us-indexes"><span>美股</span><small>US</small></a>
          <a href="#americas-indexes"><span>美洲</span><small>Americas</small></a>
          <a href="#europe-indexes"><span>欧洲</span><small>Europe</small></a>
          <a href="#asia-indexes"><span>亚太</span><small>Asia</small></a>
        </nav>
      </aside>

      <div className="app-workspace-shell global-main">
        {error ? <div className="global-error" role="status"><strong>行情连接提示</strong><span>{error}，页面将在下一个刷新周期自动重试。</span></div> : null}

        <section id="global-overview" className="global-summary" aria-label="全球市场概览">
          <article><span>覆盖指数</span><strong>{quotes.length + usQuotes.length || GLOBAL_INDEXES.length + US_INDEXES.length}</strong><small>美股 · A股 · 美洲 · 欧洲 · 亚太</small></article>
          <article><span>上涨 / 下跌</span><strong><em className="is-up">{rising}</em><b>/</b><em className="is-down">{falling}</em></strong><small>按最新涨跌幅统计</small></article>
          <article><span>交易中市场</span><strong>{openMarkets}</strong><small>依据各交易所当地时段</small></article>
          <article><span>波动焦点</span><strong className={tone(leader?.changePct)}>{leader ? signedPercent(leader.changePct) : "—"}</strong><small>{leader?.name ?? "等待实时数据"}</small></article>
        </section>

        <section id="a-share-indexes" className="global-a-share-board" aria-label="A股核心指数行情">
          <RegionPanel region="A股" definitions={GLOBAL_INDEXES.filter((item) => item.region === "A股")} quoteById={quoteById} fearGauge={fearGaugeByMarket.get("A股")} />
        </section>

        <ShanghaiIndexPanel key={`shanghai-${shanghaiHistory.length}`} candles={shanghaiHistory} />

        <section id="global-map" className="global-map-card" aria-label="全球主要股指地图">
          <header>
            <div><p>MARKET REGIONS</p><h2>全球主要市场板块</h2></div>
            <div className="global-map-header-meta">
              <span className="global-map-count">{mappedMarketCount} 个市场数值框</span>
              <div className="global-legend"><span className="is-up">上涨</span><span className="is-down">下跌</span><span>平盘</span></div>
            </div>
          </header>
          <div className="global-map-stage">
            <div className="global-map-viewport">
              {/* The land silhouette and every market use the exact same Robinson viewBox. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="global-map-land" src="/world-map-robinson.svg" alt="" aria-hidden="true" />
              {GLOBAL_INDEXES.filter((item) => item.map).map((definition) => {
                const quote = quoteById.get(definition.id);
                const map = definition.map!;
                return (
                  <MarketMapMarker
                    key={definition.id}
                    id={definition.id}
                    city={definition.city}
                    name={definition.name}
                    longitude={map.longitude}
                    latitude={map.latitude}
                    changePct={quote?.changePct}
                  />
                );
              })}
              {US_INDEXES.filter((item) => item.map).map((definition) => {
                const quote = usQuoteById.get(definition.id);
                const map = definition.map!;
                return (
                  <MarketMapMarker
                    key={definition.id}
                    id={definition.id}
                    city="纽约"
                    name={definition.name}
                    longitude={map.longitude}
                    latitude={map.latitude}
                    changePct={quote?.cashChangePct ?? undefined}
                  />
                );
              })}
            </div>
          </div>
          <footer><span>数值框边缘贴近交易所坐标，位置采用 Robinson 投影并仅做防重叠避让</span><span>红涨绿跌 · 行情每 10 秒刷新</span></footer>
        </section>

        <section className="global-region-board" aria-label="全球指数行情列表">
          <USMarketPanel quotes={usQuotes} fearGauge={fearGaugeByMarket.get("美股")} />
          {(["美洲", "欧洲", "亚太"] as GlobalRegion[]).map((region) => (
            <RegionPanel key={region} region={region} definitions={GLOBAL_INDEXES.filter((item) => item.region === region)} quoteById={quoteById} />
          ))}
        </section>
      </div>
      </main>
    </div>
  );
}

function ShanghaiIndexPanel({ candles }: { candles: ShanghaiIndexCandle[] }) {
  const [range, setRange] = useState<KlineRange>(() => rangeForLatest(candles.length, 60));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ x: number; range: KlineRange } | null>(null);
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
    <section id="shanghai-index" className="global-shanghai-panel" aria-label="上证指数日K与沪深两市成交额">
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
              return <button key={value} type="button" className={active ? "is-active" : ""} aria-pressed={active} onClick={() => { setRange(rangeForLatest(candles.length, value)); setHoverIndex(null); }}>{value}日</button>;
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
          <div
            className={`global-shanghai-chart-stage ${isDragging ? "is-dragging" : ""}`}
            tabIndex={0}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { x: event.clientX, range };
              setIsDragging(true);
              setHoverIndex(null);
            }}
            onPointerLeave={() => { if (!dragRef.current) setHoverIndex(null); }}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (dragRef.current && visible.length) {
                const candleWidth = (bounds.width * (plotWidth / width)) / visible.length;
                const delta = Math.round((dragRef.current.x - event.clientX) / Math.max(candleWidth, 1));
                setRange(panKlineRange(dragRef.current.range, candles.length, delta));
                return;
              }
              const pointerX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
              setHoverIndex(plotIndexFromPointer({ pointerX, containerWidth: bounds.width, viewBoxWidth: width, plotLeft: padding.left, plotWidth, pointCount: visible.length }));
            }}
            onPointerUp={(event) => {
              dragRef.current = null;
              setIsDragging(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { dragRef.current = null; setIsDragging(false); }}
            onLostPointerCapture={() => { dragRef.current = null; setIsDragging(false); }}
            onWheel={(event) => {
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              const pointerX = (event.clientX - bounds.left) * (width / Math.max(bounds.width, 1));
              setRange(zoomKlineRange({
                range,
                total: candles.length,
                deltaY: normalizeWheelDelta(event.deltaY, event.deltaMode, height),
                anchorRatio: (pointerX - padding.left) / Math.max(plotWidth, 1),
                minVisible: 12,
              }));
              setHoverIndex(null);
            }}
            onDoubleClick={() => { setRange(rangeForLatest(candles.length, 60)); setHoverIndex(null); }}
            onKeyDown={(event) => {
              if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                setRange(zoomKlineRange({ range, total: candles.length, deltaY: -120, anchorRatio: 1, minVisible: 12 }));
              } else if (event.key === "-") {
                event.preventDefault();
                setRange(zoomKlineRange({ range, total: candles.length, deltaY: 120, anchorRatio: 1, minVisible: 12 }));
              } else if (event.key === "0") {
                event.preventDefault();
                setRange(rangeForLatest(candles.length, 60));
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
              <text className="shanghai-chart-section-label" x={padding.left} y={amountTop - 22}>沪深两市成交额 · 较前日超过 ±5%：实心放量 / 斜纹缩量 / 虚线20日均额</text>
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
      ) : <div className="global-shanghai-chart-empty"><span className="loading-spinner" />正在加载上证指数历史日线与沪深两市成交额…</div>}
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
        <span><strong>{compactIndexName(name)}</strong><b>{changePct == null ? "—" : changeLabel}</b></span>
      </div>
    </article>
  );
}

function USMarketPanel({ quotes, fearGauge }: { quotes: USIndexSessionQuote[]; fearGauge?: FearGaugeQuote }) {
  const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
  const phase = quotes[0]?.phase;
  return (
    <section id="us-indexes" className="global-region-card is-us-market">
      <header>
        <div><span>US</span><h3>美股核心指数</h3></div>
        <small>{phase ? `当前阶段 · ${phase}` : "等待美股行情"}</small>
      </header>
      <div className="global-us-disclosure">
        <span>盘中显示现货指数；盘前、盘后使用对应 ETF，夜盘使用指数期货作为方向代理。</span>
        <b>代理值与现货指数点位口径不同</b>
      </div>
      <FearGaugeCard gauge={fearGauge} market="美股" />
      <div className="global-us-index-list">
        {US_INDEXES.map((definition) => {
          const quote = quoteById.get(definition.id);
          return (
            <article key={definition.id}>
              <div className="global-us-index-head">
                <div><span className="global-country-code">{definition.code}</span><strong>{definition.name}</strong></div>
                <span className={`global-us-phase ${phaseTone(quote?.phase)}`}>{quote?.phase ?? "连接中"}</span>
              </div>
              <div className="global-us-stage-value">
                <div><small>当前阶段值</small><strong>{quote?.phaseValue == null ? "—" : formatPrice(quote.phaseValue)}</strong></div>
                <span className={tone(quote?.phaseChangePct ?? undefined)}>{quote?.phaseChangePct == null ? "—" : signedPercent(quote.phaseChangePct)}</span>
              </div>
              <p>{quote?.phaseInstrument ?? "正在获取现货与扩展时段数据"}</p>
              <div className="global-us-close-row">
                <span>{quote?.closeLabel ?? "现货收盘指数"}</span>
                <strong>{quote?.closePrice == null ? "—" : formatPrice(quote.closePrice)}</strong>
              </div>
              <small className="global-us-quote-time">{quote?.phaseUpdatedAt ? `行情时间 ${quote.phaseUpdatedAt}` : "行情时间 —"}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RegionPanel({ region, definitions, quoteById, fearGauge }: { region: GlobalRegion; definitions: typeof GLOBAL_INDEXES; quoteById: Map<string, GlobalIndexQuote>; fearGauge?: FearGaugeQuote }) {
  const open = definitions.filter((definition) => quoteById.get(definition.id)?.marketStatus === "交易中").length;
  const anchorId = region === "美洲" ? "americas-indexes" : region === "欧洲" ? "europe-indexes" : region === "亚太" ? "asia-indexes" : undefined;
  return (
    <section id={anchorId} className={`global-region-card ${region === "A股" ? "is-a-share" : ""}`}>
      <header><div><span>{regionCode(region)}</span><h3>{region === "A股" ? "A股核心指数" : `${region}市场`}</h3></div><small>{open ? `${open} 交易中` : "当前休市"}</small></header>
      {region === "A股" ? <FearGaugeCard gauge={fearGauge} market="A股" /> : null}
      <div className="global-index-list">
        {definitions.map((definition) => {
          const quote = quoteById.get(definition.id);
          return (
            <article key={definition.id}>
              <div><span className="global-country-code">{definition.code}</span><strong>{definition.name}</strong><small>{definition.city} · {quote?.marketStatus ?? "等待行情"}</small></div>
              <div className="global-index-value"><strong>{quote ? formatPrice(quote.price) : "—"}</strong><span className={tone(quote?.changePct)}>{quote ? signedPercent(quote.changePct) : "—"}</span></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FearGaugeCard({ gauge, market }: { gauge?: FearGaugeQuote; market: "A股" | "美股" }) {
  return (
    <article className={`global-fear-card ${market === "美股" ? "has-chart" : ""} ${fearTone(gauge?.value)}`} aria-label={`${market}恐慌指标`}>
      <div className="global-fear-heading">
        <span>{gauge?.code ?? (market === "美股" ? "VIX" : "CN-FEAR")}</span>
        <div><strong>{gauge?.name ?? `${market}恐慌指标`}</strong><small>{gauge?.official ? "官方指数 · 延时行情" : "市场压力代理 · 非交易所官方指数"}</small></div>
      </div>
      <div className="global-fear-value">
        <strong>{gauge ? gauge.value.toFixed(1) : "—"}</strong>
        <span>{gauge?.level ?? "连接中"}</span>
        {gauge?.changePct == null ? null : <em className={tone(gauge.changePct)}>{signedPercent(gauge.changePct)}</em>}
      </div>
      <p>{gauge?.description ?? "正在获取并计算最新市场压力数据。"}</p>
      <small>{gauge ? `${gauge.source} · ${gauge.updatedAt}` : "行情时间 —"}</small>
      {market === "A股" && gauge ? (
        <div className="global-fear-scale" aria-label={`A股恐慌指数 ${gauge.value.toFixed(1)} 分，满分 100`}>
          <div><i style={{ width: `${Math.max(0, Math.min(100, gauge.value))}%` }} /></div>
          <span>0 平静</span><b>{gauge.value.toFixed(1)} / 100</b><span>100 恐慌</span>
        </div>
      ) : null}
      {market === "美股" ? <FearKlineChart key={`vix-${gauge?.history.length ?? 0}`} candles={gauge?.history ?? []} /> : null}
    </article>
  );
}

function FearKlineChart({ candles }: { candles: FearGaugeCandle[] }) {
  const [range, setRange] = useState<KlineRange>(() => rangeForLatest(candles.length, 60));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ x: number; range: KlineRange } | null>(null);
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
              return <button key={value} type="button" className={active ? "is-active" : ""} aria-pressed={active} onClick={() => { setRange(rangeForLatest(candles.length, value)); setHoverIndex(null); }}>{value}日</button>;
            })}
          </div>
          <KlineViewportControls className="is-inline is-apple is-compact" range={range} total={candles.length} minVisible={10} resetVisible={60} onRangeChange={(next) => { setRange(next); setHoverIndex(null); }} />
        </div>
      </header>
      {visible.length ? (
        <>
          <div
            className={`global-fear-chart-stage ${isDragging ? "is-dragging" : ""}`}
            tabIndex={0}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { x: event.clientX, range };
              setIsDragging(true);
              setHoverIndex(null);
            }}
            onPointerLeave={() => { if (!dragRef.current) setHoverIndex(null); }}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (dragRef.current && visible.length) {
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
              dragRef.current = null;
              setIsDragging(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { dragRef.current = null; setIsDragging(false); }}
            onLostPointerCapture={() => { dragRef.current = null; setIsDragging(false); }}
            onWheel={(event) => {
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              const pointerX = (event.clientX - bounds.left) * (width / Math.max(bounds.width, 1));
              setRange(zoomKlineRange({
                range,
                total: candles.length,
                deltaY: normalizeWheelDelta(event.deltaY, event.deltaMode, height),
                anchorRatio: (pointerX - padding.left) / Math.max(plotWidth, 1),
                minVisible: 10,
              }));
              setHoverIndex(null);
            }}
            onDoubleClick={() => { setRange(rangeForLatest(candles.length, 60)); setHoverIndex(null); }}
            onKeyDown={(event) => {
              if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                setRange(zoomKlineRange({ range, total: candles.length, deltaY: -120, anchorRatio: 1, minVisible: 10 }));
              } else if (event.key === "-") {
                event.preventDefault();
                setRange(zoomKlineRange({ range, total: candles.length, deltaY: 120, anchorRatio: 1, minVisible: 10 }));
              } else if (event.key === "0") {
                event.preventDefault();
                setRange(rangeForLatest(candles.length, 60));
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
      ) : <div className="global-fear-chart-empty"><span className="loading-spinner" />正在加载 CBOE VIX 历史日线…</div>}
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
