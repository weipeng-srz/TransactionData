"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import MarketScopeSwitch from "../components/MarketScopeSwitch";
import { plotIndexFromPointer } from "../lib/chartInteraction";
import { GLOBAL_INDEXES, type FearGaugeCandle, type FearGaugeQuote, type GlobalIndexFeed, type GlobalIndexQuote, type GlobalRegion } from "../lib/globalIndexes";
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
  const mappedMarketCount = GLOBAL_INDEXES.filter((item) => item.map).length + US_INDEXES.filter((item) => item.map).length;

  const toggleAppearance = () => {
    const next: Appearance = appearance === "light" ? "dark" : "light";
    setAppearance(next);
    document.documentElement.dataset.appearance = next;
    try { localStorage.setItem(appearanceStorageKey, next); } catch { /* Preference remains in memory. */ }
  };

  return (
    <main className="app-shell global-page-shell">
      <aside className="app-sidebar global-sidebar">
        <Link className="sidebar-brand global-brand" href={preservedStock ? `/?stock=${preservedStock}` : "/"} aria-label="返回 TrendSight 市场研究">
          <div className="brand-mark" aria-hidden="true" /><div><strong>TrendSight</strong><span>市场研究工作台</span></div>
        </Link>
        <div className="sidebar-scope">
          <MarketScopeSwitch scope="global" stockCode={preservedStock} />
        </div>
        <section className="sidebar-current global-sidebar-current" aria-label="全球市场状态">
          <span>全球市场</span>
          <strong>{openMarkets ? "实时交易中" : "主要市场休市"}</strong>
          <small>行情每 10 秒自动刷新</small>
          <b>{openMarkets}</b>
          <em className={openMarkets ? "is-open" : ""}>{openMarkets ? "个市场交易中" : "等待下一交易时段"}</em>
        </section>
        <nav className="workspace-nav global-workspace-nav" aria-label="工作台页面导航">
          <Link href={preservedStock ? `/?stock=${preservedStock}` : "/"}><span>个股研究</span><small>Research</small></Link>
          <Link className="is-active" href={preservedStock ? `/global-markets?stock=${preservedStock}` : "/global-markets"} aria-current="page"><span>全球股指</span><small>Global</small></Link>
        </nav>
        <p className="sidebar-footnote global-sidebar-footnote">指数、扩展时段代理和压力指标仅供市场研究，不构成投资建议。</p>
      </aside>

      <div className="app-workspace-shell global-main">
        <header className="topbar global-topbar">
          <div className="workspace-heading"><div><p className="eyebrow">GLOBAL MARKET</p><h1>全球股指</h1></div></div>
          <div className="topbar-actions global-topbar-actions">
            <span className={`topbar-sync global-feed-state is-${feedState}`}><i />{feedLabel(feedState)}</span>
            <time dateTime={fetchedAt}>{fetchedAt ? `更新 ${formatFetchedAt(fetchedAt)}` : "正在连接全球行情"}</time>
            <button className="global-refresh-button" type="button" disabled={feedState === "refreshing"} onClick={() => void refresh()}>{feedState === "refreshing" ? "刷新中…" : "立即刷新"}</button>
            <button className="appearance-toggle" type="button" onClick={toggleAppearance} aria-label={`切换到${appearance === "light" ? "深色" : "浅色"}外观`} title={`切换到${appearance === "light" ? "深色" : "浅色"}外观`}><span aria-hidden="true">{appearance === "light" ? "◐" : "☀"}</span></button>
          </div>
        </header>

        {error ? <div className="global-error" role="status"><strong>行情连接提示</strong><span>{error}，页面将在下一个刷新周期自动重试。</span></div> : null}

        <section className="global-summary" aria-label="全球市场概览">
          <article><span>覆盖指数</span><strong>{quotes.length + usQuotes.length || GLOBAL_INDEXES.length + US_INDEXES.length}</strong><small>美股 · A股 · 美洲 · 欧洲 · 亚太</small></article>
          <article><span>上涨 / 下跌</span><strong><em className="is-up">{rising}</em><b>/</b><em className="is-down">{falling}</em></strong><small>按最新涨跌幅统计</small></article>
          <article><span>交易中市场</span><strong>{openMarkets}</strong><small>依据各交易所当地时段</small></article>
          <article><span>波动焦点</span><strong className={tone(leader?.changePct)}>{leader ? signedPercent(leader.changePct) : "—"}</strong><small>{leader?.name ?? "等待实时数据"}</small></article>
        </section>

        <section className="global-a-share-board" aria-label="A股核心指数行情">
          <RegionPanel region="A股" definitions={GLOBAL_INDEXES.filter((item) => item.region === "A股")} quoteById={quoteById} fearGauge={fearGaugeByMarket.get("A股")} />
        </section>

        <section className="global-map-card" aria-label="全球主要股指地图">
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
    <section className="global-region-card is-us-market">
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
  return (
    <section className={`global-region-card ${region === "A股" ? "is-a-share" : ""}`}>
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
      {market === "美股" ? <FearKlineChart candles={gauge?.history ?? []} /> : null}
    </article>
  );
}

function FearKlineChart({ candles }: { candles: FearGaugeCandle[] }) {
  const [period, setPeriod] = useState<20 | 60 | 120>(60);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const visible = useMemo(() => candles.slice(-period), [candles, period]);
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
  const activeIndex = hoverIndex == null ? Math.max(0, visible.length - 1) : Math.min(visible.length - 1, hoverIndex);
  const active = visible[activeIndex];
  const activeX = padding.left + (activeIndex + .5) * step;

  return (
    <section className="global-fear-chart" aria-label="CBOE VIX 历史日 K">
      <header>
        <div><span>VIX DAILY</span><strong>恐慌指数日 K</strong></div>
        <div className="global-fear-periods" aria-label="VIX K线周期">
          {([20, 60, 120] as const).map((value) => (
            <button key={value} type="button" className={period === value ? "is-active" : ""} aria-pressed={period === value} onClick={() => { setPeriod(value); setHoverIndex(null); }}>{value}日</button>
          ))}
        </div>
      </header>
      {visible.length ? (
        <>
          <div
            className="global-fear-chart-stage"
            onPointerLeave={() => setHoverIndex(null)}
            onPointerMove={(event) => {
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
                  <circle className="fear-crosshair-point" cx={activeX} cy={y(active.close)} r={3.2} />
                </g>
              ) : null}
            </svg>
            {active ? (
              <div className="global-fear-tooltip" style={{ left: `${Math.max(16, Math.min(84, (activeX / width) * 100))}%` }}>
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
function compactIndexName(value: string) { return value.replace("加拿大 ", "").replace("澳大利亚 ", "").replace("巴西 ", "").replace("英国", "").replace("德国 ", "").replace("法国 ", "").replace("印度 ", ""); }
function formatPrice(value: number) { return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: value >= 10_000 ? 0 : 2, maximumFractionDigits: 2 }).format(value); }
function formatFetchedAt(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "刚刚" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }
