"use client";

import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { compactNumber, formatNumber, type Candle, type IntentAnalysis } from "../../lib/market";
import { calculateHoldingMetrics, type StockHolding, type StockHoldings } from "../../lib/holdings";
import { currencyOf, marketOf, stockStorageKey, type StockCurrency } from "../../lib/security";
import type { WatchlistStock } from "../../lib/watchlist";
import type { NextDayPredictionReport } from "../../lib/nextDayPrediction";
import type { StockScoreReport } from "../../lib/stockScore";
import { buildPortfolioPredictionConclusion } from "../../lib/portfolioPrediction";
import { formatCapitalAmount } from "../../lib/portfolioPresentation";
import type { PortfolioQuote, QuoteStatus } from "./types";
import { formatCurrency, signedCurrency, signedPercent, probabilityPercent, formatShares, currencyName } from "./formatting";
import styles from "./PortfolioStockList.module.css";

type PortfolioStockListProps = {
  view: "watchlist" | "holdings";
  stocks: WatchlistStock[];
  quotes: Record<string, PortfolioQuote>;
  holdings: StockHoldings;
  emptyQuote: PortfolioQuote;
  onOpen: (stock: WatchlistStock) => void;
  onOpenPrediction: (stock: WatchlistStock) => void;
  onEdit: (stock: WatchlistStock) => void;
  onRemove: (stock: WatchlistStock) => void;
  onRetry: (stock: WatchlistStock) => void;
};

export default function PortfolioStockList({ view, stocks, quotes, holdings, emptyQuote, onOpen, onOpenPrediction, onEdit, onRemove, onRetry }: PortfolioStockListProps) {
  return <div className={styles.stockList} data-view={view}>
    <div className={styles.columnHeader} aria-hidden="true">
      <span>股票</span><span>最新价 / 涨跌</span>
      {view === "watchlist" ? <><span>明日预测结论</span><span>近 60 日趋势</span><span>资金净流（本币）</span></> : <><span>持仓 / 市值</span><span>累计收益</span><span>今日持仓盈亏</span></>}
      <span>操作</span>
    </div>
    {stocks.map((stock) => <PortfolioRow
      key={stockStorageKey(stock)}
      stock={stock}
      quote={quotes[stockStorageKey(stock)] ?? emptyQuote}
      holding={holdings[stockStorageKey(stock)] ?? null}
      view={view}
      onOpen={() => onOpen(stock)}
      onOpenPrediction={() => onOpenPrediction(stock)}
      onEdit={() => onEdit(stock)}
      onRemove={view === "watchlist" ? () => onRemove(stock) : undefined}
      onRetry={() => onRetry(stock)}
    />)}
  </div>;
}

function PortfolioRow({ stock, quote, holding, view, onOpen, onOpenPrediction, onEdit, onRemove, onRetry }: {
  stock: WatchlistStock; quote: PortfolioQuote; holding: StockHolding | null; view: "watchlist" | "holdings";
  onOpen: () => void; onOpenPrediction: () => void; onEdit: () => void; onRemove?: () => void; onRetry: () => void;
}) {
  const currency = currencyOf(stock);
  const metrics = holding ? calculateHoldingMetrics(holding.shares, holding.cost, quote.price) : null;
  const dayProfit = holding && quote.change != null ? holding.shares * quote.change : null;
  const tone = toneClass(quote.changePct);
  const predictionCell = (
    <WatchlistScoreBadge
        prediction={quote.prediction}
        predictionStatus={quote.predictionStatus}
        scoreReport={quote.score}
        stockName={stock.name}
        hasHolding={Boolean(holding)}
        onOpen={onOpenPrediction}
        onEdit={onEdit}
      />
  );
  const capitalCell = (
    <CapitalFlowCell intent={quote.intent} quoteDate={quote.date} loading={quote.status === "loading"} currency={currency} />
  );
  const holdingCell = (
    <div className={styles.holdingCell}>
        <span className={styles.cellLabel}>持仓 / 市值</span>
        {holding ? <><strong>{formatShares(holding.shares)}</strong><span>市值 {metrics ? formatCurrency(metrics.marketValue, currency) : "—"}</span><small>成本 {currency === "USD" ? "$" : "¥"}{formatNumber(holding.cost, 3)}</small></> : <><strong>未设置</strong><span>记录后显示盈亏</span><button type="button" onClick={onEdit}>＋ 添加持仓</button></>}
      </div>
  );
  const profitCell = (
    <div className={styles.profitCell}>
        <span className={styles.cellLabel}>累计收益</span>
        <strong className={toneClass(metrics?.profit)}>{metrics ? signedCurrency(metrics.profit, currency) : "—"}</strong>
        <span className={toneClass(metrics?.profitPct)}>{metrics ? signedPercent(metrics.profitPct) : "暂无持仓"}</span>
      </div>
  );
  const chartCell = (
    <div className={styles.klineCell}>
        {quote.status === "loading" && !quote.candles.length ? <div className={styles.chartSkeleton} /> : quote.candles.length ? <MiniKline candles={quote.candles.slice(-60)} /> : <span className={styles.noChart}>K 线待更新</span>}
        <small>{quote.date ? `${quote.date.slice(5)} · ${quote.source}` : "近 60 日"}</small>
      </div>
  );
  return <article className={styles.stockRow} data-view={view}>
    <div className={styles.primaryRow}>
      <button className={styles.stockIdentity} type="button" aria-label={`打开 ${stock.name} ${stock.code} 的股票分析`} onClick={onOpen}>
        <span className={styles.stockAvatar}>{stock.name.slice(0, 1)}</span>
        <span className={styles.stockIdentityText}><strong>{stock.name}</strong><small>{stock.code} · {marketOf(stock) === "US" ? "美股" : "A股"}</small><em className={quote.marketStatus === "交易中" ? styles.live : ""}>{quote.marketStatus}</em></span>
      </button>
      <div className={styles.priceCell}>
        {quote.status === "error" ? <button className={styles.retryLink} type="button" onClick={onRetry}>重试行情</button> : <strong>{quote.price == null ? "—" : formatNumber(quote.price, quote.price >= 100 ? 2 : 3)}</strong>}
        <span className={tone}>{quote.change == null || quote.changePct == null ? "—" : `${quote.change >= 0 ? "+" : ""}${formatNumber(quote.change, 3)}  ${signedPercent(quote.changePct)}`}</span>
        {quote.error ? <small title={quote.error}>{quote.error}</small> : null}
      </div>
      {view === "watchlist" ? <>{predictionCell}{chartCell}{capitalCell}</> : <>{holdingCell}{profitCell}<div className={styles.dayProfitCell}><span className={styles.cellLabel}>今日持仓盈亏</span><strong className={toneClass(dayProfit)}>{dayProfit == null ? "—" : signedCurrency(dayProfit, currency)}</strong><small>当日持仓估算</small></div></>}
      <div className={styles.rowActions}>
        <button type="button" onClick={onEdit} aria-label={`编辑 ${stock.name} 的持仓`} title="编辑持仓"><EditIcon /></button>
        {onRemove ? <button type="button" onClick={onRemove} aria-label={`移除 ${stock.name}`} title="移除自选"><TrashIcon /></button> : null}
        <span aria-hidden="true">›</span>
      </div>
    </div>
    <details className={styles.rowDetails}>
      <summary>{view === "watchlist" ? "持仓与今日行情" : "预测、趋势与今日行情"}</summary>
      <div className={styles.detailGrid}>
        {view === "watchlist" ? <>
          <section className={styles.detailItem}><h3>持仓 / 市值</h3>{holdingCell}</section>
          <section className={styles.detailItem}><h3>累计收益</h3>{profitCell}</section>
        </> : <>
          <section className={styles.detailItem}><h3>明日预测结论</h3>{predictionCell}</section>
          <section className={styles.detailItem}><h3>近 60 日趋势</h3>{chartCell}</section>
          <section className={styles.detailItem}><h3>资金净流（本币）</h3>{capitalCell}</section>
        </>}
        <section className={styles.detailItem}><h3>今日行情</h3>
      <div className={styles.marketCell}>
        <div><span>高 / 低</span><strong>{quote.high == null || quote.low == null ? "—" : `${formatNumber(quote.high, 2)} / ${formatNumber(quote.low, 2)}`}</strong></div>
        <div><span>量 / 换手</span><strong>{quote.volume == null ? "—" : `${compactNumber(quote.volume)} / ${quote.turnoverPct == null ? "—" : `${formatNumber(quote.turnoverPct, 2)}%`}`}</strong></div>
        {dayProfit != null ? <small className={toneClass(dayProfit)}>今日持仓 {signedCurrency(dayProfit, currency)}</small> : null}
      </div>
        </section>
      </div>
    </details>
  </article>;
}

function CapitalFlowCell({ intent, quoteDate, loading, currency }: { intent: IntentAnalysis | null; quoteDate: string; loading: boolean; currency: StockCurrency }) {
  if (!intent) {
    return <div className={styles.capitalCell}><span>今日资金</span><strong>—</strong><small>{loading ? "估算中" : "暂无可用数据"}</small></div>;
  }
  const direction = intent.activeNetAmount > 0 ? "流入" : intent.activeNetAmount < 0 ? "流出" : "持平";
  const basisLabel = intent.basis === "level1" ? "主动买卖估算" : "量价模型估算";
  const periodLabel = !quoteDate || intent.date === quoteDate ? "今日" : intent.date.slice(5);
  return (
    <div className={styles.capitalCell} title={`${basisLabel} · 置信度 ${intent.confidence}% · ${intent.label}`}>
      <span>{periodLabel}{intent.basis === "level1" ? "主动净额" : "量价净额"}</span>
      <strong className={toneClass(intent.activeNetAmount)}>{direction} {formatCapitalAmount(intent.activeNetAmount, currency)}</strong>
      <small>{currencyName(currency)}口径 · {basisLabel} · 置信 {intent.confidence}%</small>
    </div>
  );
}

function WatchlistScoreBadge({
  prediction,
  predictionStatus,
  scoreReport,
  stockName,
  hasHolding,
  onOpen,
  onEdit,
}: {
  prediction: NextDayPredictionReport | null;
  predictionStatus: QuoteStatus;
  scoreReport: StockScoreReport | null;
  stockName: string;
  hasHolding: boolean;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();
  const isMobilePopover = () => window.matchMedia("(max-width: 820px)").matches;
  const closeMobilePopover = () => {
    setDetailsVisible(false);
    anchorRef.current?.querySelector("button")?.focus({ preventScroll: true });
  };
  const conclusion = prediction ? buildPortfolioPredictionConclusion(prediction) : null;
  const predictionToneClass = conclusion ? {
    hold: styles.predictionHold,
    reduce: styles.predictionReduce,
    takeProfit: styles.predictionTakeProfit,
    stopLoss: styles.predictionStopLoss,
  }[conclusion.tone] : styles.predictionHold;

  const showDetails = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(330, window.innerWidth - 24);
      const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
      const top = rect.bottom + 9 + 430 > window.innerHeight ? Math.max(12, rect.top - 439) : rect.bottom + 9;
      setPopoverPosition({ left, top });
    }
    setDetailsVisible(true);
  };

  return (
    <div
      ref={anchorRef}
      className={styles.scoreCell}
      onMouseEnter={() => { if (!isMobilePopover()) showDetails(); }}
      onMouseLeave={() => { if (!isMobilePopover()) setDetailsVisible(false); }}
      onFocusCapture={() => { if (!isMobilePopover()) showDetails(); }}
      onBlurCapture={() => { if (!isMobilePopover()) setDetailsVisible(false); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && isMobilePopover() && detailsVisible) {
          event.stopPropagation();
          closeMobilePopover();
        }
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {prediction && conclusion ? (
        <button
          className={`${styles.scoreBadge} ${predictionToneClass}`}
          type="button"
          aria-describedby={detailsVisible ? popoverId : undefined}
          aria-expanded={detailsVisible}
          aria-label={`${stockName} 明日预测结论：${conclusion.action}，上涨概率 ${probabilityPercent(prediction.prediction.upProbability)}，决策可信度 ${prediction.signal.decisionConfidence}%`}
          onClick={() => {
            if (!isMobilePopover()) return;
            if (detailsVisible) setDetailsVisible(false);
            else showDetails();
          }}
          onPointerUp={(event) => {
            if (event.pointerType !== "touch" || isMobilePopover()) return;
            if (detailsVisible) setDetailsVisible(false);
            else showDetails();
          }}
        >
          <b className={styles.signalMark} aria-hidden="true">{conclusion.mark}</b>
          <span><strong>{conclusion.action}</strong><small>上涨 {probabilityPercent(prediction.prediction.upProbability)} · 可信 {prediction.signal.decisionConfidence}%</small></span>
        </button>
      ) : (
        <div className={`${styles.scoreSkeleton} ${predictionStatus === "error" ? styles.predictionUnavailable : ""}`}>
          <i />
          <span>{predictionStatus === "error" ? "预测暂不可用" : "预测计算中"}</span>
        </div>
      )}
      <div className={styles.signalActions}>
        <button type="button" onClick={onOpen} aria-label={`查看 ${stockName} 的完整明日预测依据`}>完整预测</button>
        <button type="button" onClick={onEdit} aria-label={`${hasHolding ? "调整" : "记录"} ${stockName} 的持仓`}>{hasHolding ? "调持仓" : "记持仓"}</button>
      </div>
      {detailsVisible && prediction && conclusion && popoverPosition ? createPortal((
        <div className={styles.scorePopover} id={popoverId} role={isMobilePopover() ? "region" : "tooltip"} aria-label={isMobilePopover() ? `${stockName} 预测说明` : undefined} style={popoverPosition}>
          <button className={styles.scorePopoverClose} type="button" onClick={closeMobilePopover}>关闭预测说明</button>
          <header><div><span>NEXT SESSION PREDICTION</span><strong>{stockName} · {prediction.target.label}</strong></div><b>{conclusion.action}</b></header>
          <p>{prediction.decisionSupport.summary}</p>
          <div className={styles.predictionMetrics}>
            <div><span>上涨概率</span><strong>{probabilityPercent(prediction.prediction.upProbability)}</strong></div>
            <div><span>预期收盘</span><strong>{signedPercent(prediction.prediction.expectedCloseReturn * 100)}</strong></div>
            <div><span>决策可信度</span><strong>{prediction.signal.decisionConfidence}%</strong></div>
            <div><span>模型一致度</span><strong>{probabilityPercent(prediction.signal.ensembleAgreement)}</strong></div>
          </div>
          <div className={styles.predictionLevels}>
            <span>止盈观察 <strong>{formatNumber(prediction.decisionSupport.takeProfitReference, 2)}</strong></span>
            <span>风险观察 <strong>{formatNumber(prediction.decisionSupport.riskReference, 2)}</strong></span>
          </div>
          <ul className={styles.predictionChecks}>{prediction.decisionSupport.checks.map((check) => <li key={check}>{check}</li>)}</ul>
          <footer>
            截至 {prediction.asOf} {prediction.asOfTime} · {prediction.externalContext.market.available ? "大盘已覆盖" : "大盘缺失"} · {prediction.externalContext.news.itemCount ? `${prediction.externalContext.news.itemCount} 条消息` : "消息缺失"} · {prediction.modelValidation.panelEnabled ? "面板 ML" : prediction.modelValidation.mlEnabled ? "个股 ML" : "统计模型"} · 综合研究 {scoreReport?.score ?? "—"} 分
          </footer>
        </div>
      ), document.body) : null}
    </div>
  );
}

function MiniKline({ candles }: { candles: Candle[] }) {
  const width = 176;
  const height = 56;
  const padding = 3;
  const minimum = Math.min(...candles.map((candle) => candle.low));
  const maximum = Math.max(...candles.map((candle) => candle.high));
  const range = Math.max(maximum - minimum, 0.001);
  const step = (width - padding * 2) / Math.max(candles.length, 1);
  const y = (value: number) => padding + ((maximum - value) / range) * (height - padding * 2);
  const bodyWidth = Math.max(1, Math.min(2.4, step * 0.62));
  return (
    <svg className={styles.miniKline} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`近 ${candles.length} 日 K 线`} preserveAspectRatio="none">
      <line className={styles.midline} x1="0" y1={height / 2} x2={width} y2={height / 2} />
      {candles.map((candle, index) => {
        const x = padding + step * index + step / 2;
        const up = candle.close >= candle.open;
        const bodyY = Math.min(y(candle.open), y(candle.close));
        const bodyHeight = Math.max(1, Math.abs(y(candle.open) - y(candle.close)));
        return (
          <g key={candle.key} className={up ? styles.candleUp : styles.candleDown}>
            <line x1={x} y1={y(candle.high)} x2={x} y2={y(candle.low)} />
            <rect x={x - bodyWidth / 2} y={bodyY} width={bodyWidth} height={bodyHeight} rx="0.4" />
          </g>
        );
      })}
    </svg>
  );
}

function toneClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return styles.neutral;
  return value > 0 ? styles.positive : styles.negative;
}

function EditIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.8 4.1 3.1 3.1M4 16l.8-3.6 8.4-8.4a1.3 1.3 0 0 1 1.8 0l1 1a1.3 1.3 0 0 1 0 1.8l-8.4 8.4L4 16Z" /></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6.2h11M8 3.7h4M6.2 6.2l.6 9.1c0 .6.5 1 1.1 1h4.2c.6 0 1.1-.4 1.1-1l.6-9.1M8.4 8.7v4.8m3.2-4.8v4.8" /></svg>;
}
