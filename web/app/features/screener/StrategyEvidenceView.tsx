"use client";

import type { ScreenerStrategyEvidence } from "../../lib/screenerTypes";
import styles from "../../screener/screener.module.css";

export default function StrategyEvidenceView({ items, onMethod, formatReturn, returnClass }: {
  items: ScreenerStrategyEvidence[];
  onMethod: (item: ScreenerStrategyEvidence) => void;
  formatReturn: (value: number) => string;
  returnClass: (value: number) => string;
}) {
  return <section className={styles.evidenceSection} aria-labelledby="evidence-title">
    <header>
      <div><span>ROLLING SIGNAL EVIDENCE</span><h2 id="evidence-title" tabIndex={-1}>策略历史表现</h2></div>
      <p>事件次数并非独立证券数 · 未扣佣金与滑点</p>
    </header>
    <div className={styles.evidenceGrid}>
      {items.map((item) => <article key={item.strategy}>
        <div><strong>{item.strategy}</strong><span>{item.sampleSize} 次样本</span></div>
        <dl>
          <div><dt>次日上涨</dt><dd>{item.winRate1D.toFixed(1)}%</dd></div>
          <div><dt>次日中位</dt><dd className={returnClass(item.medianReturn1D)}>{formatReturn(item.medianReturn1D)}</dd></div>
          <div><dt>3日平均</dt><dd className={returnClass(item.averageReturn3D)}>{formatReturn(item.averageReturn3D)}</dd></div>
          <div><dt>3日MFE / MAE</dt><dd>{formatReturn(item.averageMfe3D)} / {formatReturn(item.averageMae3D)}</dd></div>
        </dl>
        <button className={styles.methodButton} type="button" onClick={() => onMethod(item)}>{item.window} · 查看方法</button>
      </article>)}
      {!items.length ? <div className={styles.evidenceEmpty}>当前候选日K中没有足够的历史信号样本，系统不会生成模拟胜率。</div> : null}
    </div>
  </section>;
}
