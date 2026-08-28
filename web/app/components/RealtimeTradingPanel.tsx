"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import KlineViewportControls from "./KlineViewportControls";
import {
  getKlineWheelIntent,
  klineRangeLength,
  normalizeKlineRange,
  normalizeWheelDelta,
  panKlineRange,
  rangeForLatest,
  resolveKlineDragIntent,
  wheelDeltaToKlinePan,
  zoomKlineRange,
  type KlineDragIntent,
  type KlineRange,
} from "../lib/klineViewport";
import type { RealtimeMinuteCandle, RealtimeSnapshot } from "../lib/realtimeMarket";
import { analyzeRealtimeSignals, type RealtimeGuidePoint } from "../lib/realtimeSignals";
import type { StockMarket } from "../lib/security";
import {
  CN_CLOSING_AUCTION_START_MINUTE,
  CN_TRADING_MINUTES,
  cnTradingMinuteOffset,
  cnTradingMinutePhase,
} from "../lib/cnTradingSession";

type LoadState = { phase: "idle" | "loading" | "success" | "error"; detail: string };
type HoverPoint = { index: number; x: number; y: number; price: number };
type DownloadState = { phase: "idle" | "loading" | "success" | "error"; detail: string; requestKey: string };
type RealtimeChartQuote = {
  price: number;
  change: number;
  changePct: number;
  time: string;
  marketStatus: string;
};
type MinuteChartEntry = {
  candle: RealtimeMinuteCandle;
  guide: RealtimeGuidePoint | null;
  index: number;
  minuteOffset: number | null;
};

export default function RealtimeTradingPanel({
  snapshot,
  load,
  market = "CN",
  onRefresh,
}: {
  snapshot: RealtimeSnapshot | null;
  load: LoadState;
  market?: StockMarket;
  onRefresh: () => void;
}) {
  const [download, setDownload] = useState<DownloadState>({ phase: "idle", detail: "", requestKey: "" });
  const imbalance = useMemo(() => {
    if (!snapshot) return null;
    const bid = snapshot.bids.reduce((sum, item) => sum + item.volume, 0);
    const ask = snapshot.asks.reduce((sum, item) => sum + item.volume, 0);
    return bid + ask ? ((bid - ask) / (bid + ask)) * 100 : 0;
  }, [snapshot]);
  const signalAnalysis = useMemo(
    () => analyzeRealtimeSignals(snapshot?.minuteCandles ?? [], snapshot?.date ?? ""),
    [snapshot?.date, snapshot?.minuteCandles],
  );
  const direction = (snapshot?.change ?? 0) >= 0 ? "is-up" : "is-down";
  const refreshLabel = snapshot?.marketStatus === "交易中" ? "1 秒自动刷新" : "15 秒更新快照";
  const snapshotKey = snapshot ? `${snapshot.code}:${snapshot.date}` : "";

  const downloadDailyTrades = async () => {
    if (!snapshot || market !== "CN" || download.phase === "loading") return;
    const requestKey = `${snapshot.code}:${snapshot.date}`;
    setDownload({ phase: "loading", detail: "正在汇总当日全部 L1 成交明细…", requestKey });
    try {
      const response = await fetch("/api/local-stock-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: snapshot.code, name: snapshot.name, date: snapshot.date, previousClose: snapshot.previousClose }),
        cache: "no-store",
      });
      const body = await response.text();
      if (!response.ok) {
        let message = "逐笔成交下载失败";
        try { message = String((JSON.parse(body) as { error?: unknown }).error || message); } catch { /* keep fallback */ }
        throw new Error(message);
      }
      const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${snapshot.code}-${snapshot.date}-level1-trades.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setDownload({ phase: "success", detail: `已下载 ${snapshot.date} 全部 L1 成交明细`, requestKey });
    } catch (reason) {
      setDownload({ phase: "error", detail: reason instanceof Error ? reason.message : "逐笔成交下载失败", requestKey });
    }
  };

  return (
    <section className={`realtime-panel ${snapshot ? "has-data" : "is-empty"}`} id="realtime-trading" aria-live="polite">
      <header className="realtime-header">
        <div>
          <p className="eyebrow">LIVE TRADING DAY</p>
          <h3>{market === "US" ? "美股最新报价" : "当前交易日 · 分钟 K 线与五档盘口"}</h3>
        </div>
        <div className="realtime-header-meta">
          {snapshot ? (
            <>
              <span className={`market-status ${snapshot.marketStatus === "交易中" ? "is-live" : ""}`}><i />{snapshot.marketStatus}</span>
              <span className={`realtime-auto-refresh ${snapshot.marketStatus === "交易中" ? "is-live" : ""}`}><i />{refreshLabel}</span>
              <span>{snapshot.date} {snapshot.time}</span>
            </>
          ) : null}
          {market === "CN" && snapshot ? (
            <button
              className="icon-button realtime-download-button"
              type="button"
              onClick={() => void downloadDailyTrades()}
              disabled={download.phase === "loading"}
              aria-busy={download.phase === "loading"}
              aria-label={download.phase === "loading" ? "正在下载逐笔成交" : "下载逐笔成交"}
              title="下载当前交易日全部 Level-1 成交明细；公开源约 3 秒聚合，不是 Level-2 原始订单"
            >
              ⇩
            </button>
          ) : null}
          <button type="button" onClick={onRefresh} disabled={load.phase === "loading"}>{load.phase === "loading" ? "刷新中…" : "立即刷新"}</button>
          {download.detail && download.requestKey === snapshotKey ? <span className="sr-only" role="status">{download.detail}</span> : null}
        </div>
      </header>

      {snapshot ? (
        <div className="realtime-layout">
          <section className="realtime-chart-card">
            <div className="realtime-quote-strip">
              <RealtimeMetric label="今开" value={snapshot.open.toFixed(3)} />
              <RealtimeMetric label="最高" value={snapshot.high.toFixed(3)} />
              <RealtimeMetric label="最低" value={snapshot.low.toFixed(3)} />
              <RealtimeMetric label="成交量" value={compact(snapshot.volume)} />
              <RealtimeMetric label="成交额" value={compact(snapshot.amount)} />
            </div>
            {snapshot.minuteCandles.length ? <div className="realtime-signal-bar">
              <div className="realtime-signal-legend"><span className="is-buy">B</span>偏多规则 <span style={{ background: "var(--apple-warning)" }}>b</span>弱B观察 <span className="is-sell">S</span>风险规则</div>
              {signalAnalysis.latestSignal ? (
                <strong className={signalAnalysis.latestSignal.guide.confidence === "watch" ? "" : signalAnalysis.latestSignal.guide.type === "buy" ? "is-up" : "is-down"} style={signalAnalysis.latestSignal.guide.confidence === "watch" ? { color: "var(--apple-warning)" } : undefined}>
                  最近 {signalAnalysis.latestSignal.guide.confidence === "watch" ? "b" : signalAnalysis.latestSignal.guide.type === "buy" ? "B" : "S"}{signalAnalysis.latestSignal.guide.score} · {signalAnalysis.latestSignal.time}{signalAnalysis.latestSignal.guide.provisional ? " · 形成中" : ""}
                </strong>
              ) : <span>当前交易日暂无复合 B/S 点</span>}
              <small>规则模型辅助信号，不构成投资建议</small>
            </div> : null}
            <MinuteCandlestickChart
              key={`${snapshot.code}-${snapshot.date}`}
              candles={snapshot.minuteCandles}
              previousClose={snapshot.previousClose}
              guidePoints={signalAnalysis.guidePoints}
              market={market}
              quote={{
                price: snapshot.price,
                change: snapshot.change,
                changePct: snapshot.changePct,
                time: snapshot.time,
                marketStatus: snapshot.marketStatus,
              }}
            />
            <div className="realtime-chart-footer">
              <span>1 分钟 K 线 · {snapshot.minuteCandles.length} 根 · B/S {signalAnalysis.signalCount} 个{market === "CN" ? " · 可下载当日 L1 成交明细" : ""}</span>
              <span title={market === "CN" ? "A 股分时固定显示 09:30–11:30 与 13:00–15:00；电脑悬停、手机点按、方向键均可查看单根分钟 K。" : "普通滚轮滚动页面；Ctrl/⌘ + 滚轮缩放；Shift + 滚轮或横向拖动平移；双击复位；方向键定位。"}>
                {market === "CN" ? <>固定四小时交易轴 · 不缩放<br />电脑悬停 / 手机点按 · ← → 定位</> : <>普通滚轮滚页面 · Ctrl/⌘ + 滚轮缩放<br />Shift + 滚轮/横拖平移 · 双击复位 · ← → 定位</>}
              </span>
              <span title={snapshot.source}>{market === "US" ? "美股延时报价" : "新浪 L1"} · 更新：{formatFetchedAt(snapshot.fetchedAt)}</span>
            </div>
          </section>

          {snapshot.bids.length || snapshot.asks.length ? <aside className="orderbook-card">
            <div className="orderbook-heading">
              <div><strong>五档买卖盘</strong><span>实时委托快照</span></div>
              <span className={(imbalance ?? 0) >= 0 ? "is-up" : "is-down"}>委比 {imbalance == null ? "—" : `${imbalance >= 0 ? "+" : ""}${imbalance.toFixed(1)}%`}</span>
            </div>
            <div className="orderbook-columns"><span>档位</span><span>价格</span><span>委托量</span></div>
            <div className="orderbook-levels asks">
              {[...snapshot.asks].reverse().map((item) => <OrderLevel key={`ask-${item.level}`} side="卖" level={item.level} price={item.price} volume={item.volume} />)}
            </div>
            <div className="orderbook-mid"><strong className={direction}>{snapshot.price.toFixed(3)}</strong><span>昨收 {snapshot.previousClose.toFixed(3)}</span></div>
            <div className="orderbook-levels bids">
              {snapshot.bids.map((item) => <OrderLevel key={`bid-${item.level}`} side="买" level={item.level} price={item.price} volume={item.volume} />)}
            </div>
            <div className="orderbook-totals">
              <div><span>买五合计</span><strong>{compact(snapshot.bids.reduce((sum, item) => sum + item.volume, 0))}</strong></div>
              <div><span>卖五合计</span><strong>{compact(snapshot.asks.reduce((sum, item) => sum + item.volume, 0))}</strong></div>
            </div>
          </aside> : <aside className="orderbook-card"><div className="realtime-empty"><strong>该市场不提供五档委托</strong><p>美股报价源仅返回价格、涨跌和成交统计，未将缺失盘口模拟为真实数据。</p></div></aside>}
        </div>
      ) : (
        <div className={`realtime-empty is-${load.phase}`}>
          <strong>{load.phase === "loading" ? "正在获取当前交易日实时行情" : load.phase === "error" ? "实时行情暂不可用" : "查询股票后显示实时行情"}</strong>
          <p>{load.detail}</p>
        </div>
      )}
    </section>
  );
}

function MinuteCandlestickChart({
  candles,
  previousClose,
  guidePoints,
  quote,
  market,
}: {
  candles: RealtimeMinuteCandle[];
  previousClose: number;
  guidePoints: Array<RealtimeGuidePoint | null>;
  quote: RealtimeChartQuote;
  market: StockMarket;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    range: KlineRange;
    pointerId: number;
    pointerType: string;
    intent: KlineDragIntent;
  } | null>(null);
  const previousTotalRef = useRef(candles.length);
  const [size, setSize] = useState({ width: 960, height: 360 });
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const [range, setRange] = useState(() => rangeForLatest(candles.length, 120));
  const [isDragging, setIsDragging] = useState(false);
  const fixedCnSession = market === "CN";
  const visibleEntries = useMemo<MinuteChartEntry[]>(() => {
    if (fixedCnSession) {
      return candles.flatMap((candle, index) => {
        const minuteOffset = cnTradingMinuteOffset(candle.time);
        return minuteOffset == null ? [] : [{ candle, guide: guidePoints[index] ?? null, index, minuteOffset }];
      });
    }
    return candles.slice(range.from, range.to + 1).map((candle, localIndex) => {
      const index = range.from + localIndex;
      return { candle, guide: guidePoints[index] ?? null, index, minuteOffset: null };
    });
  }, [candles, fixedCnSession, guidePoints, range.from, range.to]);
  const visibleCandles = useMemo(() => visibleEntries.map((entry) => entry.candle), [visibleEntries]);
  const visibleGuides = useMemo(() => visibleEntries.map((entry) => entry.guide), [visibleEntries]);
  const sessionMinuteOffsets = useMemo(
    () => fixedCnSession ? visibleEntries.map((entry) => entry.minuteOffset ?? 0) : undefined,
    [fixedCnSession, visibleEntries],
  );
  const plot = useMemo(
    () => calculatePlot(visibleCandles, previousClose, quote.price, size, sessionMinuteOffsets),
    [previousClose, quote.price, sessionMinuteOffsets, size, visibleCandles],
  );
  const hoveredCandle = hover ? candles[hover.index] : null;
  const hoveredGuide = hover ? guidePoints[hover.index] : null;
  const closingAuctionCandles = useMemo(
    () => fixedCnSession ? candles.filter((candle) => cnTradingMinutePhase(candle.time) === "closing-auction") : [],
    [candles, fixedCnSession],
  );
  const postMarketCandles = useMemo(
    () => fixedCnSession ? candles.filter((candle) => cnTradingMinutePhase(candle.time) === "post-market") : [],
    [candles, fixedCnSession],
  );
  const closingAuction = useMemo(() => summarizeMinuteWindow(closingAuctionCandles), [closingAuctionCandles]);
  const postMarket = useMemo(() => summarizeMinuteWindow(postMarketCandles), [postMarketCandles]);

  useEffect(() => {
    if (fixedCnSession) return;
    const previousTotal = previousTotalRef.current;
    setRange((current) => {
      if (!candles.length) return { from: 0, to: 0 };
      if (!previousTotal || candles.length < previousTotal) return rangeForLatest(candles.length, 120);
      const visibleCount = Math.max(12, klineRangeLength(current));
      return current.to >= previousTotal - 1
        ? rangeForLatest(candles.length, visibleCount)
        : normalizeKlineRange(current, candles.length);
    });
    previousTotalRef.current = candles.length;
  }, [candles.length, fixedCnSession]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setSize({
      width: Math.max(1, entry.contentRect.width),
      height: Math.max(320, entry.contentRect.height),
    }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    const styles = getComputedStyle(document.documentElement);
    const up = styles.getPropertyValue("--apple-rise").trim() || "#f04444";
    const down = styles.getPropertyValue("--apple-fall").trim() || "#1a9c5b";
    const text = styles.getPropertyValue("--apple-tertiary").trim() || "#86868b";
    const grid = styles.getPropertyValue("--apple-border").trim() || "rgba(0,0,0,.08)";
    const surface = styles.getPropertyValue("--apple-elevated").trim() || "#fff";
    const accent = styles.getPropertyValue("--apple-accent").trim() || "#0071e3";
    const warning = styles.getPropertyValue("--apple-warning").trim() || "#ff9f0a";
    if (!visibleCandles.length) {
      context.fillStyle = text;
      context.font = "13px system-ui";
      context.fillText("当前交易日尚无分钟成交数据", 24, 42);
      return;
    }

    const { left, right, top, priceBottom, volumeTop, bottom, plotWidth, min, max, x, y } = plot;
    const plotRight = left + plotWidth;
    if (fixedCnSession) {
      context.save();
      context.globalAlpha = 0.035;
      context.fillStyle = accent;
      context.fillRect(left, top, plotWidth / 2, bottom - top);
      context.globalAlpha = 0.018;
      context.fillStyle = text;
      context.fillRect(left + plotWidth / 2, top, plotWidth / 2, bottom - top);
      const auctionX = left + (CN_CLOSING_AUCTION_START_MINUTE / CN_TRADING_MINUTES) * plotWidth;
      context.globalAlpha = 0.12;
      context.fillStyle = "#e28a18";
      context.fillRect(auctionX, top, plotRight - auctionX, bottom - top);
      context.restore();

      context.save();
      context.strokeStyle = grid;
      context.setLineDash([4, 5]);
      context.beginPath();
      context.moveTo(left + plotWidth / 2, top);
      context.lineTo(left + plotWidth / 2, bottom);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = text;
      context.globalAlpha = 0.72;
      context.font = "600 9px system-ui";
      context.textAlign = "center";
      context.fillText("上午盘", left + plotWidth * 0.25, top + 12);
      context.fillText("下午盘", left + plotWidth * 0.75, top + 12);
      context.fillStyle = "#a96100";
      context.textAlign = "right";
      context.fillText(size.width <= 520 ? "竞价" : "尾盘竞价", plotRight - 4, top + 12);
      context.restore();
    }
    context.font = "11px ui-monospace, Menlo, monospace";
    context.fillStyle = text;
    context.strokeStyle = grid;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left - 0.5, top);
    context.lineTo(left - 0.5, priceBottom);
    context.moveTo(plotRight + 0.5, top);
    context.lineTo(plotRight + 0.5, priceBottom);
    context.stroke();
    for (let step = 0; step <= 4; step += 1) {
      const lineY = top + ((priceBottom - top) / 4) * step;
      const tickPrice = max - ((max - min) / 4) * step;
      const tickChangePct = previousClose > 0 ? ((tickPrice - previousClose) / previousClose) * 100 : 0;
      context.beginPath();
      context.moveTo(left, lineY + 0.5);
      context.lineTo(left + plotWidth, lineY + 0.5);
      context.stroke();
      context.fillStyle = text;
      context.textAlign = "right";
      context.fillText(tickPrice.toFixed(3), left - 13, lineY + 4);
      context.fillStyle = Math.abs(tickChangePct) < 0.005 ? text : tickChangePct > 0 ? up : down;
      context.textAlign = "left";
      context.fillText(`${tickChangePct > 0 ? "+" : ""}${tickChangePct.toFixed(2)}%`, plotRight + 13, lineY + 4);
    }

    const previousY = y(previousClose);
    context.strokeStyle = accent;
    context.globalAlpha = 0.42;
    context.setLineDash([5, 5]);
    context.beginPath();
    context.moveTo(left, previousY);
    context.lineTo(plotRight, previousY);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;
    context.fillStyle = text;
    context.textAlign = "right";
    context.font = "600 9px system-ui";
    context.fillText("昨收 · 0.00%", plotRight - 8, previousY - 6);

    const quoteColor = quote.change >= 0 ? up : down;
    const quoteY = Math.max(top + 10, Math.min(priceBottom - 10, y(quote.price)));
    context.strokeStyle = quoteColor;
    context.globalAlpha = 0.5;
    context.setLineDash([2, 4]);
    context.beginPath();
    context.moveTo(left, quoteY);
    context.lineTo(plotRight, quoteY);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;

    const quoteLeftBadgeX = 7;
    const quoteLeftBadgeWidth = left - 17;
    const quoteRightBadgeX = plotRight + 8;
    const quoteRightBadgeWidth = right - 16;
    context.fillStyle = surface;
    context.fillRect(quoteLeftBadgeX, quoteY - 10, quoteLeftBadgeWidth, 20);
    context.fillRect(quoteRightBadgeX, quoteY - 10, quoteRightBadgeWidth, 20);
    context.strokeStyle = quoteColor;
    context.globalAlpha = 0.62;
    context.strokeRect(quoteLeftBadgeX + 0.5, quoteY - 9.5, quoteLeftBadgeWidth - 1, 19);
    context.strokeRect(quoteRightBadgeX + 0.5, quoteY - 9.5, quoteRightBadgeWidth - 1, 19);
    context.globalAlpha = 1;
    context.fillStyle = quoteColor;
    context.font = "700 10px ui-monospace, Menlo, monospace";
    context.textAlign = "right";
    context.fillText(quote.price.toFixed(3), quoteLeftBadgeX + quoteLeftBadgeWidth - 7, quoteY + 4);
    context.textAlign = "left";
    context.fillText(`${quote.changePct > 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`, quoteRightBadgeX + 7, quoteY + 4);

    const candleStep = fixedCnSession ? plotWidth / CN_TRADING_MINUTES : plotWidth / visibleCandles.length;
    const candleWidth = Math.max(fixedCnSession ? 0.72 : 1.2, Math.min(9, candleStep * (fixedCnSession ? 0.74 : 0.64)));
    visibleCandles.forEach((item, index) => {
      const color = item.close >= item.open ? up : down;
      const candleX = x(index);
      context.strokeStyle = color;
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(candleX, y(item.high));
      context.lineTo(candleX, y(item.low));
      context.stroke();
      const bodyTop = Math.min(y(item.open), y(item.close));
      const bodyHeight = Math.max(1, Math.abs(y(item.open) - y(item.close)));
      if (item.close >= item.open) context.fillRect(candleX - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      else context.strokeRect(candleX - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
    });

    if (fixedCnSession && visibleCandles.length > 1) {
      context.save();
      context.strokeStyle = accent;
      context.globalAlpha = size.width <= 520 ? 0.64 : 0.42;
      context.lineWidth = size.width <= 520 ? 1.15 : 0.9;
      context.beginPath();
      visibleCandles.forEach((item, index) => {
        if (index) context.lineTo(x(index), y(item.close));
        else context.moveTo(x(index), y(item.close));
      });
      context.stroke();
      context.restore();
    }

    const maxVolume = Math.max(...visibleCandles.map((item) => item.volume), 1);
    visibleCandles.forEach((item, index) => {
      const height = (item.volume / maxVolume) * (bottom - volumeTop);
      context.fillStyle = item.close >= item.open ? `${up}99` : `${down}99`;
      context.fillRect(x(index) - candleWidth / 2, bottom - height, candleWidth, height);
    });

    visibleGuides.forEach((guide, index) => {
      if (!guide || !visibleCandles[index]) return;
      const candle = visibleCandles[index];
      const markerX = x(index);
      const markerY = guide.type === "buy"
        ? Math.min(priceBottom - 9, y(candle.low) + 16)
        : Math.max(top + 9, y(candle.high) - 16);
      context.globalAlpha = guide.provisional ? 0.58 : 1;
      const weakBuy = guide.confidence === "watch";
      context.fillStyle = weakBuy ? warning : guide.type === "buy" ? up : down;
      context.beginPath();
      context.arc(markerX, markerY, 8, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
      context.fillStyle = "#fff";
      context.textAlign = "center";
      context.font = "800 8px ui-monospace, Menlo, monospace";
      context.fillText(weakBuy ? "b" : guide.type === "buy" ? "B" : "S", markerX, markerY + 3);
    });

    context.fillStyle = text;
    context.textAlign = "center";
    context.font = "11px ui-monospace, Menlo, monospace";
    if (fixedCnSession) {
      [
        { ratio: 0, label: "09:30", align: "left" as CanvasTextAlign },
        { ratio: 0.25, label: "10:30", align: "center" as CanvasTextAlign },
        { ratio: 0.5, label: size.width <= 420 ? "午休" : "11:30 / 13:00", align: "center" as CanvasTextAlign },
        { ratio: 0.75, label: "14:00", align: "center" as CanvasTextAlign },
        { ratio: 1, label: "15:00", align: "right" as CanvasTextAlign },
      ].forEach(({ ratio, label, align }) => {
        context.textAlign = align;
        context.fillText(label, left + plotWidth * ratio, size.height - 6);
      });
    } else {
      [0, 0.25, 0.5, 0.75, 1].forEach((ratio) => {
        const index = Math.min(visibleCandles.length - 1, Math.round((visibleCandles.length - 1) * ratio));
        context.fillText(visibleCandles[index].time, x(index), size.height - 6);
      });
    }

    const hoverLocalIndex = hover ? visibleEntries.findIndex((entry) => entry.index === hover.index) : -1;
    if (hover && candles[hover.index] && hoverLocalIndex >= 0) {
      context.strokeStyle = accent;
      context.lineWidth = 1;
      context.setLineDash([3, 4]);
      context.beginPath();
      context.moveTo(hover.x, top);
      context.lineTo(hover.x, bottom);
      context.moveTo(left, hover.y);
      context.lineTo(left + plotWidth, hover.y);
      context.stroke();
      context.setLineDash([]);
      const hoverChangePct = previousClose > 0 ? ((hover.price - previousClose) / previousClose) * 100 : 0;
      const leftBadgeX = 7;
      const leftBadgeWidth = left - 17;
      const rightBadgeX = plotRight + 8;
      const rightBadgeWidth = right - 16;
      context.fillStyle = surface;
      context.fillRect(leftBadgeX, hover.y - 10, leftBadgeWidth, 20);
      context.fillRect(rightBadgeX, hover.y - 10, rightBadgeWidth, 20);
      context.strokeStyle = accent;
      context.globalAlpha = 0.55;
      context.strokeRect(leftBadgeX + 0.5, hover.y - 9.5, leftBadgeWidth - 1, 19);
      context.strokeRect(rightBadgeX + 0.5, hover.y - 9.5, rightBadgeWidth - 1, 19);
      context.globalAlpha = 1;
      context.fillStyle = accent;
      context.textAlign = "right";
      context.font = "700 10px ui-monospace, Menlo, monospace";
      context.fillText(hover.price.toFixed(3), leftBadgeX + leftBadgeWidth - 7, hover.y + 4);
      context.textAlign = "left";
      context.fillText(`${hoverChangePct > 0 ? "+" : ""}${hoverChangePct.toFixed(2)}%`, rightBadgeX + 7, hover.y + 4);
    }
  }, [candles, fixedCnSession, hover, plot, previousClose, quote.change, quote.changePct, quote.price, size, visibleCandles, visibleEntries, visibleGuides]);

  const pointFromIndex = (index: number): HoverPoint => {
    const candle = candles[index];
    const localIndex = Math.max(0, visibleEntries.findIndex((entry) => entry.index === index));
    return { index, x: plot.x(localIndex), y: plot.y(candle.close), price: candle.close };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!visibleCandles.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = (event.clientX - rect.left) * (size.width / Math.max(rect.width, 1));
    const pointerY = (event.clientY - rect.top) * (size.height / Math.max(rect.height, 1));
    const localIndex = fixedCnSession
      ? visibleEntries.reduce((closest, _entry, index) => Math.abs(plot.x(index) - pointerX) < Math.abs(plot.x(closest) - pointerX) ? index : closest, 0)
      : Math.max(0, Math.min(visibleCandles.length - 1, Math.floor(((pointerX - plot.left) / Math.max(plot.plotWidth, 1)) * visibleCandles.length)));
    const index = visibleEntries[localIndex]?.index ?? 0;
    const y = Math.max(plot.top, Math.min(plot.priceBottom, pointerY));
    const price = plot.max - ((y - plot.top) / Math.max(plot.priceBottom - plot.top, 1)) * (plot.max - plot.min);
    setHover({ index, x: plot.x(localIndex), y, price });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!visibleEntries.length) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const currentLocal = hover ? visibleEntries.findIndex((entry) => entry.index === hover.index) : visibleEntries.length - 1;
      const localIndex = Math.max(0, Math.min(visibleEntries.length - 1, currentLocal + (event.key === "ArrowRight" ? 1 : -1)));
      setHover(pointFromIndex(visibleEntries[localIndex].index));
    } else if (fixedCnSession) {
      if (event.key === "Escape") setHover(null);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setRange(zoomKlineRange({ range, total: candles.length, deltaY: -120, anchorRatio: 1, minVisible: 12 }));
    } else if (event.key === "-") {
      event.preventDefault();
      setRange(zoomKlineRange({ range, total: candles.length, deltaY: 120, anchorRatio: 1, minVisible: 12 }));
    } else if (event.key === "0") {
      event.preventDefault();
      setRange(rangeForLatest(candles.length, 120));
    }
  };

  const previous = hover && hover.index > 0 ? candles[hover.index - 1].close : previousClose;
  const hoveredChange = hoveredCandle ? hoveredCandle.close - previous : 0;
  const hoveredChangePct = hoveredCandle && previous > 0 ? (hoveredChange / previous) * 100 : 0;
  const quoteDirection = quote.change >= 0 ? "is-up" : "is-down";

  return (
    <div className="realtime-chart-frame">
      <div className={`realtime-canvas-wrap ${fixedCnSession ? "is-fixed-session" : ""} ${isDragging ? "is-dragging" : ""}`} ref={wrapRef}>
        <div
          className="realtime-chart-quote"
          aria-label={`最新价 ${quote.price.toFixed(3)}，涨跌 ${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(3)}，涨跌幅 ${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`}
        >
          <span>{quote.marketStatus} · {quote.time}</span>
          <strong className={quoteDirection}>{quote.price.toFixed(3)}</strong>
          <em className={quoteDirection}>{quote.change >= 0 ? "+" : ""}{quote.change.toFixed(3)} · {quote.changePct >= 0 ? "+" : ""}{quote.changePct.toFixed(2)}%</em>
        </div>
        <canvas
        ref={canvasRef}
        role="img"
        tabIndex={0}
        aria-label={fixedCnSession
          ? `A股当前交易日固定四小时1分钟K线，09:30至11:30、13:00至15:00，最新价${quote.price.toFixed(3)}，涨跌幅${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%，交易时段共${visibleCandles.length}根；尾盘竞价${closingAuction.count}根，15点至16点盘后${postMarket.count}根；可悬停、点按或用左右方向键查看`
          : `当前交易日1分钟K线，最新价${quote.price.toFixed(3)}，涨跌幅${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%，共${candles.length}根，当前显示第${range.from + 1}至${range.to + 1}根；按住 Ctrl 或 Command 并滚轮缩放，Shift 加滚轮或横向拖动平移，也可用键盘操作`}
        style={{ touchAction: "pan-y pinch-zoom" }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          if (fixedCnSession) {
            if (event.pointerType === "touch") {
              dragRef.current = {
                x: event.clientX,
                y: event.clientY,
                range,
                pointerId: event.pointerId,
                pointerType: event.pointerType,
                intent: "pending",
              };
            }
            return;
          }
          const intent = event.pointerType === "touch" ? "pending" : "horizontal";
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            range,
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            intent,
          };
          if (intent === "horizontal") {
            event.currentTarget.setPointerCapture(event.pointerId);
            setIsDragging(true);
            setHover(null);
          }
        }}
        onPointerMove={(event) => {
          if (fixedCnSession) {
            if (dragRef.current?.pointerId === event.pointerId && dragRef.current.intent === "pending") {
              dragRef.current.intent = resolveKlineDragIntent(
                event.clientX - dragRef.current.x,
                event.clientY - dragRef.current.y,
              );
              return;
            }
            if (event.pointerType !== "touch") handlePointerMove(event);
            return;
          }
          if (!dragRef.current || !visibleCandles.length) return handlePointerMove(event);
          if (dragRef.current.pointerId !== event.pointerId) return;
          if (dragRef.current.intent === "pending") {
            dragRef.current.intent = resolveKlineDragIntent(
              event.clientX - dragRef.current.x,
              event.clientY - dragRef.current.y,
            );
            if (dragRef.current.intent === "horizontal") {
              event.currentTarget.setPointerCapture(event.pointerId);
              setIsDragging(true);
              setHover(null);
            }
          }
          if (dragRef.current.intent !== "horizontal") return;
          const rect = event.currentTarget.getBoundingClientRect();
          const candleWidth = (plot.plotWidth / visibleCandles.length) * (rect.width / Math.max(size.width, 1));
          const delta = Math.round((dragRef.current.x - event.clientX) / Math.max(candleWidth, 1));
          setRange(panKlineRange(dragRef.current.range, candles.length, delta));
        }}
        onPointerUp={(event) => {
          if (fixedCnSession) {
            const gesture = dragRef.current;
            dragRef.current = null;
            if (event.pointerType !== "touch" || gesture?.intent === "pending") handlePointerMove(event);
            return;
          }
          const pointerType = dragRef.current?.pointerType;
          dragRef.current = null;
          setIsDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          if (pointerType !== "touch") handlePointerMove(event);
        }}
        onPointerCancel={() => { dragRef.current = null; setIsDragging(false); }}
        onLostPointerCapture={() => { dragRef.current = null; setIsDragging(false); }}
        onPointerLeave={() => { if (!dragRef.current) setHover(null); }}
        onWheel={(event) => {
          if (fixedCnSession) return;
          const wheelIntent = getKlineWheelIntent(event);
          if (wheelIntent === "page") return;
          event.preventDefault();
          const wheelDelta = wheelIntent === "pan" && Math.abs(event.deltaX) > Math.abs(event.deltaY)
            ? event.deltaX
            : event.deltaY;
          const delta = normalizeWheelDelta(wheelDelta, event.deltaMode, size.height);
          if (wheelIntent === "pan") {
            const candleDelta = wheelDeltaToKlinePan(delta, visibleCandles.length);
            if (candleDelta) setRange(panKlineRange(range, candles.length, candleDelta));
            setHover(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const pointerX = (event.clientX - rect.left) * (size.width / Math.max(rect.width, 1));
          setRange(zoomKlineRange({
            range,
            total: candles.length,
            deltaY: delta,
            anchorRatio: (pointerX - plot.left) / Math.max(plot.plotWidth, 1),
            minVisible: 12,
          }));
          setHover(null);
        }}
        onDoubleClick={() => { if (!fixedCnSession) setRange(rangeForLatest(candles.length, 120)); setHover(null); }}
        onFocus={() => { if (!hover && visibleEntries.length) setHover(pointFromIndex(visibleEntries.at(-1)?.index ?? 0)); }}
        onKeyDown={handleKeyDown}
        />
        {hover && hoveredCandle ? (
          <div
            className="realtime-hover-card"
            role="status"
            style={{
              ...(hover.x < size.width / 2 ? { right: 90 } : { left: 8 }),
              top: Math.min(size.height - 176, Math.max(plot.top + 8, hover.y - 48)),
            }}
          >
            <header><strong>{hoveredCandle.time}</strong><span className={hoveredChange >= 0 ? "is-up" : "is-down"}>{hoveredChange >= 0 ? "+" : ""}{hoveredChange.toFixed(3)} · {hoveredChangePct >= 0 ? "+" : ""}{hoveredChangePct.toFixed(2)}%</span></header>
            <div><span>开 <b>{hoveredCandle.open.toFixed(3)}</b></span><span>高 <b>{hoveredCandle.high.toFixed(3)}</b></span><span>低 <b>{hoveredCandle.low.toFixed(3)}</b></span><span>收 <b>{hoveredCandle.close.toFixed(3)}</b></span></div>
            <footer><span>量 {compact(hoveredCandle.volume)}</span><span>额 {compact(hoveredCandle.amount)}</span></footer>
            {hoveredGuide ? <p className={hoveredGuide.confidence === "watch" ? "" : hoveredGuide.type === "buy" ? "is-up" : "is-down"} style={hoveredGuide.confidence === "watch" ? { color: "var(--apple-warning)" } : undefined}><b>{hoveredGuide.confidence === "watch" ? "b" : hoveredGuide.type === "buy" ? "B" : "S"}{hoveredGuide.score}</b> {hoveredGuide.reasons.join(" · ")}{hoveredGuide.provisional ? " · 形成中" : ""}</p> : null}
          </div>
        ) : null}
      </div>
      {fixedCnSession ? (
        <>
          <div className="realtime-chart-control-dock is-session-fixed">
            <div className="realtime-session-dock" aria-label="A股固定四小时交易轴">
              <span><i className="is-morning" />上午 09:30–11:30</span>
              <span><i className="is-afternoon" />下午 13:00–15:00</span>
              <span><i className="is-auction" />尾盘竞价 14:57–15:00</span>
              <strong>固定 240 分钟 · 不缩放</strong>
            </div>
          </div>
          <div className="realtime-session-summary" aria-label="尾盘竞价和15点至16点盘后交易情况">
            <article className="is-auction">
              <span>尾盘竞价 · 14:57–15:00</span>
              <strong>{closingAuction.last ? closingAuction.last.close.toFixed(3) : "尚无成交"}</strong>
              <small>{closingAuction.count ? `${closingAuction.count} 根分钟 K · 量 ${compact(closingAuction.volume)} · 额 ${compact(closingAuction.amount)}` : "等待数据源返回竞价成交"}</small>
            </article>
            <article className="is-post-market">
              <span>盘后观察 · 15:00–16:00</span>
              <strong>{postMarket.last ? postMarket.last.close.toFixed(3) : "暂无逐分钟成交"}</strong>
              <small>{postMarket.count ? `${postMarket.count} 根真实分钟 K · 量 ${compact(postMarket.volume)}` : "不补齐虚拟 K 线；仅展示数据源实际返回成交"}</small>
            </article>
          </div>
        </>
      ) : (
        <div className="realtime-chart-control-dock">
          <span>视窗缩放</span>
          <KlineViewportControls className="is-inline is-apple realtime-kline-controls" range={range} total={candles.length} minVisible={12} resetVisible={120} onRangeChange={(next) => { setRange(next); setHover(null); }} />
        </div>
      )}
    </div>
  );
}

function calculatePlot(
  candles: RealtimeMinuteCandle[],
  previousClose: number,
  currentPrice: number,
  size: { width: number; height: number },
  sessionMinuteOffsets?: number[],
) {
  const mobileWidth = size.width <= 520;
  const stackedHeader = size.width < 360;
  const fixedSession = Array.isArray(sessionMinuteOffsets);
  const left = mobileWidth ? 58 : 72;
  const right = mobileWidth ? 64 : 82;
  const top = fixedSession ? 78 : stackedHeader ? 142 : 74;
  const priceBottom = Math.round(size.height * 0.76);
  const volumeTop = priceBottom + 22;
  const bottom = size.height - 28;
  const plotWidth = Math.max(1, size.width - left - right);
  let min = Math.min(previousClose, currentPrice, ...candles.map((item) => item.low));
  let max = Math.max(previousClose, currentPrice, ...candles.map((item) => item.high));
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = previousClose * 0.99; max = previousClose * 1.01; }
  const padding = Math.max((max - min) * 0.1, max * 0.002);
  min -= padding;
  max += padding;
  const x = (index: number) => {
    if (!fixedSession) return left + ((index + 0.5) / Math.max(candles.length, 1)) * plotWidth;
    const halfMinute = plotWidth / CN_TRADING_MINUTES / 2;
    const raw = left + ((sessionMinuteOffsets[index] ?? 0) / CN_TRADING_MINUTES) * plotWidth;
    return Math.max(left + halfMinute, Math.min(left + plotWidth - halfMinute, raw));
  };
  const y = (price: number) => top + ((max - price) / Math.max(max - min, 0.0001)) * (priceBottom - top);
  return { left, right, top, priceBottom, volumeTop, bottom, plotWidth, min, max, x, y };
}

function summarizeMinuteWindow(candles: RealtimeMinuteCandle[]) {
  return {
    count: candles.length,
    last: candles.at(-1) ?? null,
    volume: candles.reduce((sum, candle) => sum + candle.volume, 0),
    amount: candles.reduce((sum, candle) => sum + candle.amount, 0),
  };
}

function RealtimeMetric({ label, value }: { label: string; value: string }) {
  return <div className="realtime-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function OrderLevel({ side, level, price, volume }: { side: "买" | "卖"; level: number; price: number; volume: number }) {
  return <div><span className={side === "买" ? "is-up" : "is-down"}>{side}{level}</span><strong>{price ? price.toFixed(3) : "—"}</strong><em>{volume ? compact(volume) : "—"}</em></div>;
}

function compact(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function formatFetchedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("zh-CN", { hour12: false });
}
