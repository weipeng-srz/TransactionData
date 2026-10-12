"use client";

import { useEffect, useMemo, useState } from "react";
import type { StockHoldings } from "../lib/holdings";
import { currencyOf, type StockCurrency } from "../lib/security";
import {
  earningsCalendar, earningsDayReturn, earningsMarketDate, earningsStorageKey,
  parseEarningsHistory, recordPortfolioEarnings, summarizeEarnings,
  type EarningsDay, type EarningsHistory, type EarningsQuote,
} from "../lib/portfolioEarnings";
import styles from "./PortfolioEarnings.module.css";

export default function PortfolioEarnings({ holdings, quotes, hydrated }: {
  holdings: StockHoldings;
  quotes: Record<string, EarningsQuote>;
  hydrated: boolean;
}) {
  const [history, setHistory] = useState<EarningsHistory>({ version: 1, days: [] });
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<StockCurrency | null>(null);
  const [selectedMonth, setSelectedMonth] = useState("");

  useEffect(() => {
    let stored: EarningsHistory = { version: 1, days: [] };
    let failed = false;
    try { stored = parseEarningsHistory(JSON.parse(localStorage.getItem(earningsStorageKey) ?? "null")); }
    catch { failed = true; }
    const frame = requestAnimationFrame(() => {
      setHistory(stored); setNow(new Date()); setStorageError(failed); setReady(true);
    });
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => { cancelAnimationFrame(frame); window.clearInterval(timer); };
  }, []);

  const observed = useMemo(() => ready && hydrated && now
    ? recordPortfolioEarnings(history, holdings, quotes, now) : history,
  [history, holdings, hydrated, now, quotes, ready]);

  useEffect(() => {
    if (!ready || !hydrated || observed === history) return;
    let failed = false;
    try { localStorage.setItem(earningsStorageKey, JSON.stringify(observed)); }
    catch { failed = true; }
    const frame = requestAnimationFrame(() => { setHistory(observed); setStorageError(failed); });
    return () => cancelAnimationFrame(frame);
  }, [history, hydrated, observed, ready]);

  const availableCurrencies = (["CNY", "USD"] as StockCurrency[]).filter((currency) =>
    Object.values(holdings).some((holding) => currencyOf(holding) === currency)
    || observed.days.some((day) => day.currency === currency));
  const currency = selectedCurrency ?? availableCurrencies[0] ?? "CNY";
  const today = now ? earningsMarketDate(currency, now) : "";
  const month = selectedMonth || today.slice(0, 7);
  const summary = summarizeEarnings(observed.days, currency, month);
  const lifetime = summarizeEarnings(observed.days, currency);
  const todayRow = observed.days.find((row) => row.currency === currency && row.date === today);
  const dailyPct = earningsDayReturn(todayRow);
  const months = [...new Set(observed.days.filter((row) => row.currency === currency).map((row) => row.date.slice(0, 7)))].sort().reverse().slice(0, 12);
  const rows = new Map(summary.rows.map((row) => [row.date, row]));

  return (
    <section className={styles.card} aria-labelledby="portfolio-earnings-title">
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>收益记录</p><h2 id="portfolio-earnings-title">把每天的变化，放进日历</h2><p>按交易日保存持仓浮动收益估算，查看每日表现与月度合计。</p></div>
        <div className={styles.currencyTabs} aria-label="收益统计币种">
          {(["CNY", "USD"] as StockCurrency[]).map((item) => <button type="button" key={item} aria-pressed={currency === item} onClick={() => { setSelectedCurrency(item); setSelectedMonth(""); }}>{item === "CNY" ? "A 股 · CNY" : "美股 · USD"}</button>)}
        </div>
      </header>
      <div className={styles.metrics}>
        <Metric label="今日持仓估算" value={money(todayRow?.profit ?? null, currency)} tone={tone(todayRow?.profit)} detail={dailyPct !== null ? `${dailyPct >= 0 ? "+" : ""}${dailyPct.toFixed(2)}% · ${todayRow?.quoteTime || "最新观察"}` : dayStatus(todayRow)} />
        <Metric label={`${month ? `${Number(month.slice(5))} 月` : "本月"}已记录合计`} value={money(summary.profit, currency)} tone={tone(summary.profit)} detail={`${summary.recordedDays} 个有效记录日${summary.unavailableDays ? ` · ${summary.unavailableDays} 日不完整` : ""}`} />
        <Metric label="全部记录合计" value={money(lifetime.profit, currency)} tone={tone(lifetime.profit)} detail={lifetime.rows[0] ? `自 ${lifetime.rows[0].date} 开始 · ${lifetime.recordedDays} 日` : "从首次有效行情开始记录"} />
        <Metric label="所选月盈利 / 亏损日" value={`${summary.winningDays} / ${summary.losingDays}`} detail={summary.recordedDays ? `盈利日占比 ${(summary.winningDays / summary.recordedDays * 100).toFixed(0)}% · 持平 ${summary.flatDays} 日` : "等待有效日收益"} />
      </div>
      {storageError && <p className={styles.warning} role="status">当前浏览器无法读取或保存收益历史；本次会话仍可查看估算，刷新后可能丢失。</p>}
      <div className={styles.content}>
        <div className={styles.calendarPanel}>
          <div className={styles.calendarHeader}><h3>每日收益</h3><label>查看月份 <input aria-label="收益日历月份" type="month" value={month} max={today.slice(0, 7)} onChange={(event) => setSelectedMonth(event.target.value)} /></label></div>
          <div className={styles.calendar} role="list" aria-label={`${month}每日持仓收益估算`}>
            {["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day} className={styles.weekday} aria-hidden="true">{day}</span>)}
            {earningsCalendar(month).map((cell, index) => {
              if (!cell) return <span key={`empty-${index}`} aria-hidden="true" />;
              const row = rows.get(cell.date);
              const future = cell.date > today;
              return <div key={cell.date} role="listitem" className={`${styles.day} ${styles[tone(row?.profit)]}`} data-today={cell.date === today} data-future={future} title={`${cell.date}：${row?.profit != null ? `${money(row.profit, currency)}，${row.quoteTime || "观察时点"}` : future ? "尚未到来" : dayStatus(row)}`} aria-label={`${cell.date}，${row?.profit != null ? money(row.profit, currency) : future ? "尚未到来" : dayStatus(row)}`}><span>{cell.day}</span><strong>{row?.profit != null ? calendarMoney(row.profit) : row ? "待核验" : "—"}</strong></div>;
            })}
          </div>
          <p className={styles.caption}>红色为盈利，绿色为亏损；— 表示未记录，不代表收益为零。</p>
        </div>
        <div className={styles.monthPanel}>
          <h3>月度收益</h3>
          {months.length ? <div className={styles.monthList}>{months.map((item) => {
            const monthly = summarizeEarnings(observed.days, currency, item);
            return <button type="button" key={item} aria-pressed={month === item} onClick={() => setSelectedMonth(item)}><span><strong>{item}</strong><small>{monthly.recordedDays} 个有效日{monthly.unavailableDays ? ` / ${monthly.unavailableDays} 日待核验` : ""}</small></span><b className={styles[tone(monthly.profit)]}>{money(monthly.profit, currency)}</b></button>;
          })}</div> : <p className={styles.empty}>{Object.values(holdings).some((holding) => currencyOf(holding) === currency) ? "等待本市场当日有效行情。未观察的历史交易日不会回填。" : "添加本市场持仓后，将在有效行情到达时开始记录。"}</p>}
          <div className={styles.extremes}><span>所选月最佳日 <strong className={styles[tone(summary.best?.profit)]}>{money(summary.best?.profit ?? null, currency)}</strong><small>{summary.best?.date ?? "暂无记录"}</small></span><span>所选月最弱日 <strong className={styles[tone(summary.worst?.profit)]}>{money(summary.worst?.profit ?? null, currency)}</strong><small>{summary.worst?.date ?? "暂无记录"}</small></span></div>
        </div>
      </div>
      <details className={styles.method}><summary>统计口径与记录范围</summary><p>日收益 = 当日未变更持仓数量 ×（最新价 − 昨收价）；日收益率以昨收持仓市值为基数。同日刷新覆盖该日记录，历史日保留最后一次观察值，可能是盘中估算。月度与全部合计仅相加已记录日，不代表完整账户收益。</p><p>当日新增、修改、减仓或清仓无法还原成交过程，该日标记待核验且不计入合计；不含已实现交易收益、手续费、税费和分红。缺少行情或未打开工作台的日期不回填。A 股按上海日期、美股按纽约日期分账，不进行汇率换算。历史仅保存在当前浏览器，清仓后历史记录仍保留。</p></details>
    </section>
  );
}

function Metric({ label, value, detail, tone: valueTone = "neutral" }: { label: string; value: string; detail: string; tone?: "positive" | "negative" | "neutral" }) {
  return <div className={styles.metric}><span>{label}</span><strong className={styles[valueTone]}>{value}</strong><small>{detail}</small></div>;
}
function tone(value: number | null | undefined): "positive" | "negative" | "neutral" { return value == null || value === 0 ? "neutral" : value > 0 ? "positive" : "negative"; }
function money(value: number | null, currency: StockCurrency): string {
  return value === null ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${currency === "USD" ? "$" : "¥"}${Math.abs(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function calendarMoney(value: number): string {
  const absolute = Math.abs(value);
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${absolute >= 10_000 ? `${(absolute / 10_000).toFixed(1)}万` : absolute.toFixed(absolute < 100 ? 2 : 0)}`;
}
function dayStatus(row: EarningsDay | undefined): string {
  if (row?.status === "holdings_changed") return "持仓当日变更，收益待核验";
  if (row?.status === "incomplete_quotes") return `行情不完整（${row.priced}/${row.positions}）`;
  return "暂无当日记录";
}
