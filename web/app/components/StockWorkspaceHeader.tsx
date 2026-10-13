"use client";

import type { ReactNode } from "react";
import ViewModeSwitch from "./ViewModeSwitch";
import type { ViewMode } from "../lib/viewMode";
import styles from "./StockWorkspace.module.css";

type QuoteStat = { label: string; value: string; title?: string };

export default function StockWorkspaceHeader({ name, code, market, status, price, change, direction, source, dataLevel, dateRange, stats, viewMode, onViewModeChange, onBack, onRefresh, onShare, busy, selection }: {
  name: string; code: string; market: string; status: string; price: string; change: string; direction: string;
  source: string; dataLevel: string; dateRange: string; stats: QuoteStat[]; viewMode: ViewMode;
  onViewModeChange: (value: ViewMode) => void; onBack: () => void; onRefresh: () => void; onShare: () => void;
  busy: boolean; selection?: ReactNode;
}) {
  return <header className={styles.header}>
    <nav className={styles.breadcrumb} aria-label="面包屑"><button type="button" onClick={onBack}>我的工作台</button><span aria-hidden="true">/</span><span>个股研究</span><span aria-hidden="true">/</span><span>{name}</span></nav>
    <div className={styles.heading}>
      <div className={styles.identity}><h1>{name}</h1><span>{code} · {market}</span>{selection}<small>{status}</small></div>
      <div className={styles.price} aria-label="个股实时汇总"><strong className={direction}>{price}</strong><span className={direction}>{change}</span></div>
      <div className={styles.actions}><button type="button" onClick={onRefresh} disabled={busy}>{busy ? "更新中" : "刷新"}</button><button type="button" onClick={onShare}>分享研究</button><ViewModeSwitch value={viewMode} onChange={onViewModeChange} /></div>
    </div>
    <dl className={styles.quoteStats} aria-label="个股日内行情摘要">{stats.map((item) => <div key={item.label}><dt>{item.label}</dt><dd title={item.title}>{item.value}</dd></div>)}</dl>
    <div className={styles.metadata}><span>数据 · {source}</span><span>{dataLevel}</span><span>{dateRange}</span></div>
  </header>;
}
