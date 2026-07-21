"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeMinuteCandle, RealtimeSnapshot } from "../lib/realtimeMarket";
import { analyzeRealtimeSignals, type RealtimeGuidePoint } from "../lib/realtimeSignals";

type LoadState = { phase: "idle" | "loading" | "success" | "error"; detail: string };
type HoverPoint = { index: number; x: number; y: number; price: number };

export default function RealtimeTradingPanel({
  snapshot,
  load,
  onRefresh,
}: {
  snapshot: RealtimeSnapshot | null;
  load: LoadState;
  onRefresh: () => void;
}) {
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
  const refreshLabel = snapshot?.marketStatus === "交易中" ? "5 秒自动刷新" : "15 秒更新快照";

  return (
    <section className="realtime-panel" id="realtime-trading" aria-live="polite">
      <header className="realtime-header">
        <div>
          <p className="eyebrow">LIVE TRADING DAY</p>
          <h3>当前交易日 · 分钟 K 线与五档盘口</h3>
        </div>
        <div className="realtime-header-meta">
          {snapshot ? (
            <>
              <span className={`market-status ${snapshot.marketStatus === "交易中" ? "is-live" : ""}`}><i />{snapshot.marketStatus}</span>
              <span className={`realtime-auto-refresh ${snapshot.marketStatus === "交易中" ? "is-live" : ""}`}><i />{refreshLabel}</span>
              <span>{snapshot.date} {snapshot.time}</span>
            </>
          ) : null}
          <button type="button" onClick={onRefresh} disabled={load.phase === "loading"}>{load.phase === "loading" ? "刷新中…" : "立即刷新"}</button>
        </div>
      </header>

      {snapshot ? (
        <div className="realtime-layout">
          <section className="realtime-chart-card">
            <div className="realtime-quote-strip">
              <div>
                <span>最新</span>
                <strong className={direction}>{snapshot.price.toFixed(3)}</strong>
                <small className={direction}>{snapshot.change >= 0 ? "+" : ""}{snapshot.change.toFixed(3)} · {snapshot.changePct >= 0 ? "+" : ""}{snapshot.changePct.toFixed(2)}%</small>
              </div>
              <RealtimeMetric label="今开" value={snapshot.open.toFixed(3)} />
              <RealtimeMetric label="最高" value={snapshot.high.toFixed(3)} />
              <RealtimeMetric label="最低" value={snapshot.low.toFixed(3)} />
              <RealtimeMetric label="成交量" value={compact(snapshot.volume)} />
              <RealtimeMetric label="成交额" value={compact(snapshot.amount)} />
            </div>
            <div className="realtime-signal-bar">
              <div className="realtime-signal-legend"><span className="is-buy">B</span>买入观察 <span className="is-sell">S</span>卖出观察</div>
              {signalAnalysis.latestSignal ? (
                <strong className={signalAnalysis.latestSignal.guide.type === "buy" ? "is-up" : "is-down"}>
                  最近 {signalAnalysis.latestSignal.guide.type === "buy" ? "B" : "S"}{signalAnalysis.latestSignal.guide.score} · {signalAnalysis.latestSignal.time}{signalAnalysis.latestSignal.guide.provisional ? " · 形成中" : ""}
                </strong>
              ) : <span>当前交易日暂无复合 B/S 点</span>}
              <small>规则模型辅助信号，不构成投资建议</small>
            </div>
            <MinuteCandlestickChart
              candles={snapshot.minuteCandles}
              previousClose={snapshot.previousClose}
              guidePoints={signalAnalysis.guidePoints}
            />
            <div className="realtime-chart-footer">
              <span>1 分钟 K 线 · {snapshot.minuteCandles.length} 根 · B/S {signalAnalysis.signalCount} 个</span>
              <span>鼠标悬浮查看坐标 · ← → 键逐根定位</span>
              <span title={snapshot.source}>新浪 L1 · 更新：{formatFetchedAt(snapshot.fetchedAt)}</span>
            </div>
          </section>

          <aside className="orderbook-card">
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
          </aside>
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
}: {
  candles: RealtimeMinuteCandle[];
  previousClose: number;
  guidePoints: Array<RealtimeGuidePoint | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 960, height: 360 });
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const plot = useMemo(() => calculatePlot(candles, previousClose, size), [candles, previousClose, size]);
  const hoveredCandle = hover ? candles[hover.index] : null;
  const hoveredGuide = hover ? guidePoints[hover.index] : null;

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setSize({
      width: Math.max(560, entry.contentRect.width),
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
    if (!candles.length) {
      context.fillStyle = text;
      context.font = "13px system-ui";
      context.fillText("当前交易日尚无分钟成交数据", 24, 42);
      return;
    }

    const { left, right, top, priceBottom, volumeTop, bottom, plotWidth, min, max, x, y } = plot;
    context.font = "11px ui-monospace, Menlo, monospace";
    context.fillStyle = text;
    context.strokeStyle = grid;
    context.lineWidth = 1;
    context.textAlign = "left";
    for (let step = 0; step <= 4; step += 1) {
      const lineY = top + ((priceBottom - top) / 4) * step;
      context.beginPath();
      context.moveTo(left, lineY + 0.5);
      context.lineTo(left + plotWidth, lineY + 0.5);
      context.stroke();
      context.fillText((max - ((max - min) / 4) * step).toFixed(3), left + plotWidth + 9, lineY + 4);
    }

    const previousY = y(previousClose);
    context.strokeStyle = text;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(left, previousY);
    context.lineTo(left + plotWidth, previousY);
    context.stroke();
    context.setLineDash([]);

    const candleWidth = Math.max(1, Math.min(6, (plotWidth / candles.length) * 0.66));
    candles.forEach((item, index) => {
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

    const maxVolume = Math.max(...candles.map((item) => item.volume), 1);
    candles.forEach((item, index) => {
      const height = (item.volume / maxVolume) * (bottom - volumeTop);
      context.fillStyle = item.close >= item.open ? `${up}99` : `${down}99`;
      context.fillRect(x(index) - candleWidth / 2, bottom - height, candleWidth, height);
    });

    guidePoints.forEach((guide, index) => {
      if (!guide || !candles[index]) return;
      const candle = candles[index];
      const markerX = x(index);
      const markerY = guide.type === "buy"
        ? Math.min(priceBottom - 9, y(candle.low) + 16)
        : Math.max(top + 9, y(candle.high) - 16);
      context.globalAlpha = guide.provisional ? 0.58 : 1;
      context.fillStyle = guide.type === "buy" ? up : down;
      context.beginPath();
      context.arc(markerX, markerY, 8, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
      context.fillStyle = "#fff";
      context.textAlign = "center";
      context.font = "800 8px ui-monospace, Menlo, monospace";
      context.fillText(guide.type === "buy" ? "B" : "S", markerX, markerY + 3);
    });

    context.fillStyle = text;
    context.textAlign = "center";
    context.font = "11px ui-monospace, Menlo, monospace";
    [0, 0.25, 0.5, 0.75, 1].forEach((ratio) => {
      const index = Math.min(candles.length - 1, Math.round((candles.length - 1) * ratio));
      context.fillText(candles[index].time, x(index), size.height - 6);
    });

    if (hover && candles[hover.index]) {
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
      context.fillStyle = surface;
      context.fillRect(left + plotWidth + 3, hover.y - 9, right - 6, 18);
      context.fillStyle = accent;
      context.textAlign = "left";
      context.font = "700 10px ui-monospace, Menlo, monospace";
      context.fillText(hover.price.toFixed(3), left + plotWidth + 7, hover.y + 4);
    }
  }, [candles, guidePoints, hover, plot, previousClose, size]);

  const pointFromIndex = (index: number): HoverPoint => {
    const candle = candles[index];
    return { index, x: plot.x(index), y: plot.y(candle.close), price: candle.close };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!candles.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = (event.clientX - rect.left) * (size.width / Math.max(rect.width, 1));
    const pointerY = (event.clientY - rect.top) * (size.height / Math.max(rect.height, 1));
    const index = Math.max(0, Math.min(candles.length - 1, Math.floor(((pointerX - plot.left) / Math.max(plot.plotWidth, 1)) * candles.length)));
    const y = Math.max(plot.top, Math.min(plot.priceBottom, pointerY));
    const price = plot.max - ((y - plot.top) / Math.max(plot.priceBottom - plot.top, 1)) * (plot.max - plot.min);
    setHover({ index, x: plot.x(index), y, price });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!candles.length || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const current = hover?.index ?? candles.length - 1;
    const index = Math.max(0, Math.min(candles.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)));
    setHover(pointFromIndex(index));
  };

  const previous = hover && hover.index > 0 ? candles[hover.index - 1].close : previousClose;
  const hoveredChange = hoveredCandle ? hoveredCandle.close - previous : 0;
  const hoveredChangePct = hoveredCandle && previous > 0 ? (hoveredChange / previous) * 100 : 0;

  return (
    <div className="realtime-canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        role="img"
        tabIndex={0}
        aria-label={`当前交易日1分钟K线，共${candles.length}根；可用鼠标悬浮或方向键查看坐标`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHover(null)}
        onFocus={() => { if (!hover && candles.length) setHover(pointFromIndex(candles.length - 1)); }}
        onKeyDown={handleKeyDown}
      />
      {hover && hoveredCandle ? (
        <div
          className="realtime-hover-card"
          role="status"
          style={{
            left: Math.min(size.width - 274, Math.max(8, hover.x + 14)),
            top: Math.min(size.height - 176, Math.max(8, hover.y - 48)),
          }}
        >
          <header><strong>{hoveredCandle.time}</strong><span className={hoveredChange >= 0 ? "is-up" : "is-down"}>{hoveredChange >= 0 ? "+" : ""}{hoveredChange.toFixed(3)} · {hoveredChangePct >= 0 ? "+" : ""}{hoveredChangePct.toFixed(2)}%</span></header>
          <div><span>开 <b>{hoveredCandle.open.toFixed(3)}</b></span><span>高 <b>{hoveredCandle.high.toFixed(3)}</b></span><span>低 <b>{hoveredCandle.low.toFixed(3)}</b></span><span>收 <b>{hoveredCandle.close.toFixed(3)}</b></span></div>
          <footer><span>量 {compact(hoveredCandle.volume)}</span><span>额 {compact(hoveredCandle.amount)}</span></footer>
          {hoveredGuide ? <p className={hoveredGuide.type === "buy" ? "is-up" : "is-down"}><b>{hoveredGuide.type === "buy" ? "B" : "S"}{hoveredGuide.score}</b> {hoveredGuide.reasons.join(" · ")}{hoveredGuide.provisional ? " · 形成中" : ""}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function calculatePlot(candles: RealtimeMinuteCandle[], previousClose: number, size: { width: number; height: number }) {
  const left = 12;
  const right = 68;
  const top = 20;
  const priceBottom = Math.round(size.height * 0.72);
  const volumeTop = priceBottom + 24;
  const bottom = size.height - 24;
  const plotWidth = size.width - left - right;
  let min = Math.min(previousClose, ...candles.map((item) => item.low));
  let max = Math.max(previousClose, ...candles.map((item) => item.high));
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = previousClose * 0.99; max = previousClose * 1.01; }
  const padding = Math.max((max - min) * 0.1, max * 0.002);
  min -= padding;
  max += padding;
  const x = (index: number) => left + ((index + 0.5) / Math.max(candles.length, 1)) * plotWidth;
  const y = (price: number) => top + ((max - price) / Math.max(max - min, 0.0001)) * (priceBottom - top);
  return { left, right, top, priceBottom, volumeTop, bottom, plotWidth, min, max, x, y };
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
