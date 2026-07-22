"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { GLOBAL_INDEXES, type GlobalIndexFeed, type GlobalIndexQuote, type GlobalRegion } from "../lib/globalIndexes";
import { US_INDEXES, type USIndexSessionQuote, type USMarketPhase } from "../lib/usMarketIndexes";
import "./global-markets.css";

type FeedState = "loading" | "live" | "refreshing" | "error";

export default function GlobalMarketsPage() {
  const [quotes, setQuotes] = useState<GlobalIndexQuote[]>([]);
  const [usQuotes, setUSQuotes] = useState<USIndexSessionQuote[]>([]);
  const [feedState, setFeedState] = useState<FeedState>("loading");
  const [fetchedAt, setFetchedAt] = useState("");
  const [error, setError] = useState("");
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
  const marketMoves = [
    ...quotes.map((quote) => ({ name: quote.name, changePct: quote.changePct })),
    ...usQuotes.flatMap((quote) => quote.cashChangePct == null ? [] : [{ name: quote.name, changePct: quote.cashChangePct }]),
  ];
  const rising = marketMoves.filter((quote) => quote.changePct > 0).length;
  const falling = marketMoves.filter((quote) => quote.changePct < 0).length;
  const openMarkets = quotes.filter((quote) => quote.marketStatus === "交易中").length + (usQuotes[0]?.phase === "盘中" ? 1 : 0);
  const leader = [...marketMoves].sort((left, right) => Math.abs(right.changePct) - Math.abs(left.changePct))[0];

  return (
    <main className="global-page-shell">
      <aside className="global-sidebar">
        <Link className="global-brand" href="/" aria-label="返回 TickLens 市场研究">
          <span>TL</span><div><strong>TickLens</strong><small>GLOBAL PULSE</small></div>
        </Link>
        <nav aria-label="全球市场页面导航">
          <Link href="/"><i>01</i><span>个股研究<small>Research</small></span></Link>
          <Link className="is-active" href="/global-markets" aria-current="page"><i>02</i><span>全球股指<small>Global Indices</small></span></Link>
        </nav>
        <div className="global-sidebar-foot">
          <span className={openMarkets ? "is-live" : ""}><i />{openMarkets ? `${openMarkets} 个市场交易中` : "主要市场已休市"}</span>
          <small>行情每 10 秒自动刷新</small>
        </div>
      </aside>

      <div className="global-main">
        <header className="global-topbar">
          <div><p>GLOBAL MARKET COMMAND CENTER</p><h1>全球股指脉动</h1></div>
          <div className="global-topbar-actions">
            <span className={`global-feed-state is-${feedState}`}><i />{feedLabel(feedState)}</span>
            <time dateTime={fetchedAt}>{fetchedAt ? `更新于 ${formatFetchedAt(fetchedAt)}` : "正在连接全球行情"}</time>
            <button type="button" disabled={feedState === "refreshing"} onClick={() => void refresh()}>{feedState === "refreshing" ? "刷新中…" : "立即刷新"}</button>
          </div>
        </header>

        {error ? <div className="global-error" role="status"><strong>行情连接提示</strong><span>{error}，页面将在下一个刷新周期自动重试。</span></div> : null}

        <section className="global-summary" aria-label="全球市场概览">
          <article><span>覆盖指数</span><strong>{quotes.length + usQuotes.length || GLOBAL_INDEXES.length + US_INDEXES.length}</strong><small>美股 · A股 · 美洲 · 欧洲 · 亚太</small></article>
          <article><span>上涨 / 下跌</span><strong><em className="is-up">{rising}</em><b>/</b><em className="is-down">{falling}</em></strong><small>按最新涨跌幅统计</small></article>
          <article><span>交易中市场</span><strong>{openMarkets}</strong><small>依据各交易所当地时段</small></article>
          <article><span>波动焦点</span><strong className={tone(leader?.changePct)}>{leader ? signedPercent(leader.changePct) : "—"}</strong><small>{leader?.name ?? "等待实时数据"}</small></article>
        </section>

        <section className="global-map-card" aria-label="全球主要股指地图">
          <header><div><p>LIVE WORLD MAP</p><h2>全球市场实时坐标</h2></div><div className="global-legend"><span><i className="is-up" />上涨</span><span><i className="is-down" />下跌</span><span><i />平盘</span></div></header>
          <div className="global-map-stage">
            <div className="global-map-orbit" aria-hidden="true" />
            <div className="global-map-land" aria-hidden="true" />
            <div className="global-map-grid" aria-hidden="true" />
            {GLOBAL_INDEXES.filter((item) => item.map).map((definition) => {
              const quote = quoteById.get(definition.id);
              const map = definition.map!;
              const style = { left: `${map.x}%`, top: `${map.y}%` } as CSSProperties;
              return (
                <article className={`global-map-marker anchor-${map.anchor} ${tone(quote?.changePct)}`} style={style} key={definition.id} title={`${definition.city} · ${definition.name}`}>
                  <span className="global-marker-dot"><i /></span>
                  <div className="global-marker-label"><small>{definition.city}</small><strong>{compactIndexName(definition.name)}</strong><b>{quote ? signedPercent(quote.changePct) : "—"}</b></div>
                </article>
              );
            })}
            {US_INDEXES.filter((item) => item.map).map((definition) => {
              const quote = usQuoteById.get(definition.id);
              const map = definition.map!;
              const style = { left: `${map.x}%`, top: `${map.y}%` } as CSSProperties;
              return (
                <article className={`global-map-marker anchor-${map.anchor} ${tone(quote?.cashChangePct ?? undefined)}`} style={style} key={definition.id} title={`纽约 · ${definition.name}`}>
                  <span className="global-marker-dot"><i /></span>
                  <div className="global-marker-label"><small>纽约</small><strong>{compactIndexName(definition.name)}</strong><b>{quote?.cashChangePct == null ? "—" : signedPercent(quote.cashChangePct)}</b></div>
                </article>
              );
            })}
          </div>
          <footer><span>点位按指数所在地理位置展示</span><span>红涨绿跌 · 数据仅供研究参考</span></footer>
        </section>

        <section className="global-region-board" aria-label="全球指数行情列表">
          <RegionPanel region="A股" definitions={GLOBAL_INDEXES.filter((item) => item.region === "A股")} quoteById={quoteById} />
          <USMarketPanel quotes={usQuotes} />
          {(["美洲", "欧洲", "亚太"] as GlobalRegion[]).map((region) => (
            <RegionPanel key={region} region={region} definitions={GLOBAL_INDEXES.filter((item) => item.region === region)} quoteById={quoteById} />
          ))}
        </section>
      </div>
    </main>
  );
}

function USMarketPanel({ quotes }: { quotes: USIndexSessionQuote[] }) {
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

function RegionPanel({ region, definitions, quoteById }: { region: GlobalRegion; definitions: typeof GLOBAL_INDEXES; quoteById: Map<string, GlobalIndexQuote> }) {
  const open = definitions.filter((definition) => quoteById.get(definition.id)?.marketStatus === "交易中").length;
  return (
    <section className={`global-region-card ${region === "A股" ? "is-a-share" : ""}`}>
      <header><div><span>{regionCode(region)}</span><h3>{region === "A股" ? "A股核心指数" : `${region}市场`}</h3></div><small>{open ? `${open} 交易中` : "当前休市"}</small></header>
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

function feedLabel(state: FeedState) { return state === "loading" ? "连接中" : state === "refreshing" ? "刷新中" : state === "error" ? "自动重试" : "实时行情"; }
function regionCode(region: GlobalRegion) { return region === "美洲" ? "AMER" : region === "欧洲" ? "EMEA" : region === "亚太" ? "APAC" : "CN-A"; }
function phaseTone(phase: USMarketPhase | undefined) { return phase === "盘中" ? "is-regular" : phase === "盘前" ? "is-pre" : phase === "盘后" ? "is-post" : phase === "夜盘" ? "is-night" : "is-closed"; }
function tone(value: number | undefined) { return (value ?? 0) > 0 ? "is-up" : (value ?? 0) < 0 ? "is-down" : "is-flat"; }
function signedPercent(value: number) { return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }
function compactIndexName(value: string) { return value.replace("加拿大 ", "").replace("澳大利亚 ", "").replace("巴西 ", "").replace("英国", "").replace("德国 ", "").replace("法国 ", "").replace("印度 ", ""); }
function formatPrice(value: number) { return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: value >= 10_000 ? 0 : 2, maximumFractionDigits: 2 }).format(value); }
function formatFetchedAt(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "刚刚" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }
