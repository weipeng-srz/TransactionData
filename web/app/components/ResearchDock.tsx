"use client";

import { useState } from "react";
import type { PriceAlert, WatchlistItem } from "../lib/research";

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
  notice: string;
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
};

export default function ResearchDock(props: Props) {
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [target, setTarget] = useState(() => props.price?.toFixed(3) ?? "");
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
          <header><strong>自选股对比</strong><span>{props.watchlist.length}/12</span></header>
          {props.watchlist.length ? (
            <div className="watchlist-table-wrap">
              <table className="watchlist-table">
                <thead><tr><th>股票</th><th>价格</th><th>涨跌</th><th>PE</th><th>PB</th><th>股息率</th><th>舆情</th><th>操作</th></tr></thead>
                <tbody>{props.watchlist.map((item) => (
                  <tr key={item.code}>
                    <td><button type="button" className="watchlist-stock" onClick={() => props.onSelectWatch(item.code)} disabled={props.busy}><strong>{item.name}</strong><span>{item.code}</span></button></td>
                    <td>{formatNumber(item.price)}</td>
                    <td className={tone(item.changePct)}>{formatPercent(item.changePct)}</td>
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
          <header><strong>价格预警</strong><span>{props.alerts.filter((item) => item.triggeredAt).length} 已触发</span></header>
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
                <small>{alert.triggeredAt ? `已触发 · ${formatTime(alert.triggeredAt)}` : "监控中"}</small>
                <button type="button" aria-label={`删除 ${alert.name} 价格预警`} onClick={() => props.onRemoveAlert(alert.id)}>×</button>
              </div>
            )) : <p className="research-empty">预警保存在当前浏览器；页面刷新或重新查询时会按最新价格检查。</p>}
          </div>
        </section>

        <section className="research-panel freshness-panel">
          <header><strong>数据新鲜度</strong><span>{props.isDemo ? "演示数据" : props.name || props.code}</span></header>
          <dl>
            <div><dt>行情</dt><dd>{formatTime(props.freshness.market)}</dd></div>
            <div><dt>基本面</dt><dd>{formatTime(props.freshness.financial)}</dd></div>
            <div><dt>新闻</dt><dd>{formatTime(props.freshness.news)}</dd></div>
          </dl>
          <p>行情为最近 90 日快照；财报、估值和新闻各自独立更新，失败时保留最后一次成功结果并明确标记。</p>
        </section>
      </div>
    </section>
  );
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
