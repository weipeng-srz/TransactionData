"use client";

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "../../components/AuthProvider";
import { accountStorage, subscribeAccountStorage } from "../../lib/accountStorage";
import { JOURNAL_STORAGE_KEY, priceChange, readJournal, type JournalMarket, type ReviewEntry } from "../../lib/tradingJournal";
import { useReviewQuotes } from "./useReviewQuotes";
import styles from "./StockReviewEntry.module.css";

const operationLabels = { buy: "买入", sell: "卖出", add: "加仓", reduce: "减仓", observe: "观察" };
const snapshot = () => accountStorage.getItem(JOURNAL_STORAGE_KEY);
const serverSnapshot = () => null;
const money = (value: number | null, market: JournalMarket) => value == null ? "—" : `${market === "US" ? "$" : "¥"}${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
const memoFields = [["thesis", "核心论点"], ["counterEvidence", "反方证据"], ["invalidation", "失效条件"], ["reviewDate", "下次复核日期"]] as const;
const memoChecks = [["source", "已核对原始公告 / SEC 申报"], ["valuation", "已与同业估值和盈利质量比较"], ["downside", "已定义最大可承受损失"], ["catalyst", "已写明催化剂与失效日期"]] as const;

export function selectStockReviewEntries(entries: ReviewEntry[], code: string, market: JournalMarket): ReviewEntry[] {
  return entries.filter((entry) => entry.market === market && entry.code.trim().toUpperCase() === code.trim().toUpperCase())
    .sort((left, right) => right.date.localeCompare(left.date) || right.updatedAt.localeCompare(left.updatedAt));
}

type Props = {
  code: string;
  name: string;
  market: JournalMarket;
  active: boolean;
  researchTools?: ReactNode;
  legacyAnnotations?: { id: string; date: string; text: string; price?: number | null }[];
};

export default function StockReviewEntry({ code, name, market, active, researchTools, legacyAnnotations = [] }: Props) {
  const { syncStatus } = useAuth();
  const stored = useSyncExternalStore(subscribeAccountStorage, snapshot, serverSnapshot);
  const storedMemo = useSyncExternalStore(subscribeAccountStorage, () => accountStorage.getItem(`ticklens.investment-memo.v1:${code}`), serverSnapshot);
  const memo = useMemo(() => {
    try {
      const parsed = storedMemo ? JSON.parse(storedMemo) : null;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const fields = memoFields.flatMap(([key, label]) => typeof parsed[key] === "string" && parsed[key].trim() ? [{ label, value: parsed[key] as string }] : []);
      const checks = memoChecks.filter(([key]) => parsed.checks?.[key] === true).map(([, label]) => label);
      return fields.length || checks.length ? { fields, checks } : null;
    } catch { return null; }
  }, [storedMemo]);
  const { entries, error } = useMemo(() => {
    try {
      return { entries: selectStockReviewEntries(readJournal({ getItem: () => stored }).entries, code, market), error: "" };
    } catch (reason) {
      return { entries: [] as ReviewEntry[], error: reason instanceof Error ? reason.message : "复盘数据暂时无法读取，请前往复盘中心检查。" };
    }
  }, [stored, code, market]);
  const { quotes, loading, error: quoteError, refresh } = useReviewQuotes(active ? entries : []);
  const quote = quotes[`${market}:${code.trim().toUpperCase()}`];
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
  const stockRoute = market === "US" ? `US:${code}` : code;
  const stockQuery = new URLSearchParams({ stock: stockRoute, name });
  const stockReviewUrl = `/review?${stockQuery}`;
  const createUrl = `${stockReviewUrl}&compose=1`;
  const completed = entries.filter((entry) => entry.status === "complete").length;

  return <section id="research-tools" className={styles.section} aria-labelledby="stock-review-heading">
    <header className={styles.header}>
      <div><h2 id="stock-review-heading">{name || code} · 交易复盘</h2><p>把操作价格、交易逻辑与复盘结论留在同一条记录里，持续检验自己的交易规则。</p></div>
      <div className={styles.actions}><a href="/review">完整复盘中心</a><a className={styles.primary} href={createUrl}>＋ 新建复盘</a></div>
    </header>
    <div className={styles.summary}>
      <span>共 <strong>{entries.length}</strong> 篇</span><span>已完成 <strong>{completed}</strong></span><span>草稿 <strong>{entries.length - completed}</strong></span>
      <span role="status">{syncStatus === "ready" ? "已同步至个人数据库" : syncStatus === "error" ? "有更改尚未同步，请查看页面提示" : "正在同步个人数据…"}</span>
    </div>
    {error ? <p className={styles.notice} role="alert">{error}<a href="/review">前往复盘中心处理</a></p> : entries.length ? <>
      <div className={styles.listHeading}><p>按操作日期排列 · 点击记录继续编辑</p><button type="button" onClick={refresh} disabled={loading}>{loading ? "更新行情中…" : "刷新行情"}</button></div>
      {quoteError && <p className={styles.notice} role="status">{quoteError}</p>}
      <div className={styles.records}>{entries.slice(0, 6).map((entry) => {
        const comparable = entry.date <= today && quote?.asOfDate && quote.asOfDate >= entry.date;
        const change = comparable ? priceChange(entry.operationPrice, quote?.price ?? null) : null;
        return <article className={styles.record} key={entry.id}>
          <div className={styles.recordHeading}><div className={styles.meta}><time dateTime={entry.date}>{entry.date}</time><span>{operationLabels[entry.operation]}</span><span data-complete={entry.status === "complete"}>{entry.status === "complete" ? "已完成" : "草稿"}</span></div><a aria-label={`编辑${entry.title || "未命名复盘"}`} href={`/review?entry=${encodeURIComponent(entry.id)}`}>编辑</a></div>
          <h3><a href={`/review?entry=${encodeURIComponent(entry.id)}`}>{entry.title || "未命名复盘"}</a></h3>
          <dl className={styles.prices}>
            <div><dt>操作时价格</dt><dd>{money(entry.operationPrice, market)}</dd></div>
            <div><dt>最新行情价</dt><dd>{money(quote?.price ?? null, market)}</dd></div>
            <div><dt>操作后标的涨跌</dt><dd data-direction={change ? change.percent > 0 ? "up" : change.percent < 0 ? "down" : "" : ""}>{change ? `${signed(change.percent)}%` : "—"}</dd>{change && <small>{signed(change.amount)} {market === "US" ? "USD" : "CNY"}</small>}</div>
          </dl>
          <p className={styles.quoteTime}>{quote ? `行情时点：${quote.updatedAt}${!comparable ? " · 行情日期不足以计算操作后涨跌" : ""}` : loading ? "正在获取最新行情…" : "暂无可用行情，可稍后刷新"}</p>
          <p className={styles.lesson}><span>复盘结论</span>{entry.lesson || "尚未填写，继续编辑补充这次操作的经验。"}</p>
          {entry.nextAction && <p className={styles.next}><span>下一步</span>{entry.nextAction}</p>}
          {entry.ruleChecks.length > 0 && <p className={styles.ruleChecks}>规则检查 {entry.ruleChecks.filter((check) => check.result !== "pending").length}/{entry.ruleChecks.length}</p>}
        </article>;
      })}</div>
      <p className={styles.scope}>涨跌按原币种、未复权价格比较，不含分红和费用，不代表账户盈亏；拆股或除权可能影响可比性。</p>
      {entries.length > 6 && <a className={styles.more} href={stockReviewUrl}>查看该股票全部 {entries.length} 篇复盘 →</a>}
    </> : <div className={styles.empty}><h3>从这只股票的第一篇复盘开始</h3><p>记录买入、卖出或观望的理由与价格，之后对照行情和交易规则回看。</p><a className={styles.primary} href={createUrl}>记录一次交易或观察</a></div>}
    {(researchTools || legacyAnnotations.length > 0 || memo || storedMemo) && <details className={styles.legacy}><summary>研究工具与历史记录{legacyAnnotations.length > 0 ? ` · ${legacyAnnotations.length} 条标注` : ""}</summary>
      {researchTools && <div className={styles.researchTools}>{researchTools}</div>}
      {legacyAnnotations.length > 0 && <div className={styles.legacyNotes}><p>原研究标注已保留，新的交易记录请使用上方复盘。</p>{legacyAnnotations.map((note) => <div key={note.id}><time>{note.date}</time>{note.price != null && <span>{money(note.price, market)}</span>}<p>{note.text}</p></div>)}</div>}
      {memo && <div className={styles.legacyNotes}><h3>历史投资备忘录</h3><dl>{memo.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>{memo.checks.length > 0 && <><p>当时已完成的检查</p><ul>{memo.checks.map((label) => <li key={label}>{label}</li>)}</ul></>}</div>}
    </details>}
  </section>;
}
