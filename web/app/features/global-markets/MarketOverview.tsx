import type { FearGaugeQuote, GlobalIndexQuote } from "../../lib/globalIndexes";
import { fearTone, formatPrice, signedPercent, tone } from "./format";
import styles from "./GlobalWorkspace.module.css";

type Props = {
  loading: boolean;
  hasMarketData: boolean;
  coveredIndexes: number;
  openRising: number;
  openFalling: number;
  openBreadthTotal: number;
  openBreadthPct: number;
  snapshotRising: number;
  snapshotFalling: number;
  snapshotBreadthPct: number;
  openMarkets: number;
  leader?: { name: string; changePct: number };
  shanghaiQuote?: GlobalIndexQuote;
  usFearGauge?: FearGaugeQuote;
};

export default function MarketOverview({ loading, hasMarketData, coveredIndexes, openRising, openFalling, openBreadthTotal, openBreadthPct, snapshotRising, snapshotFalling, snapshotBreadthPct, openMarkets, leader, shanghaiQuote, usFearGauge }: Props) {
  return <section id="global-overview" aria-label="全球市场概览" tabIndex={-1} aria-busy={loading}>
    <div className="global-summary" aria-label="全球股指实时汇总">
      <article><span>当前开市广度 · 涨 / 跌</span><strong><em className="is-up">{hasMarketData ? openRising : "—"}</em><b>/</b><em className="is-down">{hasMarketData ? openFalling : "—"}</em></strong><small>{openBreadthTotal ? `上涨占比 ${openBreadthPct}% · 仅统计交易中市场` : hasMarketData ? "当前没有交易中样本" : "等待有效行情"}</small></article>
      <article><span>跨市场最近快照 · 涨 / 跌</span><strong><em className="is-up">{hasMarketData ? snapshotRising : "—"}</em><b>/</b><em className="is-down">{hasMarketData ? snapshotFalling : "—"}</em></strong><small>{hasMarketData ? `上涨占比 ${snapshotBreadthPct}% · 各市场时点不同` : "等待有效行情"}</small></article>
      <article><span>交易中市场</span><strong>{hasMarketData ? openMarkets : "—"}</strong><small>依据各交易所当地时段</small></article>
      <article><span>波动焦点</span><strong className={tone(leader?.changePct)}>{leader ? signedPercent(leader.changePct) : "—"}</strong><small>{leader?.name ?? "等待实时数据"}</small></article>
      <article><span>覆盖指数</span><strong>{coveredIndexes}</strong><small>美股 · A 股 · 美洲 · 欧洲 · 亚太</small></article>
    </div>
    <div className={styles.highlights} aria-label="市场重点指标">
      <a href="#shanghai-index">
        <span>上证指数</span>
        <strong>{shanghaiQuote ? formatPrice(shanghaiQuote.price) : "—"}<em className={tone(shanghaiQuote?.changePct)}>{shanghaiQuote ? signedPercent(shanghaiQuote.changePct) : "等待行情"}</em></strong>
        <small>查看日 K 与沪深两市成交额 →</small>
      </a>
      <a href="#us-indexes">
        <span>美股波动 · VIX</span>
        <strong>{usFearGauge ? formatPrice(usFearGauge.value) : "—"}<em className={fearTone(usFearGauge?.value)}>{usFearGauge?.level ?? "等待更新"}</em></strong>
        <small>查看美股行情与波动历史 →</small>
      </a>
    </div>
    <p className={styles.note}>当前开市广度只统计交易中市场；跨市场快照按各市场最近行情展示，不视为同步收盘比较。</p>
  </section>;
}
