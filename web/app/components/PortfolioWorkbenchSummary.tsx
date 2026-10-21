"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import type { StockHoldings } from "../lib/holdings";
import {
  buildPortfolioSignalAvailability,
  buildPortfolioWorkbenchDigest,
  selectPortfolioDiscoveryIdeas,
  type PortfolioWorkbenchActionName,
  type PortfolioWorkbenchQuote,
} from "../lib/portfolioWorkbench";
import { stockRouteKey, stockStorageKey, type StockMarket } from "../lib/security";
import type { ScreenerFeed } from "../lib/screenerTypes";
import type { WatchlistStock } from "../lib/watchlist";
import styles from "./PortfolioWorkbenchSummary.module.css";

type MarketLoadState = "idle" | "loading" | "ready" | "error";
type DiscoveryState = {
  feeds: Partial<Record<StockMarket, ScreenerFeed>>;
  markets: Record<StockMarket, MarketLoadState>;
  errors: Partial<Record<StockMarket, string>>;
};
type HoldingFilter = "all" | "review" | "profit" | "loss";
type HoldingSort = "priority" | "weight" | "profitAsc" | "profitDesc";

const markets: StockMarket[] = ["CN", "US"];
const actionPageSize = 6;
const holdingPageSize = 8;

export default function PortfolioWorkbenchSummary({
  watchlist,
  holdings,
  quotes,
  onOpenStock,
  onAddStock,
  onRetryNews,
}: {
  watchlist: WatchlistStock[];
  holdings: StockHoldings;
  quotes: Record<string, PortfolioWorkbenchQuote>;
  onOpenStock: (code: string) => void;
  onAddStock: (stock: WatchlistStock) => void;
  onRetryNews: (stock: WatchlistStock) => Promise<void>;
}) {
  const [discovery, setDiscovery] = useState<DiscoveryState>({ feeds: {}, markets: { CN: "loading", US: "loading" }, errors: {} });
  const [scanRequest, setScanRequest] = useState({ version: 0, markets });
  const [showAllConflicts, setShowAllConflicts] = useState(false);
  const [includeObservedActions, setIncludeObservedActions] = useState(false);
  const [visibleActionCount, setVisibleActionCount] = useState(actionPageSize);
  const [holdingFilter, setHoldingFilter] = useState<HoldingFilter>("all");
  const [holdingSort, setHoldingSort] = useState<HoldingSort>("priority");
  const [holdingQuery, setHoldingQuery] = useState("");
  const [visibleHoldingCount, setVisibleHoldingCount] = useState(holdingPageSize);
  const [showAllSignals, setShowAllSignals] = useState(false);
  const [showAllNews, setShowAllNews] = useState(false);
  const [mobileChapter, setMobileChapter] = useState<"priority" | "evidence" | "discovery">("priority");
  const workbenchId = useId();
  const digest = useMemo(
    () => buildPortfolioWorkbenchDigest(watchlist, holdings, quotes),
    [holdings, quotes, watchlist],
  );
  const ideas = useMemo(
    () => selectPortfolioDiscoveryIdeas(discovery.feeds, watchlist),
    [discovery.feeds, watchlist],
  );

  useEffect(() => {
    const controller = new AbortController();
    scanRequest.markets.forEach((market) => {
      const marketController = new AbortController();
      const abortMarket = () => marketController.abort();
      const timeout = window.setTimeout(abortMarket, 25_000);
      controller.signal.addEventListener("abort", abortMarket, { once: true });
      fetch(`/api/screener?market=${market}`, { signal: marketController.signal })
        .then(async (response) => {
          const payload = await response.json() as ScreenerFeed | { error?: string };
          if (!response.ok || !("opportunities" in payload)) {
            throw new Error("error" in payload && payload.error ? payload.error : `${marketName(market)}选股数据暂不可用`);
          }
          setDiscovery((current) => ({
            feeds: { ...current.feeds, [market]: payload },
            markets: { ...current.markets, [market]: "ready" },
            errors: { ...current.errors, [market]: undefined },
          }));
        })
        .catch((reason) => {
          if (controller.signal.aborted) return;
          const message = marketController.signal.aborted
            ? `${marketName(market)}候选扫描超过 25 秒`
            : reason instanceof Error ? reason.message : `${marketName(market)}选股数据暂不可用`;
          setDiscovery((current) => ({
            ...current,
            markets: { ...current.markets, [market]: "error" },
            errors: { ...current.errors, [market]: message },
          }));
        })
        .finally(() => {
          window.clearTimeout(timeout);
          controller.signal.removeEventListener("abort", abortMarket);
        });
    });
    return () => controller.abort();
  }, [scanRequest]);

  const visibleConflicts = showAllConflicts ? digest.conflicts : digest.conflicts.slice(0, 3);
  const actionableActions = digest.actions.filter((item) => item.actionable);
  const actionPool = includeObservedActions ? digest.actions : actionableActions;
  const visibleActions = actionPool.slice(0, visibleActionCount);
  const holdingStats = useMemo(() => ({
    review: digest.holdings.filter((item) => item.action.actionable).length,
    profit: digest.holdings.filter((item) => (item.profitPct ?? 0) > 0).length,
    loss: digest.holdings.filter((item) => (item.profitPct ?? 0) < 0).length,
  }), [digest.holdings]);
  const filteredHoldings = useMemo(() => {
    const normalizedQuery = holdingQuery.trim().toLocaleLowerCase();
    const items = digest.holdings.filter((item) => {
      if (normalizedQuery && !`${item.stockName} ${item.code}`.toLocaleLowerCase().includes(normalizedQuery)) return false;
      if (holdingFilter === "review") return item.action.actionable;
      if (holdingFilter === "profit") return (item.profitPct ?? 0) > 0;
      if (holdingFilter === "loss") return (item.profitPct ?? 0) < 0;
      return true;
    });
    return items.sort((left, right) => {
      if (holdingSort === "weight") return (right.weightPct ?? -1) - (left.weightPct ?? -1) || right.action.priority - left.action.priority;
      if (holdingSort === "profitAsc") return (left.profitPct ?? Number.POSITIVE_INFINITY) - (right.profitPct ?? Number.POSITIVE_INFINITY);
      if (holdingSort === "profitDesc") return (right.profitPct ?? Number.NEGATIVE_INFINITY) - (left.profitPct ?? Number.NEGATIVE_INFINITY);
      return right.action.priority - left.action.priority || (left.profitPct ?? 0) - (right.profitPct ?? 0);
    });
  }, [digest.holdings, holdingFilter, holdingQuery, holdingSort]);
  const visibleHoldings = filteredHoldings.slice(0, visibleHoldingCount);
  const holdingHasControls = digest.holdings.length > 6;
  const visibleSignals = showAllSignals ? digest.bsSignals : digest.bsSignals.slice(0, 6);
  const visibleNews = showAllNews ? digest.attentionNews : digest.attentionNews.slice(0, 4);
  const newsFailedStocks = watchlist.filter((stock) => digest.newsCoverage.failedKeys.includes(stockStorageKey(stock)));
  const discoveryHasError = markets.some((market) => discovery.markets[market] === "error");
  const discoveryLoading = markets.some((market) => discovery.markets[market] === "loading");
  const discoveryErrors = markets.flatMap((market) => discovery.errors[market] ? [`${marketName(market)}：${discovery.errors[market]}`] : []);
  const signalKpi = buildPortfolioSignalAvailability(digest.quoteCoverage, digest.technicalSignalCount, digest.evidenceSignalCount);
  const newsKpi = newsKpiValue(digest.newsCoverage, digest.attentionNews.length, digest.negativeNewsCount);
  const retryDiscovery = () => {
    const failedMarkets = markets.filter((market) => discovery.markets[market] === "error");
    if (!failedMarkets.length) return;
    setDiscovery((current) => {
      const nextMarkets = { ...current.markets };
      const nextErrors = { ...current.errors };
      failedMarkets.forEach((market) => {
        nextMarkets[market] = "loading";
        delete nextErrors[market];
      });
      return { ...current, markets: nextMarkets, errors: nextErrors };
    });
    setScanRequest((current) => ({ version: current.version + 1, markets: failedMarkets }));
  };
  const retryFailedNews = async () => {
    for (const stock of newsFailedStocks) {
      try { await onRetryNews(stock); } catch { /* each stock keeps its own visible failure state */ }
    }
  };

  return (
    <section className={styles.summary} aria-labelledby="workbench-summary-title">
      <header className={styles.header}>
        <div>
          <p>WATCHLIST BRIEFING</p>
          <h2 id="workbench-summary-title">自选决策工作台</h2>
          <span>先处理组合风险与数据缺口，再看信号、持仓、新闻和研究候选</span>
        </div>
        <div className={styles.asOf}>
          <span>行情可用 {digest.quoteCoverage.ready + digest.quoteCoverage.partial}/{digest.quoteCoverage.tracked || 0}{digest.quoteCoverage.partial ? ` · ${digest.quoteCoverage.partial} 只部分可用` : ""}{digest.quoteCoverage.loading ? ` · ${digest.quoteCoverage.loading} 只加载中` : ""}{digest.quoteCoverage.failed ? ` · ${digest.quoteCoverage.failed} 只失败` : ""}{digest.quoteCoverage.lagging ? ` · ${digest.quoteCoverage.lagging} 只落后同市场` : ""}</span>
          <small>{digest.quoteCoverage.latestUpdate ? `最新时点 ${digest.quoteCoverage.latestUpdate.slice(0, 16)}` : "尚无可核验行情时点"} · 模型结论不是自动交易指令</small>
        </div>
      </header>

      <div className={styles.kpis} aria-label="自选工作台关键数字">
        <SummaryKpi label="持仓股票" value={`${digest.totals.positioned} 只`} detail={currencyTotalsText(digest.totals.byCurrency)} />
        <SummaryKpi label="技术 B/S 触发" value={signalKpi.value} detail={signalKpi.detail} tone={signalKpi.tone} />
        <SummaryKpi label="需优先复核" value={`${digest.actionableCount} 只`} detail={digest.holdingConflictCount ? `${digest.holdingConflictCount} 只持仓存在模型分歧` : `${digest.observeCount} 只继续观察`} tone={digest.actionableCount ? "warning" : "neutral"} />
        <SummaryKpi label="新闻关注" value={newsKpi.value} detail={newsKpi.detail} tone={digest.newsCoverage.failed ? "risk" : digest.newsCoverage.loading ? "warning" : "neutral"} />
      </div>

      <nav className="platform-mobile-section-nav" aria-label="决策工作台信息分组">
        <button type="button" aria-pressed={mobileChapter === "priority"} onClick={() => setMobileChapter("priority")}>优先复核</button>
        <button type="button" aria-pressed={mobileChapter === "evidence"} onClick={() => setMobileChapter("evidence")}>信号与新闻</button>
        <button type="button" aria-pressed={mobileChapter === "discovery"} onClick={() => setMobileChapter("discovery")}>研究候选</button>
      </nav>

      <div className={`${styles.primaryGrid} platform-mobile-visibility`} data-active={mobileChapter === "priority"}>
        <article className={`${styles.panel} ${styles.priorityPanel}`}>
          <PanelHeader eyebrow="PRIORITY QUEUE" title="持仓操作复核" meta={`需复核 ${digest.actionableCount} 只 · 继续观察 ${digest.observeCount} 只`} />
          {digest.conflicts.length ? (
            <div className={styles.conflictBanner} role="status">
              <strong>{digest.signalConflictCount} 项模型分歧</strong>
              <span id={`${workbenchId}-conflicts`}>{visibleConflicts.map((item) => `${item.stockName}：${item.summary}`).join("；")}</span>
              {digest.conflicts.length > 3 ? <button type="button" aria-expanded={showAllConflicts} aria-controls={`${workbenchId}-conflicts`} onClick={() => setShowAllConflicts((value) => !value)}>{showAllConflicts ? "收起分歧" : `查看全部 ${digest.conflicts.length} 项`}</button> : null}
            </div>
          ) : null}
          <div className={`${styles.actionList} ${actionPool.length > actionPageSize ? styles.actionViewport : ""}`} id={`${workbenchId}-actions`}>
            {visibleActions.length ? visibleActions.map((item) => (
              <button key={item.key} className={styles.actionRow} type="button" onClick={() => onOpenStock(stockRouteKey({ code: item.code, market: item.market }))}>
                <ActionBadge action={item.action} />
                <span><b>{item.stockName}</b><small>{item.reason}{item.secondaryReasons.length ? ` 另需关注：${item.secondaryReasons.join("；")}` : ""}</small></span>
                <span className={styles.actionMeta}><b>{item.referencePrice == null ? item.source : money(item.referencePrice, item.currency)}</b><small>{item.referenceLabel}{item.source !== "明日模型" || item.confidence == null ? "" : ` · 模型置信分 ${item.confidence}/100`}{item.quoteDate ? ` · 行情 ${item.quoteDate.slice(5)}` : ""}</small></span>
              </button>
            )) : <EmptyCopy>{digest.observeCount ? `${digest.observeCount} 只持仓暂归为继续观察；没有需要优先复核的操作候选。` : "尚未形成持仓复核队列；先记录持仓并等待行情完成。"}</EmptyCopy>}
          </div>
          {actionPool.length > actionPageSize || digest.observeCount ? (
            <div className={styles.listPager}>
              <span role="status">显示 {visibleActions.length}/{actionPool.length} 只{includeObservedActions ? "持仓" : "需复核持仓"}</span>
              <div>
                {digest.observeCount ? (
                  <button
                    type="button"
                    aria-pressed={includeObservedActions}
                    onClick={() => {
                      setIncludeObservedActions((value) => !value);
                      setVisibleActionCount(actionPageSize);
                    }}
                  >
                    {includeObservedActions ? "隐藏继续观察" : `包含 ${digest.observeCount} 只继续观察`}
                  </button>
                ) : null}
                {visibleActionCount > actionPageSize ? <button type="button" onClick={() => setVisibleActionCount(actionPageSize)}>收起</button> : null}
                {visibleActions.length < actionPool.length ? (
                  <button type="button" onClick={() => setVisibleActionCount((count) => count + actionPageSize)}>
                    再显示 {Math.min(actionPageSize, actionPool.length - visibleActions.length)} 只
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <p className={styles.modelNotice}>“止损/止盈/加减仓”均为模型复核候选；执行前必须核对个人交易计划、持有周期、目标仓位和风险预算。</p>
        </article>

        <article className={styles.panel}>
          <PanelHeader eyebrow="POSITIONS" title="持仓分析" meta={`共 ${digest.holdings.length} 只 · 需复核 ${holdingStats.review} 只 · 默认风险优先`} />
          {holdingHasControls ? (
            <div className={styles.positionControls}>
              <div className={styles.positionQuickFilters} role="group" aria-label="持仓筛选">
                <button type="button" aria-pressed={holdingFilter === "all"} onClick={() => { setHoldingFilter("all"); setVisibleHoldingCount(holdingPageSize); }}>全部 {digest.holdings.length}</button>
                <button type="button" aria-pressed={holdingFilter === "review"} onClick={() => { setHoldingFilter("review"); setVisibleHoldingCount(holdingPageSize); }}>需复核 {holdingStats.review}</button>
                <button type="button" aria-pressed={holdingFilter === "profit"} onClick={() => { setHoldingFilter("profit"); setVisibleHoldingCount(holdingPageSize); }}>盈利 {holdingStats.profit}</button>
                <button type="button" aria-pressed={holdingFilter === "loss"} onClick={() => { setHoldingFilter("loss"); setVisibleHoldingCount(holdingPageSize); }}>亏损 {holdingStats.loss}</button>
              </div>
              <label className={styles.positionSearch}>
                <span>搜索</span>
                <input
                  aria-label="搜索持仓股票"
                  type="search"
                  value={holdingQuery}
                  placeholder="名称 / 代码"
                  onChange={(event) => {
                    setHoldingQuery(event.target.value);
                    setVisibleHoldingCount(holdingPageSize);
                  }}
                />
              </label>
              <label className={styles.positionSort}>
                <span>排序</span>
                <select
                  aria-label="持仓排序"
                  value={holdingSort}
                  onChange={(event) => {
                    setHoldingSort(event.target.value as HoldingSort);
                    setVisibleHoldingCount(holdingPageSize);
                  }}
                >
                  <option value="priority">风险优先</option>
                  <option value="weight">仓位从高到低</option>
                  <option value="profitAsc">收益从低到高</option>
                  <option value="profitDesc">收益从高到低</option>
                </select>
              </label>
            </div>
          ) : null}
          {holdingHasControls ? <div className={styles.positionColumns} aria-hidden="true"><span>股票</span><span>市值 / 权重</span><span>累计 / 当日</span><span>复核状态</span></div> : null}
          <div className={`${styles.positionList} ${holdingHasControls ? styles.positionViewport : ""}`} id={`${workbenchId}-holdings`}>
            {visibleHoldings.length ? visibleHoldings.map((position) => (
              <button key={position.key} className={styles.positionRow} type="button" onClick={() => onOpenStock(stockRouteKey({ code: position.code, market: position.market }))}>
                <span className={styles.stockIdentity}><b>{position.stockName}</b><small>{position.code} · {position.currency}</small></span>
                <span><small>市值 / 同币种权重</small><b>{money(position.marketValue, position.currency)} · {percent(position.weightPct)}</b></span>
                <span><small>累计 / 当日</small><b className={toneClass(position.profitPct)}>{signedPercent(position.profitPct)} / {signedPercent(position.dayChangePct)}</b></span>
                <ActionBadge action={position.action.action} />
              </button>
            )) : <EmptyCopy>{digest.holdings.length ? "没有符合当前筛选条件的持仓。" : "在自选股中记录持股数与成本价后，这里会按币种计算市值、收益、集中度与操作复核。"}</EmptyCopy>}
          </div>
          {holdingHasControls ? (
            <div className={styles.listPager}>
              <span role="status">显示 {visibleHoldings.length}/{filteredHoldings.length} 只{holdingQuery.trim() || holdingFilter !== "all" ? "匹配持仓" : "持仓"}</span>
              <div>
                {visibleHoldingCount > holdingPageSize ? <button type="button" onClick={() => setVisibleHoldingCount(holdingPageSize)}>收起</button> : null}
                {visibleHoldings.length < filteredHoldings.length ? (
                  <button type="button" onClick={() => setVisibleHoldingCount((count) => count + holdingPageSize)}>
                    再显示 {Math.min(holdingPageSize, filteredHoldings.length - visibleHoldings.length)} 只
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </article>
      </div>

      <div className={`${styles.secondaryGrid} platform-mobile-visibility`} data-active={mobileChapter === "evidence"}>
        <article className={styles.panel}>
          <PanelHeader eyebrow="B / S & EVIDENCE" title="B/S 触发与证据倾向" meta="技术触发含日期和价格；综合倾向不等于价格 B/S 点" />
          <div className={styles.signalList} id={`${workbenchId}-signals`}>
            {visibleSignals.length ? visibleSignals.map((signal) => (
              <button key={signal.key} className={styles.signalRow} type="button" onClick={() => onOpenStock(stockRouteKey({ code: signal.code, market: signal.market }))}>
                <i className={signal.kind === "technical" ? signal.side === "B" ? styles.buySignal : styles.sellSignal : signal.side === "B" ? styles.positiveEvidence : styles.riskEvidence}>{signal.kind === "technical" ? signal.side : signal.side === "B" ? "偏强" : "偏弱"}</i>
                <span><b>{signal.stockName} · {signal.headline}</b><small>{signal.detail}</small></span>
                <span><b>{signal.kind === "technical" ? signal.price == null ? "—" : price(signal.price, signal.market === "US" ? "USD" : "CNY") : signal.score}</b><small>{signal.kind === "technical" ? signal.occurredAt || "时点待核验" : `覆盖 ${signal.coverage ?? 0}%`}{signal.hasHolding ? " · 持仓" : " · 自选"}</small></span>
              </button>
            )) : <EmptyCopy>{signalKpi.emptyText}</EmptyCopy>}
          </div>
          {digest.bsSignals.length > 6 ? <ListToggle controls={`${workbenchId}-signals`} expanded={showAllSignals} onClick={() => setShowAllSignals((value) => !value)} expandLabel={`查看其余 ${digest.bsSignals.length - 6} 条信号`} collapseLabel="收起信号" /> : null}
        </article>

        <article className={`${styles.panel} ${styles.newsPanel}`}>
          <PanelHeader eyebrow="NEWS RADAR" title="自选股关注新闻" meta={`覆盖 ${digest.newsCoverage.ready}/${digest.newsCoverage.tracked || 0} 只 · 仅列近 ${14} 日重点事件`} />
          {digest.newsCoverage.loading || digest.newsCoverage.failed ? (
            <div className={`${styles.coverageBanner} ${digest.newsCoverage.failed ? styles.coverageError : ""}`} role="status">
              <span>{digest.newsCoverage.loading ? `${digest.newsCoverage.loading} 只新闻仍在加载` : ""}{digest.newsCoverage.loading && digest.newsCoverage.failed ? " · " : ""}{digest.newsCoverage.failed ? `${digest.newsCoverage.failed} 只新闻获取失败，不能视为无风险` : ""}</span>
              {newsFailedStocks.length ? <button type="button" onClick={() => void retryFailedNews()}>依次重试新闻扫描</button> : null}
            </div>
          ) : null}
          <div className={styles.newsList} id={`${workbenchId}-news`}>
            {visibleNews.length ? visibleNews.map((item) => (
              <a key={item.key} href={item.url} target="_blank" rel="noreferrer" className={styles.newsRow}>
                <span className={`${styles.newsTone} ${item.attention === "风险" ? styles.riskNews : item.attention === "利好" ? styles.positiveNews : ""}`}>{item.attention}</span>
                <span><b>{item.stockName} · {item.title}</b><small>{item.eventType} · {item.media} · 来源质量 {item.sourceQuality}{item.publishedAt ? ` · ${item.publishedAt.slice(5, 16)}` : ""}</small></span>
                <i aria-hidden="true">↗</i>
              </a>
            )) : <EmptyCopy>{newsEmptyText(digest.newsCoverage)}</EmptyCopy>}
          </div>
          {digest.attentionNews.length > 4 ? <ListToggle controls={`${workbenchId}-news`} expanded={showAllNews} onClick={() => setShowAllNews((value) => !value)} expandLabel={`查看其余 ${digest.attentionNews.length - 4} 条重点新闻`} collapseLabel="收起新闻" /> : null}
        </article>
      </div>

      <article className={`${styles.panel} ${styles.discoveryPanel} platform-mobile-visibility`} data-active={mobileChapter === "discovery"}>
        <PanelHeader eyebrow="DISCOVERY" title="新票研究候选" meta="排除现有自选；评分、风险与赔率共同达标后才进入候选" />
        <div className={styles.discoveryStatus} role="status">
          <div><span>{markets.map((market) => `${marketName(market)}${marketLoadText(discovery.markets[market])}`).join(" · ")}</span>{discoveryErrors.length ? <small>{discoveryErrors.join("；")}</small> : null}</div>
          {discoveryHasError ? <button type="button" onClick={retryDiscovery}>重试失败市场</button> : null}
        </div>
        {ideas.length ? (
          <div className={styles.ideaGrid}>
            {ideas.map((idea) => (
              <div key={`${idea.market}:${idea.symbol}`} className={styles.ideaCard}>
                <header><span>{idea.market === "US" ? "美股" : "A股"} · {idea.sector} · {idea.audit.lastBarDate}</span><b>{idea.recommendation === "强烈关注" ? "A级候选" : "B级候选"}</b></header>
                <button type="button" onClick={() => onOpenStock(stockRouteKey({ code: idea.symbol, market: idea.market }))}><strong>{idea.name}</strong><small>{idea.symbol} · {idea.signal}</small></button>
                <div><span><small>评分 /100</small><b>{idea.score}</b></span><span><small>风险 /100 ↑</small><b>{idea.risk}</b></span><span><small>风险收益比</small><b>{idea.plan.rewardRisk.toFixed(1)}x</b></span><span><small>成交额</small><b>{idea.amount}</b></span></div>
                <p>模型研究候选，非买入建议。观察 {price(idea.plan.watchLow, idea.currency)}–{price(idea.plan.watchHigh, idea.currency)}；失效/止损参考 {price(idea.plan.stopPrice, idea.currency)}。</p>
                <footer><span>模型 {idea.audit.modelVersion} · 完整度 {idea.audit.completeness}%</span><button type="button" onClick={() => onAddStock({ code: idea.symbol, name: idea.name, market: idea.market, currency: idea.currency, addedAt: new Date().toISOString() })}>＋ 加入自选</button></footer>
              </div>
            ))}
          </div>
        ) : discoveryLoading ? <div className={styles.discoveryLoading}>候选按市场渐进返回，已完成的市场会立即展示…</div> : <EmptyCopy>{Object.values(discovery.errors).filter(Boolean).join("；") || "当前没有同时满足关注等级、风险与赔率门槛的新候选。"}</EmptyCopy>}
        <div className={styles.discoveryFooter}>
          <span>候选不结合你的现金、行业暴露和个人风险预算，因此不提供“建议仓位”。</span>
          <Link href="/screener">打开智能选股 <b aria-hidden="true">→</b></Link>
        </div>
      </article>
    </section>
  );
}

function SummaryKpi({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "warning" | "risk" }) {
  return <article className={tone === "neutral" ? "" : tone === "risk" ? styles.riskKpi : styles.warningKpi}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function PanelHeader({ eyebrow, title, meta }: { eyebrow: string; title: string; meta: string }) {
  return <header className={styles.panelHeader}><div><p>{eyebrow}</p><h3>{title}</h3></div><span>{meta}</span></header>;
}

function EmptyCopy({ children }: { children: React.ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

function ListToggle({ controls, expanded, onClick, expandLabel, collapseLabel }: { controls: string; expanded: boolean; onClick: () => void; expandLabel: string; collapseLabel: string }) {
  return <button className={styles.listToggle} type="button" aria-expanded={expanded} aria-controls={controls} onClick={onClick}>{expanded ? collapseLabel : expandLabel}</button>;
}

function ActionBadge({ action }: { action: PortfolioWorkbenchActionName }) {
  const actionStyle = action === "集中度复核" || action === "数据待核验" ? styles.dataReview
    : action === "止损候选" ? styles.stopLoss
      : action === "止盈候选" ? styles.takeProfit
        : action === "减仓候选" || action === "风险证据复核" ? styles.reduce
          : action === "加仓条件复核" ? styles.add
            : styles.hold;
  return <span className={`${styles.actionBadge} ${actionStyle}`}>{action}</span>;
}

function currencyTotalsText(byCurrency: ReturnType<typeof buildPortfolioWorkbenchDigest>["totals"]["byCurrency"]): string {
  const values = (["CNY", "USD"] as const).flatMap((currency) => byCurrency[currency].marketValue > 0 ? [`${currency} ${money(byCurrency[currency].marketValue, currency)}`] : []);
  return values.length ? `${values.join(" · ")} · 不隐式折算` : "记录成本与股数后显示分币种市值";
}

function newsKpiValue(
  coverage: ReturnType<typeof buildPortfolioWorkbenchDigest>["newsCoverage"],
  attentionCount: number,
  negativeCount: number,
): { value: string; detail: string } {
  if (!coverage.tracked) return { value: "待建立", detail: "添加自选后开始新闻扫描" };
  if (coverage.failed === coverage.tracked) return { value: "不可用", detail: `${coverage.failed} 只新闻扫描失败` };
  if (coverage.loading && !coverage.ready) return { value: "加载中", detail: `${coverage.loading} 只等待新闻结果` };
  if (coverage.failed || coverage.loading) return { value: "部分可用", detail: `${coverage.ready}/${coverage.tracked} 只完成 · ${coverage.failed} 只失败` };
  return attentionCount
    ? { value: `${attentionCount} 条重点`, detail: `${negativeCount} 条负面 · ${coverage.totalItems} 条已扫描` }
    : { value: "0 条重点", detail: coverage.totalItems ? `${coverage.totalItems} 条已扫描，近 14 日无重点` : "扫描完成，未发现可用新闻" };
}

function newsEmptyText(coverage: ReturnType<typeof buildPortfolioWorkbenchDigest>["newsCoverage"]): string {
  if (!coverage.tracked) return "添加自选股后会按股票汇总相关新闻。";
  if (coverage.failed) return "新闻覆盖不完整；请先重试失败股票，当前不能得出“无新闻风险”结论。";
  if (coverage.loading) return "新闻仍在加载，暂不形成风险结论。";
  return "扫描已完成，近 14 日未发现进入重点列表的新闻。";
}

function marketLoadText(status: MarketLoadState): string {
  if (status === "ready") return "已就绪";
  if (status === "error") return "失败";
  if (status === "loading") return "扫描中";
  return "待扫描";
}

function marketName(market: StockMarket): string {
  return market === "US" ? "美股" : "A股";
}

function money(value: number | null, currency: "CNY" | "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: value >= 1000 ? 0 : 2 }).format(value);
}

function price(value: number, currency: "CNY" | "USD"): string {
  return `${currency === "USD" ? "$" : "¥"}${value.toFixed(value >= 100 ? 2 : 3)}`;
}

function percent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
}

function signedPercent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function toneClass(value: number | null): string {
  return value == null || value === 0 ? styles.neutral : value > 0 ? styles.positive : styles.negative;
}
