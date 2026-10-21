"use client";

import Link from "next/link";
import { stockRouteKey } from "../../lib/security";
import type { ScreenerOpportunity } from "../../lib/screenerTypes";
import styles from "../../screener/screener.module.css";

export type ResearchPoolEntry = Pick<ScreenerOpportunity, "market" | "symbol" | "name" | "sector" | "risk" | "score"> & { addedAt: string };

/** Stored observations remain usable even when the latest market feed fails. */
export default function ResearchPoolView({ entries, averageRisk, sector, dateLabel, onOpen }: {
  entries: ResearchPoolEntry[];
  averageRisk: number;
  sector: string;
  dateLabel: (value: string) => string;
  onOpen: (entry: ResearchPoolEntry) => boolean;
}) {
  return <section className={styles.researchPoolCard} id="research-pool" tabIndex={-1} aria-labelledby="research-pool-title">
    <header><div><span>RESEARCH POOL</span><h2 id="research-pool-title">研究观察池</h2></div><strong>{entries.length}</strong></header>
    <p className={styles.poolRetention}>线索保留 30 天。研究观察池独立于持仓和自选，行情未返回时仍可进入个股研究。</p>
    <div className={styles.researchPoolList}>
      {entries.map((item) => <Link key={`${item.market}-${item.symbol}`} href={`/?stock=${encodeURIComponent(stockRouteKey({ code: item.symbol, market: item.market }))}`} onClick={(event) => {
        if (onOpen(item)) event.preventDefault();
      }}><span><strong>{item.name}</strong><small>{item.symbol} · {item.sector} · {dateLabel(item.addedAt)}</small></span><em>{item.score}<small>风险 {item.risk}</small></em></Link>)}
      {!entries.length ? <p>从候选卡片或机会详情加入。线索保留 30 天，过期后自动归档，不与持仓自选混用。</p> : null}
    </div>
    {entries.length ? <dl><div><dt>平均风险</dt><dd>{averageRisk}</dd></div><div><dt>集中方向</dt><dd>{sector}</dd></div></dl> : null}
  </section>;
}
