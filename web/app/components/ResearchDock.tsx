"use client";

import { accountStorage } from "../lib/accountStorage";

import { useEffect, useState } from "react";
import type { ChartAnnotation } from "../lib/research";
import styles from "../features/stock/ResearchNotes.module.css";

type Props = {
  code: string;
  name: string;
  hideWorkspaceActions?: boolean;
  isDemo: boolean;
  busy: boolean;
  hasSavedView: boolean;
  freshness: { market: string; financial: string; news: string };
  dataProfile: { level: string; priceBasis: string; amountBasis: string; timePrecision: string; qualityWarnings: number };
  notice: string;
  cloudStatus: "loading" | "synced" | "local" | "error";
  annotations: ChartAnnotation[];
  onRefresh: () => void;
  onCopyLink: () => void;
  onSaveView: () => void;
  onRestoreView: () => void;
  onExportReport: () => void;
  onPrint: () => void;
  onAddAnnotation: (text: string) => void;
  onRemoveAnnotation: (id: string) => void;
};

type InvestmentMemo = {
  thesis: string;
  counterEvidence: string;
  invalidation: string;
  reviewDate: string;
  checks: Record<string, boolean>;
};

const investmentMemoStoragePrefix = "ticklens.investment-memo.v1";
const investorChecks = [
  ["source", "已核对原始公告 / SEC 申报"],
  ["valuation", "已与同业估值和盈利质量比较"],
  ["downside", "已定义最大可承受损失"],
  ["catalyst", "已写明催化剂与失效日期"],
] as const;

export default function ResearchDock(props: Props) {
  const [annotation, setAnnotation] = useState("");
  const [showAllAnnotations, setShowAllAnnotations] = useState(false);
  const stockAnnotations = props.annotations.filter((item) => item.code === props.code);
  const availableSources = [props.freshness.market, props.freshness.financial, props.freshness.news].filter(Boolean).length;
  const dataReadiness = Math.max(0, Math.round((availableSources / 3) * 100 - props.dataProfile.qualityWarnings * 8));

  return (
    <section className={styles.workspace} id="research-tools">
      <div className={styles.heading}>
        <div>
          <h2>研究记录</h2>
          <p className={styles.scope}>标注、视图与投资备忘录自动同步到账户数据库。</p>
        </div>
        <div className={styles.actions}>
          <a href={`/review?stock=${encodeURIComponent(/^\d{6}$/.test(props.code) || props.code.startsWith("US:") ? props.code : `US:${props.code}`)}&name=${encodeURIComponent(props.name)}`}>记录这只股票的复盘 ↗</a>
          <span className={styles.syncStatus} data-status={props.cloudStatus} aria-live="polite">{props.cloudStatus === "synced" ? "云端已同步" : props.cloudStatus === "loading" ? "同步中" : props.cloudStatus === "error" ? "同步失败 · 请重试" : "等待账户同步"}</span>
          {!props.hideWorkspaceActions ? <><button type="button" onClick={props.onRefresh} disabled={props.busy || props.isDemo}>刷新当前股票</button>
          <button type="button" onClick={props.onCopyLink}>分享当前研究</button></> : null}
          <details className={styles.moreActions}>
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

      {props.notice ? <p className={styles.notice} role="status">{props.notice}</p> : null}

      <div className={styles.grid}>
        <section className={styles.annotations}>
          <header><strong>当前股票研究标注</strong><span>{stockAnnotations.length} 条 · {props.cloudStatus === "synced" ? "云端已同步" : "等待同步"}</span></header>
          <div className={styles.annotationForm}>
            <input value={annotation} maxLength={180} placeholder="记录当前股票的观察、假设或风险…" aria-label="研究标注内容" onChange={(event) => setAnnotation(event.target.value)} />
            <button type="button" disabled={!annotation.trim()} onClick={() => { const value = annotation.trim(); if (!value) return; props.onAddAnnotation(value); setAnnotation(""); }}>记录</button>
          </div>
          <div className={styles.annotationList}>
            {(showAllAnnotations ? stockAnnotations : stockAnnotations.slice(0, 8)).map((item) => <article key={item.id}><div><strong>{item.date || "当前"}</strong><p>{item.text}</p></div><button type="button" aria-label="删除研究标注" onClick={() => props.onRemoveAnnotation(item.id)}>×</button></article>)}
            {!stockAnnotations.length ? <p className={styles.empty}>可把图表观察和后续验证假设保存在当前股票下。</p> : null}
          </div>
          {stockAnnotations.length > 8 ? <button type="button" className={styles.expand} aria-expanded={showAllAnnotations} onClick={() => setShowAllAnnotations((current) => !current)}>{showAllAnnotations ? "收起历史标注" : `查看全部 ${stockAnnotations.length} 条标注`}</button> : null}
        </section>

        <InvestmentMemoPanel key={props.code} code={props.code} />

        <section className={styles.freshness}>
          <header><strong>当前股票数据状态</strong><span>{props.isDemo ? "演示数据" : props.name || props.code}</span></header>
          <dl>
            <div><dt>行情更新</dt><dd>{formatTime(props.freshness.market)}</dd></div>
            <div><dt>基本面更新</dt><dd>{formatTime(props.freshness.financial)}</dd></div>
            <div><dt>新闻更新</dt><dd>{formatTime(props.freshness.news)}</dd></div>
          </dl>
          <dl className={styles.provenance}>
            <div><dt>页面加载就绪度</dt><dd>{dataReadiness}/100</dd></div>
            <div><dt>行情粒度</dt><dd>{props.dataProfile.level}</dd></div>
            <div><dt>价格口径</dt><dd>{props.dataProfile.priceBasis || "原始价格"}</dd></div>
            <div><dt>成交额口径</dt><dd>{props.dataProfile.amountBasis}</dd></div>
            <div><dt>时间精度</dt><dd>{props.dataProfile.timePrecision}</dd></div>
            <div><dt>质量提示</dt><dd>{props.dataProfile.qualityWarnings} 条</dd></div>
          </dl>
          <p>页面加载就绪度只反映三类数据是否成功更新及质量警告，不代表评分覆盖率、模型一致度或内容准确率。行情最多覆盖约 5 年日 K；财报、估值和新闻独立更新，失败时保留最后一次成功结果。</p>
        </section>
      </div>
    </section>
  );
}

function InvestmentMemoPanel({ code }: { code: string }) {
  const [investmentMemo, setInvestmentMemo] = useState<InvestmentMemo>(() => emptyInvestmentMemo());
  const [memoReady, setMemoReady] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setInvestmentMemo(loadInvestmentMemo(code));
      setMemoReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [code]);

  useEffect(() => {
    if (!code || !memoReady) return;
    try { accountStorage.setItem(`${investmentMemoStoragePrefix}:${code}`, JSON.stringify(investmentMemo)); } catch { /* The draft remains available for this page. */ }
  }, [code, investmentMemo, memoReady]);

  return (
    <section className={styles.memo}>
      <header><strong>投资论点与反证</strong><span>账户 · 自动同步</span></header>
      <label><span>核心论点</span><textarea maxLength={500} value={investmentMemo.thesis} placeholder="为什么值得继续研究？关键价值驱动是什么？" onChange={(event) => setInvestmentMemo((current) => ({ ...current, thesis: event.target.value }))} /></label>
      <label><span>反方证据</span><textarea maxLength={500} value={investmentMemo.counterEvidence} placeholder="哪些事实支持相反结论？" onChange={(event) => setInvestmentMemo((current) => ({ ...current, counterEvidence: event.target.value }))} /></label>
      <label><span>失效条件</span><textarea maxLength={360} value={investmentMemo.invalidation} placeholder="出现什么数据或事件时，当前论点失效？" onChange={(event) => setInvestmentMemo((current) => ({ ...current, invalidation: event.target.value }))} /></label>
      <label className={styles.reviewDate}><span>下次复核日期</span><input type="date" value={investmentMemo.reviewDate} onChange={(event) => setInvestmentMemo((current) => ({ ...current, reviewDate: event.target.value }))} /></label>
      <fieldset><legend>决策前检查清单</legend>{investorChecks.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(investmentMemo.checks[key])} onChange={(event) => setInvestmentMemo((current) => ({ ...current, checks: { ...current.checks, [key]: event.target.checked } }))} /><span>{label}</span></label>)}</fieldset>
      <p>日期是个人复核提示，不会自动下单或发送外部通知。</p>
    </section>
  );
}

function loadInvestmentMemo(code: string): InvestmentMemo {
  const fallback = emptyInvestmentMemo();
  if (typeof window === "undefined" || !code) return fallback;
  try {
    const parsed = JSON.parse(accountStorage.getItem(`${investmentMemoStoragePrefix}:${code}`) ?? "null") as Partial<InvestmentMemo> | null;
    return parsed ? { ...fallback, ...parsed, checks: { ...fallback.checks, ...(parsed.checks ?? {}) } } : fallback;
  } catch {
    return fallback;
  }
}

function emptyInvestmentMemo(): InvestmentMemo {
  return { thesis: "", counterEvidence: "", invalidation: "", reviewDate: "", checks: Object.fromEntries(investorChecks.map(([key]) => [key, false])) };
}

function formatTime(value: string): string {
  if (!value) return "等待更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}
