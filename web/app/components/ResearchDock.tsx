"use client";

import { useState } from "react";
import Link from "next/link";
import type { ChartAnnotation } from "../lib/research";

type Props = {
  code: string;
  name: string;
  isDemo: boolean;
  busy: boolean;
  isWatched: boolean;
  hasSavedView: boolean;
  freshness: { market: string; financial: string; news: string };
  dataProfile: { level: string; priceBasis: string; amountBasis: string; timePrecision: string; qualityWarnings: number };
  notice: string;
  cloudStatus: "loading" | "synced" | "local" | "error";
  annotations: ChartAnnotation[];
  onToggleWatch: () => void;
  onRefresh: () => void;
  onCopyLink: () => void;
  onSaveView: () => void;
  onRestoreView: () => void;
  onExportReport: () => void;
  onPrint: () => void;
  onAddAnnotation: (text: string) => void;
  onRemoveAnnotation: (id: string) => void;
};

export default function ResearchDock(props: Props) {
  const [annotation, setAnnotation] = useState("");
  const stockAnnotations = props.annotations.filter((item) => item.code === props.code);

  return (
    <section className="research-dock current-stock-tools" id="research-tools">
      <div className="research-dock-heading">
        <div>
          <p className="eyebrow">CURRENT STOCK WORKSPACE</p>
          <h3>{props.name || props.code} · 研究记录与数据口径</h3>
        </div>
        <div className="research-actions">
          <span className={`cloud-sync-badge is-${props.cloudStatus}`}>{props.cloudStatus === "synced" ? "云端已同步" : props.cloudStatus === "loading" ? "同步中" : props.cloudStatus === "error" ? "同步异常" : "本机模式"}</span>
          <button type="button" className={props.isWatched ? "active" : ""} aria-pressed={props.isWatched} onClick={props.onToggleWatch}>
            {props.isWatched ? "★ 已加入监控" : "☆ 加入监控"}
          </button>
          <Link className="research-monitor-link" href="/alerts">打开行情监控</Link>
          <button type="button" onClick={props.onRefresh} disabled={props.busy || props.isDemo}>刷新当前股票</button>
          <button type="button" onClick={props.onCopyLink}>分享当前研究</button>
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

      <div className="research-grid current-stock-grid">
        <section className="research-panel annotation-panel">
          <header><strong>当前股票研究标注</strong><span>{stockAnnotations.length} 条</span></header>
          <div className="annotation-form">
            <input value={annotation} maxLength={180} placeholder="记录当前股票的观察、假设或风险…" aria-label="研究标注内容" onChange={(event) => setAnnotation(event.target.value)} />
            <button type="button" onClick={() => { const value = annotation.trim(); if (!value) return; props.onAddAnnotation(value); setAnnotation(""); }}>记录</button>
          </div>
          <div className="annotation-list">
            {stockAnnotations.slice(0, 8).map((item) => <article key={item.id}><div><strong>{item.date || "当前"}</strong><p>{item.text}</p></div><button type="button" aria-label="删除研究标注" onClick={() => props.onRemoveAnnotation(item.id)}>×</button></article>)}
            {!stockAnnotations.length ? <p className="research-empty">可把图表观察和后续验证假设保存在当前股票下。</p> : null}
          </div>
        </section>

        <section className="research-panel freshness-panel">
          <header><strong>当前股票数据状态</strong><span>{props.isDemo ? "演示数据" : props.name || props.code}</span></header>
          <dl>
            <div><dt>行情更新</dt><dd>{formatTime(props.freshness.market)}</dd></div>
            <div><dt>基本面更新</dt><dd>{formatTime(props.freshness.financial)}</dd></div>
            <div><dt>新闻更新</dt><dd>{formatTime(props.freshness.news)}</dd></div>
          </dl>
          <dl className="provenance-list">
            <div><dt>行情粒度</dt><dd>{props.dataProfile.level}</dd></div>
            <div><dt>价格口径</dt><dd>{props.dataProfile.priceBasis || "原始价格"}</dd></div>
            <div><dt>成交额口径</dt><dd>{props.dataProfile.amountBasis}</dd></div>
            <div><dt>时间精度</dt><dd>{props.dataProfile.timePrecision}</dd></div>
            <div><dt>质量提示</dt><dd>{props.dataProfile.qualityWarnings} 条</dd></div>
          </dl>
          <p>行情最多覆盖约 5 年日 K；财报、估值和新闻独立更新。数据失败时保留最后一次成功结果。</p>
        </section>
      </div>
    </section>
  );
}

function formatTime(value: string): string {
  if (!value) return "等待更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}
