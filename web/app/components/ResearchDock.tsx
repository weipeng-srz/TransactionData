"use client";

import { useState } from "react";
import type { ChartAnnotation, PriceAlert, WatchlistItem } from "../lib/research";

type Props = {
  code: string;
  name: string;
  price: number | null;
  isDemo: boolean;
  busy: boolean;
  isWatched: boolean;
  hasSavedView: boolean;
  watchlist: WatchlistItem[];
  alerts: PriceAlert[];
  freshness: { market: string; financial: string; news: string };
  dataProfile: { level: string; priceBasis: string; amountBasis: string; timePrecision: string; qualityWarnings: number };
  notice: string;
  cloudStatus: "loading" | "synced" | "local" | "error";
  annotations: ChartAnnotation[];
  onToggleWatch: () => void;
  onSelectWatch: (code: string) => void;
  onRemoveWatch: (code: string) => void;
  onAddAlert: (direction: "above" | "below", target: number) => void;
  onRemoveAlert: (id: string) => void;
  onRefresh: () => void;
  onCopyLink: () => void;
  onSaveView: () => void;
  onRestoreView: () => void;
  onExportReport: () => void;
  onPrint: () => void;
  onAddAnnotation: (text: string) => void;
  onRemoveAnnotation: (id: string) => void;
  onEnableNotifications: () => void;
};

export default function ResearchDock(props: Props) {
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [target, setTarget] = useState(() => props.price?.toFixed(3) ?? "");
  const [annotation, setAnnotation] = useState("");
  const basket = summarizeBasket(props.watchlist);
  const submitAlert = () => {
    const value = Number(target);
    if (!Number.isFinite(value) || value <= 0) return;
    props.onAddAlert(direction, value);
    setTarget("");
  };

  return (
    <section className="research-dock" id="research-tools">
      <div className="research-dock-heading">
        <div>
          <p className="eyebrow">RESEARCH WORKSPACE</p>
          <h3>研究工具与自选对比</h3>
        </div>
        <div className="research-actions">
          <span className={`cloud-sync-badge is-${props.cloudStatus}`}>{props.cloudStatus === "synced" ? "云端已同步" : props.cloudStatus === "loading" ? "同步中" : props.cloudStatus === "error" ? "同步异常" : "本机模式"}</span>
          <button type="button" className={props.isWatched ? "active" : ""} aria-pressed={props.isWatched} onClick={props.onToggleWatch}>
            {props.isWatched ? "★ 已自选" : "☆ 加自选"}
          </button>
          <button type="button" onClick={props.onRefresh} disabled={props.busy || props.isDemo}>刷新数据</button>
          <button type="button" onClick={props.onCopyLink}>复制分享链接</button>
          <details className="research-more-actions">
            <summary>更多操作</summary>
            <div>
              <button type="button" onClick={props.onSaveView}>保存视图</button>
              <button type="button" onClick={props.onRestoreView} disabled={!props.hasSavedView || props.busy}>恢复视图</button>
              <button type="button" onClick={props.onExportReport}>导出报告</button>
              <button type="button" onClick={props.onPrint}>打印 / PDF</button>
            </div>
          </details>
        </div>
      </div>

      {props.notice ? <p className="research-notice" role="status">{props.notice}</p> : null}

      <div className="research-grid">
        <section className="research-panel watchlist-panel">
          <header><strong>自选股对比</strong><span>{props.watchlist.length}/20</span></header>
          {basket ? <dl className="basket-summary" aria-label="自选股等权组合摘要"><div><dt>20日等权动量</dt><dd className={tone(basket.momentum)}>{formatPercent(basket.momentum)}</dd></div><div><dt>平均年化波动</dt><dd>{formatPercent(basket.volatility, false)}</dd></div><div><dt>平均最大回撤</dt><dd className="is-down">{formatPercent(basket.drawdown)}</dd></div><div><dt>上涨广度</dt><dd>{basket.breadth.toFixed(0)}%</dd></div></dl> : null}
          {props.watchlist.length ? (
            <div className="watchlist-table-wrap">
              <table className="watchlist-table">
                <thead><tr><th>股票</th><th>价格</th><th>涨跌</th><th>20日动量</th><th>年化波动</th><th>最大回撤</th><th>PE</th><th>PB</th><th>股息率</th><th>舆情</th><th>操作</th></tr></thead>
                <tbody>{props.watchlist.map((item) => (
                  <tr key={item.code}>
                    <td><button type="button" className="watchlist-stock" onClick={() => props.onSelectWatch(item.code)} disabled={props.busy}><strong>{item.name}</strong><span>{item.code}</span></button></td>
                    <td>{formatNumber(item.price)}</td>
                    <td className={tone(item.changePct)}>{formatPercent(item.changePct)}</td>
                    <td className={tone(item.momentum20)}>{formatPercent(item.momentum20)}</td>
                    <td>{formatPercent(item.annualizedVolatility, false)}</td>
                    <td className="is-down">{formatPercent(item.maxDrawdown)}</td>
                    <td>{formatMultiple(item.peTtm)}</td>
                    <td>{formatMultiple(item.pb)}</td>
                    <td>{formatPercent(item.dividendYieldTtm, false)}</td>
                    <td>{item.sentiment ?? "—"}</td>
                    <td><button type="button" className="table-remove" aria-label={`从自选股移除 ${item.name}`} onClick={() => props.onRemoveWatch(item.code)}>移除</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="research-empty">把当前股票加入自选后，可在这里横向比较价格、估值、股息率与舆情。</p>}
        </section>

        <section className="research-panel alert-panel">
          <header><strong>云端价格预警</strong><button type="button" className="notification-enable" onClick={props.onEnableNotifications}>开启浏览器通知</button><span>{props.alerts.filter((item) => item.triggeredAt).length} 已触发</span></header>
          <div className="alert-form">
            <select aria-label="预警方向" value={direction} onChange={(event) => setDirection(event.target.value as "above" | "below")}>
              <option value="above">价格突破</option>
              <option value="below">价格跌破</option>
            </select>
            <input aria-label="预警目标价格" inputMode="decimal" placeholder={props.price?.toFixed(3) ?? "目标价格"} value={target} onChange={(event) => setTarget(event.target.value)} />
            <button type="button" onClick={submitAlert}>添加</button>
          </div>
          <div className="alert-list" aria-live="polite">
            {props.alerts.length ? props.alerts.slice(0, 6).map((alert) => (
              <div className={alert.triggeredAt ? "is-triggered" : ""} key={alert.id}>
                <span>{alert.name} {alert.direction === "above" ? "突破" : "跌破"} {alert.target.toFixed(3)}</span>
                <small>{alert.triggeredAt ? `已触发 · ${formatTime(alert.triggeredAt)}` : alert.lastCheckedAt ? `云端检查 ${formatTime(alert.lastCheckedAt)} · ${formatNumber(alert.lastPrice ?? null)}` : props.cloudStatus === "synced" ? "云端监控中" : "页面内监控中"}</small>
                <button type="button" aria-label={`删除 ${alert.name} 价格预警`} onClick={() => props.onRemoveAlert(alert.id)}>×</button>
              </div>
            )) : <p className="research-empty">添加后会优先同步到云端定时检查；云端不可用时自动保留为页面内提醒。</p>}
          </div>
        </section>

        <section className="research-panel annotation-panel">
          <header><strong>研究标注</strong><span>{props.annotations.filter((item) => item.code === props.code).length} 条</span></header>
          <div className="annotation-form">
            <input value={annotation} maxLength={180} placeholder="记录当前股票的观察、假设或风险…" aria-label="研究标注内容" onChange={(event) => setAnnotation(event.target.value)} />
            <button type="button" onClick={() => { const value = annotation.trim(); if (!value) return; props.onAddAnnotation(value); setAnnotation(""); }}>记录</button>
          </div>
          <div className="annotation-list">
            {props.annotations.filter((item) => item.code === props.code).slice(0, 5).map((item) => <article key={item.id}><div><strong>{item.date || "当前"}</strong><p>{item.text}</p></div><button type="button" aria-label="删除研究标注" onClick={() => props.onRemoveAnnotation(item.id)}>×</button></article>)}
            {!props.annotations.some((item) => item.code === props.code) ? <p className="research-empty">可把图表观察和后续验证假设保存在当前股票下。</p> : null}
          </div>
        </section>

        <section className="research-panel freshness-panel">
          <header><strong>数据新鲜度</strong><span>{props.isDemo ? "演示数据" : props.name || props.code}</span></header>
          <dl>
            <div><dt>行情</dt><dd>{formatTime(props.freshness.market)}</dd></div>
            <div><dt>基本面</dt><dd>{formatTime(props.freshness.financial)}</dd></div>
            <div><dt>新闻</dt><dd>{formatTime(props.freshness.news)}</dd></div>
          </dl>
          <dl className="provenance-list">
            <div><dt>行情粒度</dt><dd>{props.dataProfile.level}</dd></div>
            <div><dt>价格口径</dt><dd>{props.dataProfile.priceBasis || "原始价格"}</dd></div>
            <div><dt>成交额口径</dt><dd>{props.dataProfile.amountBasis}</dd></div>
            <div><dt>时间精度</dt><dd>{props.dataProfile.timePrecision}</dd></div>
            <div><dt>质量提示</dt><dd>{props.dataProfile.qualityWarnings} 条</dd></div>
          </dl>
          <p>行情最多覆盖约 5 年日 K；财报、估值和新闻各自独立更新。页面显示来源、复权和代理口径，失败时保留最后一次成功结果。</p>
        </section>
      </div>
    </section>
  );
}

function summarizeBasket(items: WatchlistItem[]): { momentum: number; volatility: number; drawdown: number; breadth: number } | null {
  if (!items.length) return null;
  const average = (values: Array<number | null>) => {
    const usable = values.filter((value): value is number => value != null && Number.isFinite(value));
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0;
  };
  const moves = items.map((item) => item.momentum20).filter((value): value is number => value != null && Number.isFinite(value));
  return {
    momentum: average(items.map((item) => item.momentum20)),
    volatility: average(items.map((item) => item.annualizedVolatility)),
    drawdown: average(items.map((item) => item.maxDrawdown)),
    breadth: moves.length ? (moves.filter((value) => value > 0).length / moves.length) * 100 : 0,
  };
}

function formatNumber(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(3);
}

function formatPercent(value: number | null, signed = true): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${signed && value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMultiple(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}x`;
}

function tone(value: number | null): string {
  return (value ?? 0) > 0 ? "is-up" : (value ?? 0) < 0 ? "is-down" : "";
}

function formatTime(value: string): string {
  if (!value) return "等待更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}
