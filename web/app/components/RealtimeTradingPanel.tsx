"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeMinuteCandle, RealtimeSnapshot } from "../lib/realtimeMarket";

type LoadState = { phase: "idle" | "loading" | "success" | "error"; detail: string };

export default function RealtimeTradingPanel({ snapshot, load, onRefresh }: { snapshot: RealtimeSnapshot | null; load: LoadState; onRefresh: () => void }) {
  const imbalance = useMemo(() => {
    if (!snapshot) return null;
    const bid = snapshot.bids.reduce((sum, item) => sum + item.volume, 0);
    const ask = snapshot.asks.reduce((sum, item) => sum + item.volume, 0);
    return bid + ask ? ((bid - ask) / (bid + ask)) * 100 : 0;
  }, [snapshot]);
  const direction = (snapshot?.change ?? 0) >= 0 ? "is-up" : "is-down";

  return (
    <section className="realtime-panel" id="realtime-trading" aria-live="polite">
      <header className="realtime-header">
        <div><p className="eyebrow">LIVE TRADING DAY</p><h3>当前交易日 · 分钟 K 线与五档盘口</h3></div>
        <div className="realtime-header-meta">
          {snapshot ? <><span className={`market-status ${snapshot.marketStatus === "交易中" ? "is-live" : ""}`}><i />{snapshot.marketStatus}</span><span>{snapshot.date} {snapshot.time}</span></> : null}
          <button type="button" onClick={onRefresh} disabled={load.phase === "loading"}>{load.phase === "loading" ? "刷新中…" : "刷新实时行情"}</button>
        </div>
      </header>

      {snapshot ? <div className="realtime-layout">
        <section className="realtime-chart-card">
          <div className="realtime-quote-strip">
            <div><span>最新</span><strong className={direction}>{snapshot.price.toFixed(3)}</strong><small className={direction}>{snapshot.change >= 0 ? "+" : ""}{snapshot.change.toFixed(3)} · {snapshot.changePct >= 0 ? "+" : ""}{snapshot.changePct.toFixed(2)}%</small></div>
            <RealtimeMetric label="今开" value={snapshot.open.toFixed(3)} />
            <RealtimeMetric label="最高" value={snapshot.high.toFixed(3)} />
            <RealtimeMetric label="最低" value={snapshot.low.toFixed(3)} />
            <RealtimeMetric label="成交量" value={compact(snapshot.volume)} />
            <RealtimeMetric label="成交额" value={compact(snapshot.amount)} />
          </div>
          <MinuteCandlestickChart candles={snapshot.minuteCandles} previousClose={snapshot.previousClose} />
          <div className="realtime-chart-footer"><span>1 分钟 K 线 · {snapshot.minuteCandles.length} 根</span><span>来源：{snapshot.source}</span><span>更新：{formatFetchedAt(snapshot.fetchedAt)}</span></div>
        </section>

        <aside className="orderbook-card">
          <div className="orderbook-heading"><div><strong>五档买卖盘</strong><span>实时委托快照</span></div><span className={(imbalance ?? 0) >= 0 ? "is-up" : "is-down"}>委比 {imbalance == null ? "—" : `${imbalance >= 0 ? "+" : ""}${imbalance.toFixed(1)}%`}</span></div>
          <div className="orderbook-columns"><span>档位</span><span>价格</span><span>委托量</span></div>
          <div className="orderbook-levels asks">
            {[...snapshot.asks].reverse().map((item) => <OrderLevel key={`ask-${item.level}`} side="卖" level={item.level} price={item.price} volume={item.volume} />)}
          </div>
          <div className="orderbook-mid"><strong className={direction}>{snapshot.price.toFixed(3)}</strong><span>昨收 {snapshot.previousClose.toFixed(3)}</span></div>
          <div className="orderbook-levels bids">
            {snapshot.bids.map((item) => <OrderLevel key={`bid-${item.level}`} side="买" level={item.level} price={item.price} volume={item.volume} />)}
          </div>
          <div className="orderbook-totals"><div><span>买五合计</span><strong>{compact(snapshot.bids.reduce((sum, item) => sum + item.volume, 0))}</strong></div><div><span>卖五合计</span><strong>{compact(snapshot.asks.reduce((sum, item) => sum + item.volume, 0))}</strong></div></div>
        </aside>
      </div> : <div className={`realtime-empty is-${load.phase}`}><strong>{load.phase === "loading" ? "正在获取当前交易日实时行情" : load.phase === "error" ? "实时行情暂不可用" : "查询股票后显示实时行情"}</strong><p>{load.detail}</p></div>}
    </section>
  );
}

function MinuteCandlestickChart({ candles, previousClose }: { candles: RealtimeMinuteCandle[]; previousClose: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 960, height: 360 });

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(560, entry.contentRect.width), height: Math.max(320, entry.contentRect.height) }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr); canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`; canvas.style.height = `${size.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, size.width, size.height);
    const styles = getComputedStyle(document.documentElement);
    const up = styles.getPropertyValue("--apple-rise").trim() || "#f04444";
    const down = styles.getPropertyValue("--apple-fall").trim() || "#1a9c5b";
    const text = styles.getPropertyValue("--apple-tertiary").trim() || "#86868b";
    const grid = styles.getPropertyValue("--apple-border").trim() || "rgba(0,0,0,.08)";
    if (!candles.length) { context.fillStyle = text; context.font = "13px system-ui"; context.fillText("当前交易日尚无分钟成交数据", 24, 42); return; }
    const left = 12, right = 68, top = 20, priceBottom = Math.round(size.height * .74), volumeTop = priceBottom + 24, bottom = size.height - 24;
    const plotWidth = size.width - left - right;
    let min = Math.min(previousClose, ...candles.map((item) => item.low));
    let max = Math.max(previousClose, ...candles.map((item) => item.high));
    const padding = Math.max((max - min) * .1, max * .002); min -= padding; max += padding;
    const x = (index: number) => left + ((index + .5) / candles.length) * plotWidth;
    const y = (price: number) => top + ((max - price) / Math.max(max - min, .0001)) * (priceBottom - top);
    context.font = "11px ui-monospace, Menlo, monospace"; context.fillStyle = text; context.strokeStyle = grid; context.lineWidth = 1;
    for (let step = 0; step <= 4; step += 1) { const lineY = top + ((priceBottom - top) / 4) * step; context.beginPath(); context.moveTo(left, lineY + .5); context.lineTo(left + plotWidth, lineY + .5); context.stroke(); context.fillText((max - ((max - min) / 4) * step).toFixed(3), left + plotWidth + 9, lineY + 4); }
    const previousY = y(previousClose); context.strokeStyle = text; context.setLineDash([4, 4]); context.beginPath(); context.moveTo(left, previousY); context.lineTo(left + plotWidth, previousY); context.stroke(); context.setLineDash([]);
    const candleWidth = Math.max(1, Math.min(6, (plotWidth / candles.length) * .66));
    candles.forEach((item, index) => { const color = item.close >= item.open ? up : down; const candleX = x(index); context.strokeStyle = color; context.fillStyle = color; context.beginPath(); context.moveTo(candleX, y(item.high)); context.lineTo(candleX, y(item.low)); context.stroke(); const bodyTop = Math.min(y(item.open), y(item.close)); const bodyHeight = Math.max(1, Math.abs(y(item.open) - y(item.close))); if (item.close >= item.open) context.fillRect(candleX - candleWidth / 2, bodyTop, candleWidth, bodyHeight); else context.strokeRect(candleX - candleWidth / 2, bodyTop, candleWidth, bodyHeight); });
    const maxVolume = Math.max(...candles.map((item) => item.volume), 1);
    candles.forEach((item, index) => { const height = (item.volume / maxVolume) * (bottom - volumeTop); context.fillStyle = item.close >= item.open ? `${up}99` : `${down}99`; context.fillRect(x(index) - candleWidth / 2, bottom - height, candleWidth, height); });
    context.fillStyle = text; context.textAlign = "center"; [0, .25, .5, .75, 1].forEach((ratio) => { const index = Math.min(candles.length - 1, Math.round((candles.length - 1) * ratio)); context.fillText(candles[index].time, x(index), size.height - 6); });
  }, [candles, previousClose, size]);

  return <div className="realtime-canvas-wrap" ref={wrapRef}><canvas ref={canvasRef} role="img" aria-label={`当前交易日1分钟K线，共${candles.length}根`} /></div>;
}

function RealtimeMetric({ label, value }: { label: string; value: string }) { return <div className="realtime-metric"><span>{label}</span><strong>{value}</strong></div>; }
function OrderLevel({ side, level, price, volume }: { side: "买" | "卖"; level: number; price: number; volume: number }) { return <div><span className={side === "买" ? "is-up" : "is-down"}>{side}{level}</span><strong>{price ? price.toFixed(3) : "—"}</strong><em>{volume ? compact(volume) : "—"}</em></div>; }
function compact(value: number) { return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 }).format(value); }
function formatFetchedAt(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("zh-CN", { hour12: false }); }
