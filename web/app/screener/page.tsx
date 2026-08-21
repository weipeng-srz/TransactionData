"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SiteBanner from "../components/SiteBanner";
import { stockRouteKey, stockStorageKey } from "../lib/security";
import type { ScreenerFeed, ScreenerMarket, ScreenerOpportunity, ScreenerRecommendation } from "../lib/screenerTypes";
import { parseWatchlist, upsertWatchlistStock, type WatchlistStock } from "../lib/watchlist";
import styles from "./screener.module.css";

type Appearance = "light" | "dark";
type SortKey = "score" | "change" | "confidence" | "volume";

const watchlistStorageKey = "ticklens.watchlist.v1";
const appearanceStorageKey = "ticklens.appearance.v1";

const strategyTabs: Record<ScreenerMarket, string[]> = {
  CN: ["今日精选", "昨日涨停", "连板股", "趋势突破", "放量上涨"],
  US: ["今日精选", "强势股", "Gap Up", "突破新高", "放量上涨", "Momentum"],
};

export default function ScreenerPage() {
  const [market, setMarket] = useState<ScreenerMarket>("CN");
  const [strategy, setStrategy] = useState("今日精选");
  const [sort, setSort] = useState<SortKey>("score");
  const [theme, setTheme] = useState("全部题材");
  const [minimumScore, setMinimumScore] = useState(60);
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [selected, setSelected] = useState<ScreenerOpportunity | null>(null);
  const [watchlistKeys, setWatchlistKeys] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const [feeds, setFeeds] = useState<Partial<Record<ScreenerMarket, ScreenerFeed>>>({});
  const [loadingMarket, setLoadingMarket] = useState<ScreenerMarket | null>("CN");
  const [errors, setErrors] = useState<Partial<Record<ScreenerMarket, string>>>({});
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const storedAppearance = localStorage.getItem(appearanceStorageKey) === "dark" ? "dark" : "light";
    setAppearance(storedAppearance);
    document.documentElement.dataset.appearance = storedAppearance;
    document.title = "智能选股 · TrendSight";
    try {
      const parsed = parseWatchlist(JSON.parse(localStorage.getItem(watchlistStorageKey) ?? "[]"));
      setWatchlistKeys(parsed.map(stockStorageKey));
    } catch {
      localStorage.removeItem(watchlistStorageKey);
    }
    return () => { document.title = "TrendSight · 市场研究工作台"; };
  }, []);

  useEffect(() => {
    if (feeds[market]) return;
    const controller = new AbortController();
    setLoadingMarket(market);
    setErrors((current) => ({ ...current, [market]: "" }));
    fetch(`/api/screener?market=${market}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ScreenerFeed | { error?: string };
        if (!response.ok || !("opportunities" in payload)) throw new Error("error" in payload && payload.error ? payload.error : "行情服务暂不可用");
        setFeeds((current) => ({ ...current, [market]: payload }));
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setErrors((current) => ({ ...current, [market]: reason instanceof Error ? reason.message : "行情服务暂不可用" }));
      })
      .finally(() => setLoadingMarket((current) => current === market ? null : current));
    return () => controller.abort();
  }, [feeds, market, reloadNonce]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const feed = feeds[market];
  const marketStocks = useMemo(() => feed?.opportunities ?? [], [feed]);
  const visibleStocks = useMemo(() => marketStocks
    .filter((stock) => stock.strategies.includes(strategy))
    .filter((stock) => theme === "全部题材" || stock.themes.includes(theme) || stock.sector === theme)
    .filter((stock) => stock.score >= minimumScore)
    .sort((left, right) => sort === "score" ? right.score - left.score : sort === "change" ? right.change - left.change : sort === "confidence" ? right.confidence - left.confidence : right.volumeRatio - left.volumeRatio),
  [marketStocks, minimumScore, sort, strategy, theme]);
  const featured = marketStocks.filter((stock) => stock.strategies.includes("今日精选")).slice(0, 3);
  const availableThemes = feed?.themes.map((item) => item.name) ?? [];
  const isLoading = loadingMarket === market && !feed;
  const error = errors[market];

  const switchMarket = (nextMarket: ScreenerMarket) => {
    setMarket(nextMarket);
    setStrategy("今日精选");
    setTheme("全部题材");
    setSelected(null);
  };

  const retry = () => {
    setFeeds((current) => ({ ...current, [market]: undefined }));
    setReloadNonce((value) => value + 1);
  };

  const toggleAppearance = () => {
    const next = appearance === "light" ? "dark" : "light";
    setAppearance(next);
    document.documentElement.dataset.appearance = next;
    localStorage.setItem(appearanceStorageKey, next);
  };

  const addToWatchlist = (stock: ScreenerOpportunity) => {
    const nextStock: WatchlistStock = { code: stock.symbol, name: stock.name, market: stock.market, currency: stock.currency, addedAt: new Date().toISOString() };
    let current: WatchlistStock[] = [];
    try { current = parseWatchlist(JSON.parse(localStorage.getItem(watchlistStorageKey) ?? "[]")); } catch { /* Start a clean local list. */ }
    const existed = current.some((item) => stockStorageKey(item) === stockStorageKey(nextStock));
    const updated = upsertWatchlistStock(current, nextStock);
    localStorage.setItem(watchlistStorageKey, JSON.stringify(updated));
    setWatchlistKeys(updated.map(stockStorageKey));
    window.dispatchEvent(new CustomEvent("ticklens:watchlist-change", { detail: nextStock }));
    setToast(existed ? `${stock.name} 已在自选中，并已置顶` : `${stock.name} 已加入自选`);
  };

  const isWatched = (stock: ScreenerOpportunity) => watchlistKeys.includes(stockStorageKey({ code: stock.symbol, market: stock.market }));

  return (
    <div className={styles.page}>
      <SiteBanner activePage="screener" appearance={appearance} onToggleAppearance={toggleAppearance} statusText={feed ? `${feed.quoteStatus} · ${feed.diagnostics.delayed ? "公开延时" : "实时"}` : "正在连接公开行情"} />

      <main className={styles.shell}>
        <section className={styles.hero} aria-labelledby="screener-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>SMART OPPORTUNITY RADAR</p>
            <h1 id="screener-title">智能选股</h1>
            <p>从真实市场行情、趋势和量价结构中，筛选值得进一步研究的交易线索。</p>
          </div>
          <div className={styles.heroControls}>
            <div className={styles.marketSwitch} role="group" aria-label="选择股票市场">
              <button className={market === "CN" ? styles.active : ""} onClick={() => switchMarket("CN")} type="button">A股</button>
              <button className={market === "US" ? styles.active : ""} onClick={() => switchMarket("US")} type="button">美股</button>
            </div>
            <div className={styles.tradeDate}><span>交易日</span><strong>{feed?.tradeDate ?? "—"}</strong><small>{feed?.quoteStatus ?? "加载中"}</small></div>
          </div>
        </section>

        {isLoading ? <LoadingState market={market} /> : null}
        {!isLoading && error && !feed ? <ErrorState message={error} onRetry={retry} /> : null}

        {feed ? <>
          <section className={styles.marketStrip} aria-label={`${market === "CN" ? "A股" : "美股"}市场概览`}>
            <article className={styles.sentimentMetric}><span>市场情绪</span><strong><i />{feed.snapshot.mood}</strong><div className={styles.sentimentBar}><i style={{ width: `${feed.snapshot.moodScore}%` }} /></div></article>
            <article><span>核心指数</span><strong>{feed.snapshot.primary}</strong><small>{feed.snapshot.secondary}</small></article>
            <article><span>市场广度</span><strong>{feed.snapshot.breadthValue}</strong><small>{feed.snapshot.breadthCaption}</small></article>
            <article><span>强势信号</span><strong>{feed.snapshot.event}</strong><small>{feed.snapshot.liquidity}</small></article>
            <article className={styles.riskBudget}><span>模型风险预算</span><strong>{feed.snapshot.riskBudget}</strong><small>{feed.snapshot.riskNote}</small></article>
          </section>

          <section className={styles.strategyBrief} aria-label="今日选股建议">
            <div className={styles.briefMark} aria-hidden="true"><span /><i /></div>
            <div className={styles.briefLead}><span>规则模型策略</span><strong>{feed.brief.priority}</strong></div>
            <p>{feed.brief.summary}</p>
            <div className={styles.briefTags}><span>{feed.brief.positiveTag}</span><span>{feed.brief.warningTag}</span></div>
          </section>

          <div className={styles.workspace}>
            <div className={styles.primaryColumn}>
              <section className={styles.featuredSection} aria-labelledby="featured-title">
                <header className={styles.sectionHeader}>
                  <div><span>DAILY SHORTLIST</span><h2 id="featured-title">今日模型精选</h2></div>
                  <p>已分析 <strong>{feed.diagnostics.analyzedCount}</strong> 只候选 · 评分由真实日K因子计算</p>
                </header>
                <div className={styles.featuredGrid}>
                  {featured.map((stock, index) => (
                    <article className={`${styles.featuredCard} ${index === 0 ? styles.leadingCard : ""}`} key={`${stock.market}-${stock.symbol}`}>
                      <div className={styles.cardTopline}><span>{stock.signal}</span><em>{stock.sector}</em><small>#{index + 1}</small></div>
                      <div className={styles.stockHeadline}>
                        <div><strong>{stock.name}</strong><span>{stock.symbol} · {stock.exchange}</span></div>
                        <div><b>{currencySymbol(stock)}{stock.price.toFixed(2)}</b><em className={changeClass(stock.change, styles)}>{signedPercent(stock.change)}</em></div>
                      </div>
                      <div className={styles.scoreLine}>
                        <div className={styles.scoreOrb}><strong>{stock.score}</strong><span>机会评分</span></div>
                        <div><strong>{recommendationIcon(stock.recommendation)} {stock.recommendation}</strong><span>模型置信度 {stock.confidence}%</span></div>
                      </div>
                      <div className={styles.cardMetrics}>
                        <span><small>量能</small><strong>{stock.volumeRatio.toFixed(2)}x</strong></span>
                        <span><small>价格位置</small><strong>{stock.closePosition.toFixed(1)}%</strong></span>
                        <span><small>风险</small><strong className={riskClass(stock.risk, styles)}>{stock.risk}</strong></span>
                      </div>
                      <p className={styles.cardReason}>{stock.reasons[0]}</p>
                      <div className={styles.cardActions}>
                        <button type="button" onClick={() => addToWatchlist(stock)}>{isWatched(stock) ? "★ 已自选" : "☆ 加入自选"}</button>
                        <button type="button" onClick={() => setSelected(stock)}>查看机会计划 <span>→</span></button>
                      </div>
                    </article>
                  ))}
                  {!featured.length ? <div className={styles.emptyState}><strong>当前没有达到精选阈值的标的</strong><span>可在策略股票池中降低评分门槛继续查看。</span></div> : null}
                </div>
              </section>

              <section className={styles.stockPool} aria-labelledby="stock-pool-title">
                <header className={styles.poolHeader}>
                  <div><span>STRATEGY POOL</span><h2 id="stock-pool-title">策略股票池</h2></div>
                  <p>默认按机会评分排序 · 点击股票查看因子、风险与模型区间</p>
                </header>

                <div className={styles.strategyTabs} role="tablist" aria-label="选股策略">
                  {strategyTabs[market].map((tab) => {
                    const count = marketStocks.filter((stock) => stock.strategies.includes(tab)).length;
                    return <button key={tab} className={strategy === tab ? styles.activeTab : ""} type="button" role="tab" aria-selected={strategy === tab} onClick={() => setStrategy(tab)}>{tab}<small>{count}</small></button>;
                  })}
                </div>

                <div className={styles.filters}>
                  <label><span>板块/题材</span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option>全部题材</option>{availableThemes.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label><span>最低评分</span><select value={minimumScore} onChange={(event) => setMinimumScore(Number(event.target.value))}><option value={60}>60+</option><option value={70}>70+</option><option value={80}>80+</option><option value={90}>90+</option></select></label>
                  <label><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="score">机会评分</option><option value="confidence">模型置信度</option><option value="change">涨幅</option><option value="volume">量能</option></select></label>
                  <span className={styles.resultCount}>{visibleStocks.length} 只符合条件</span>
                </div>

                <div className={styles.tableWrap}>
                  <table>
                    <thead><tr><th>股票</th><th>核心信号</th><th>价格 / 涨幅</th><th>量能</th><th>换手率</th><th>机会评分</th><th>风险</th><th>建议</th><th aria-label="操作" /></tr></thead>
                    <tbody>{visibleStocks.map((stock) => (
                      <tr key={`${stock.market}-${stock.symbol}`} onClick={() => setSelected(stock)}>
                        <td><div className={styles.stockCell}><span>{stock.name.slice(0, 1)}</span><div><strong>{stock.name}</strong><small>{stock.symbol} · {stock.exchange}</small></div></div></td>
                        <td><strong className={styles.signalLabel}>{stock.signal}</strong><small className={styles.sectorLabel}>{stock.sector}</small></td>
                        <td><strong>{currencySymbol(stock)}{stock.price.toFixed(2)}</strong><small className={changeClass(stock.change, styles)}>{signedPercent(stock.change)}</small></td>
                        <td><strong>{stock.volumeRatio.toFixed(2)}x</strong><small>{stock.amount}</small></td>
                        <td><strong>{stock.turnover.toFixed(1)}%</strong><small>位置 {stock.closePosition.toFixed(0)}%</small></td>
                        <td><div className={styles.tableScore}><strong>{stock.score}</strong><span><i style={{ width: `${stock.score}%` }} /></span></div></td>
                        <td><strong className={riskClass(stock.risk, styles)}>{stock.risk}</strong><small>{stock.risk >= 60 ? "偏高" : stock.risk >= 40 ? "中等" : "可控"}</small></td>
                        <td><strong>{recommendationIcon(stock.recommendation)} {stock.recommendation}</strong><small>{stock.confidence}% 模型置信度</small></td>
                        <td><button className={styles.rowAction} type="button" onClick={(event) => { event.stopPropagation(); addToWatchlist(stock); }} aria-label={`${isWatched(stock) ? "置顶" : "加入"}${stock.name}自选`}>{isWatched(stock) ? "★" : "☆"}</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {!visibleStocks.length ? <div className={styles.emptyState}><strong>当前条件下没有真实行情候选</strong><span>降低最低评分或切换策略后再试。</span></div> : null}
                </div>
              </section>
            </div>

            <aside className={styles.insightRail} aria-label="市场结构与热门板块">
              <section className={styles.ladderCard}>
                <header><div><span>{market === "CN" ? "LIMIT-UP LADDER" : "US QUALITY GATE"}</span><h2>{feed.structure.title}</h2></div><strong>{feed.structure.badge}</strong></header>
                {market === "CN" ? <div className={styles.ladder}>{feed.structure.rows.map((row) => <div key={row.level}><strong>{row.level}</strong><span>{row.names.map((name) => <button type="button" key={name}>{name}</button>)}</span></div>)}</div>
                  : <div className={styles.qualityRules}>{feed.structure.rows.map((row) => <span key={row.level}><i />{row.level} {row.names.join(" · ")}</span>)}</div>}
                <dl className={styles.ladderStats}>{feed.structure.stats.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
                <p>{feed.structure.note}</p>
              </section>

              <section className={styles.themeCard}>
                <header><div><span>MARKET THEMES</span><h2>{market === "CN" ? "涨停板块热度" : "涨幅榜分类"}</h2></div><small>真实样本聚合</small></header>
                <ol>{feed.themes.map((item, index) => <li key={item.name}><button type="button" onClick={() => setTheme(item.name)}><b>{index + 1}</b><span><strong>{item.name}</strong><small>{"●".repeat(item.heat)}<i>{"●".repeat(5 - item.heat)}</i></small></span><em className={changeClass(item.change, styles)}>{signedPercent(item.change)}<small>{item.count} 个样本</small></em></button></li>)}</ol>
              </section>

              <section className={styles.scaleCard}>
                <span>SCORE GUIDE</span><h2>机会评分说明</h2>
                <div><i className={styles.scoreStrong}>86</i><span><strong>强烈关注</strong><small>趋势、量价与风险共同达标</small></span></div>
                <div><i className={styles.scoreGood}>76</i><span><strong>值得关注</strong><small>等待价格与量能确认</small></span></div>
                <div><i className={styles.scoreWatch}>65</i><span><strong>观察</strong><small>信号尚未完全闭环</small></span></div>
                <p>评分来自价格强度、趋势、量价、动量与风险规则，不是历史回测胜率，也不代表公司长期价值。</p>
              </section>
            </aside>
          </div>

          <footer className={styles.disclaimer}>
            <strong>数据说明</strong>
            <span>行情来自{feed.source}，采集时间 {formatFetchedAt(feed.fetchedAt)}；公开免费行情可能延时、缺失或在休市时停留于最近交易日。评分、模型置信度与机会区间由规则模型基于真实行情计算，不是上涨概率或交易指令，不构成投资建议。 {feed.sourceLinks.map((link, index) => <span key={link.url}>{index ? " · " : ""}<a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></span>)}</span>
          </footer>
        </> : null}
      </main>

      {selected ? <OpportunityDrawer stock={selected} watched={isWatched(selected)} onClose={() => setSelected(null)} onAdd={() => addToWatchlist(selected)} /> : null}
      {toast ? <div className={styles.toast} role="status"><i />{toast}</div> : null}
    </div>
  );
}

function LoadingState({ market }: { market: ScreenerMarket }) {
  return <section className={styles.dataState} aria-live="polite"><div className={styles.spinner} /><strong>正在扫描{market === "CN" ? "沪深京全市场" : "美股涨幅榜与日K"}</strong><span>公开行情接口返回速度会随市场时段变化，首次加载通常需要数秒。</span></section>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <section className={`${styles.dataState} ${styles.errorState}`} role="alert"><strong>真实行情暂时没有返回</strong><span>{message}</span><button type="button" onClick={onRetry}>重新获取</button></section>;
}

function OpportunityDrawer({ stock, watched, onClose, onAdd }: { stock: ScreenerOpportunity; watched: boolean; onClose: () => void; onAdd: () => void }) {
  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className={styles.drawerHeader}>
          <div><span>{stock.exchange} · {stock.signal}</span><h2 id="drawer-title">{stock.name} <small>{stock.symbol}</small></h2></div>
          <button type="button" onClick={onClose} aria-label="关闭机会详情">×</button>
        </header>
        <div className={styles.drawerQuote}>
          <div><span>最近公开价格</span><strong>{currencySymbol(stock)}{stock.price.toFixed(2)}</strong><em className={changeClass(stock.change, styles)}>{signedPercent(stock.change)}</em></div>
          <div className={styles.drawerScore}><span>模型机会评分</span><strong>{stock.score}</strong><small>{recommendationIcon(stock.recommendation)} {stock.recommendation}</small></div>
        </div>

        {stock.risk >= 60 ? <div className={styles.chaseWarning}><strong>⚠ 强势，但不建议当前位置追高</strong><span>风险评分 {stock.risk}，等待价格回落或突破确认后再评估风险收益比。</span></div> : null}

        <section className={styles.drawerSection}>
          <header><h3>因子拆解</h3><span>模型置信度 <strong>{stock.confidence}%</strong> · 风险 <strong className={riskClass(stock.risk, styles)}>{stock.risk}</strong></span></header>
          <div className={styles.factorGrid}>{stock.factorScores.map((factor) => <div key={factor.label}><span>{factor.label}<strong>{factor.value}</strong></span><i><b style={{ width: `${factor.value}%` }} /></i></div>)}</div>
        </section>

        <section className={styles.drawerSection}>
          <header><h3>为什么进入候选池</h3><span>{stock.themes.join(" · ")}</span></header>
          <ul className={styles.reasonList}>{stock.reasons.map((reason) => <li key={reason}><i>✓</i>{reason}</li>)}</ul>
        </section>

        <section className={styles.drawerSection}>
          <header><h3>主要风险</h3><span>先看风险，再看空间</span></header>
          <ul className={styles.riskList}>{stock.risks.map((risk) => <li key={risk}><i>!</i>{risk}</li>)}</ul>
        </section>

        <section className={`${styles.drawerSection} ${styles.tradePlan}`}>
          <header><h3>机会计划</h3><span>规则模型区间 · 非交易指令</span></header>
          <dl><div><dt>建议关注</dt><dd>{stock.plan.watch}</dd></div><div><dt>突破确认</dt><dd>{stock.plan.breakout}</dd></div><div><dt>风险失效</dt><dd>{stock.plan.stop}</dd></div><div><dt>观察目标</dt><dd>{stock.plan.targets}</dd></div></dl>
        </section>

        <div className={styles.drawerActions}>
          <button type="button" onClick={onAdd}>{watched ? "★ 已在自选 · 置顶" : "☆ 加入自选"}</button>
          <Link href={`/?stock=${encodeURIComponent(stockRouteKey({ code: stock.symbol, market: stock.market }))}`}>查看完整个股分析 <span>→</span></Link>
        </div>
      </aside>
    </div>
  );
}

function recommendationIcon(recommendation: ScreenerRecommendation) {
  if (recommendation === "强烈关注") return "◆";
  if (recommendation === "值得关注") return "★";
  if (recommendation === "观察") return "◉";
  return "△";
}

function riskClass(risk: number, classNames: Record<string, string>) {
  if (risk >= 60) return classNames.riskHigh;
  if (risk >= 40) return classNames.riskMedium;
  return classNames.riskLow;
}

function changeClass(change: number, classNames: Record<string, string>) {
  return change < 0 ? classNames.downText : classNames.upText;
}

function signedPercent(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
function currencySymbol(stock: ScreenerOpportunity) { return stock.currency === "CNY" ? "¥" : "$"; }
function formatFetchedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", hour12: false }).format(date);
}
