"use client";

import { accountStorage, flushAccountStorage, getAccountStorageStatus, subscribeAccountStorageChanges } from "../../lib/accountStorage";

import { useEffect, useRef, useState } from "react";
import SiteBanner from "../../components/SiteBanner";
import { useAppearance } from "../../components/AppearanceProvider";
import { WorkspacePanel, WorkspaceTabs } from "../../components/WorkspaceTabs";
import { useWorkspaceView } from "../../hooks/useWorkspaceView";
import { parseStockRoute } from "../../lib/security";
import {
  JOURNAL_STORAGE_KEY, createReviewEntry, createTradingRule, emptyJournal, journalStats,
  mergeJournal, parseJournal, parseEditingReviewEntry, readJournal, ruleStats, saveJournal, snapshotTradingRule, tradeMetrics,
  validateReviewEntry, validateTradingRule, type JournalState, type ReviewEntry, type TradingRule, type TradingStrategy,
} from "../../lib/tradingJournal";
import ReviewEditor from "./ReviewEditor";
import ReviewDialog from "./ReviewDialog";
import { useReviewQuotes } from "./useReviewQuotes";
import StrategyLibrary from "./StrategyLibrary";
import styles from "./ReviewWorkspace.module.css";

const views = ["journal", "strategies", "rules", "insights"] as const;
const draftKey = "trendsight.review-draft.v1";
const operationLabels = { buy: "买入", sell: "卖出", add: "加仓", reduce: "减仓", observe: "观察" };
const categoryLabels = { entry: "入场", exit: "离场", risk: "风险", discipline: "纪律" };
const ruleStatusLabels = { testing: "待验证", active: "使用中", retired: "已停用" };
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
const money = (value: number | null, market: string) => value == null ? "—" : `${market === "US" ? "$" : "¥"}${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number | null) => value == null ? "—" : `${value.toFixed(1)}%`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

function download(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReviewWorkspace() {
  const { appearance, toggleAppearance } = useAppearance();
  const [view, setView] = useWorkspaceView(views, "journal");
  const [state, setState] = useState<JournalState>(emptyJournal);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [entry, setEntry] = useState<ReviewEntry | null>(null);
  const [baseEntry, setBaseEntry] = useState("");
  const [entryErrors, setEntryErrors] = useState<string[]>([]);
  const [draftSaved, setDraftSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const ownWrites = useRef(new Map<string, string>());
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rule, setRule] = useState<TradingRule | null>(null);
  const [baseRule, setBaseRule] = useState("");
  const [returnToEntry, setReturnToEntry] = useState(false);
  const [ruleErrors, setRuleErrors] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<{ market: string; code: string } | null>(null);
  const [status, setStatus] = useState("all");
  const [market, setMarket] = useState<"all" | "CN" | "US">("all");
  const [month, setMonth] = useState("");
  const [date, setDate] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const [imported, setImported] = useState<JournalState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    document.title = "交易复盘 · TrendSight";
    const frame = requestAnimationFrame(() => {
      setMonth(today().slice(0, 7));
      try {
        const stored = readJournal(accountStorage); setState(stored);
        try {
          const url = new URL(window.location.href);
          const requestedId = url.searchParams.get("entry");
          const requestedEntry = stored.entries.find((item) => item.id === requestedId);
          const stock = parseStockRoute(url.searchParams.get("stock"));
          const rawDraft = accountStorage.getItem(draftKey);
          const cached = rawDraft ? JSON.parse(rawDraft) : null;
          const recovered = cached ? parseEditingReviewEntry(cached.entry) : null;
          const requested = requestedId || url.searchParams.get("compose") === "1";
          const useRecovered = recovered && requested && (requestedId === recovered.id || !window.confirm("打开此记录会替换上次尚未提交的编辑草稿。是否继续？取消将恢复原草稿。"));
          if (useRecovered) {
            setEntry(recovered); setBaseEntry(typeof cached.base === "string" && cached.base ? JSON.stringify(parseEditingReviewEntry(JSON.parse(cached.base))) : "");
            setNotice("已恢复上次未提交的编辑，请检查后保存。");
          } else if (requestedEntry) {
            setEntry(structuredClone(requestedEntry)); setBaseEntry(JSON.stringify(requestedEntry));
          } else if (requestedId) {
            setError("这篇复盘不存在或不属于当前账户，请从历史记录中重新选择。");
          } else if (url.searchParams.get("compose") === "1") {
            setEntry(createReviewEntry(today(), stock ? { ...stock, name: (url.searchParams.get("name") ?? "").slice(0, 80) } : undefined));
          } else if (cached) {
            const recovered = parseEditingReviewEntry(cached.entry);
            const saved = stored.entries.find((item) => item.id === recovered.id);
            // A completed write followed by failed draft cleanup must not reopen stale editing.
            if (!saved || JSON.stringify({ ...recovered, status: saved.status, updatedAt: saved.updatedAt }) !== JSON.stringify(saved)) {
              setEntry(recovered); setBaseEntry(typeof cached.base === "string" && cached.base ? JSON.stringify(parseEditingReviewEntry(JSON.parse(cached.base))) : "");
              setNotice("已恢复上次未提交的编辑，请检查后保存。");
            }
          }
          if (stock) setStockFilter(stock);
          if (requested) clearEntryRoute();
        } catch { setError("编辑草稿无法读取。已保存的复盘不受影响，可重新打开历史记录。"); }
      } catch (reason) { setBlocked(true); setError(`无法读取复盘数据，已暂停写入以保护原记录。${reason instanceof Error ? reason.message : "请重试账户数据同步。"}`); }
      setReady(true);
    });
    const storageChanged = (key: string) => {
      if (key !== JOURNAL_STORAGE_KEY) return;
      try { setState(readJournal(accountStorage)); setNotice("账户记录已更新。正在编辑的内容仍保留，保存时会检查冲突。"); }
      catch { setBlocked(true); setError("其他窗口的数据无法读取，已暂停写入。"); }
    };
    const unsubscribe = subscribeAccountStorageChanges(storageChanged);
    return () => { cancelAnimationFrame(frame); unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!ready || !entry || saving) return;
    let current = true;
    draftTimer.current = setTimeout(async () => {
      try {
        accountStorage.setItem(draftKey, JSON.stringify({ entry, base: baseEntry }));
        await flushAccountStorage();
        if (current) setDraftSaved(true);
      } catch { if (current) setError("编辑草稿尚未同步到个人数据库，内容仍保留，请重试保存。"); }
    }, 700);
    return () => { current = false; if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [entry, baseEntry, ready, saving]);

  useEffect(() => {
    if (!entry && !rule) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [entry, rule]);

  const filtered = state.entries.filter((item) =>
    (!stockFilter || (item.market === stockFilter.market && item.code === stockFilter.code)) &&
    (status === "all" || item.status === status) && (market === "all" || item.market === market) &&
    (!date || item.date === date) && (!fromDate || item.date >= fromDate) && (!toDate || item.date <= toDate) &&
    (!dueOnly || Boolean(item.reviewDate && item.reviewDate <= today())) &&
    (!search || [item.title, item.code, item.name, item.setup, item.lesson, ...item.tags, ...item.mistakes].join(" ").toLowerCase().includes(search.toLowerCase()))
  ).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  const visibleEntries = filtered.slice(0, visibleCount);
  const { quotes, loading: quotesLoading, error: quotesError, refresh } = useReviewQuotes(visibleEntries);
  const totals = journalStats(state.entries);
  const due = state.entries.filter((item) => item.reviewDate && item.reviewDate <= today()).length;
  const draftCount = state.entries.filter((item) => item.status === "draft").length;

  async function commit(update: (latest: JournalState) => JournalState) {
    if (!ready || blocked || savingRef.current) return false;
    const userId = getAccountStorageStatus().userId;
    if (!userId) { setError("请先登录，再保存到个人数据库。"); return false; }
    savingRef.current = true; setSaving(true);
    try {
      const next = update(readJournal(accountStorage));
      saveJournal(accountStorage, next);
      await flushAccountStorage();
      if (getAccountStorageStatus().userId !== userId) throw new Error("登录账户已变化，请在当前账户重新打开复盘。");
      setState(next); setError(""); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请保留当前编辑内容后重试。"); return false; }
    finally { savingRef.current = false; setSaving(false); }
  }
  function assertUnchanged(key: string, current: unknown, base: string, next: unknown) {
    const value = current ? JSON.stringify(current) : "";
    if (value !== base && value !== ownWrites.current.get(key)) throw new Error("这条记录已在其他窗口修改。请导出当前编辑内容，重新打开最新记录后合并，避免覆盖。");
    // A failed/ambiguous request may remain queued. Retrying our own exact write is safe;
    // server revisions still reject external changes before anything is overwritten.
    ownWrites.current.set(key, JSON.stringify(next));
  }
  function clearEntryRoute() {
    const url = new URL(window.location.href);
    url.searchParams.delete("compose"); url.searchParams.delete("entry");
    window.history.replaceState(window.history.state, "", url);
  }
  function clearDraft() {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    try { accountStorage.removeItem(draftKey); void flushAccountStorage().catch(() => setError("复盘已保存，但编辑草稿清理尚未同步，请重试账户同步。")); }
    catch { setError("编辑草稿清理失败，请重试账户同步。"); }
  }
  function closeEntry() {
    if (savingRef.current) return;
    if (entry && JSON.stringify(entry) !== baseEntry && !window.confirm(ownWrites.current.has(`entry:${entry.id}`) && error ? "关闭编辑卡片？保存请求可能仍待同步，关闭不会撤回已提交的保存；之后尚未提交的修改将被放弃。" : "放弃当前尚未提交的编辑？已保存的历史复盘会保留。")) return;
    clearDraft(); clearEntryRoute(); setEntry(null); setEntryErrors([]);
  }
  function openEntry(item?: ReviewEntry) {
    if (savingRef.current) return;
    if (entry && JSON.stringify(entry) !== baseEntry && !window.confirm("切换记录会放弃当前尚未提交的编辑，继续吗？")) return;
    setBaseEntry(item ? JSON.stringify(item) : ""); setEntry(item ? structuredClone(item) : createReviewEntry(date || today(), stockFilter ? { market: stockFilter.market as "CN" | "US", code: stockFilter.code, name: state.entries.find((item) => item.code === stockFilter.code && item.market === stockFilter.market)?.name ?? "" } : undefined));
    setEntryErrors([]); setDraftSaved(false); setView("journal");
    setError("");
  }
  async function persistEntry(complete: boolean, keepOpen = false) {
    if (!entry) return null;
    const next = { ...entry, status: complete ? "complete" as const : "draft" as const, updatedAt: new Date().toISOString() };
    const errors = validateReviewEntry(next, complete); setEntryErrors(errors);
    if (errors.length) return null;
    const saved = await commit((latest) => {
      const existing = latest.entries.find((item) => item.id === next.id);
      assertUnchanged(`entry:${next.id}`, existing, baseEntry, next);
      return { ...latest, entries: [next, ...latest.entries.filter((item) => item.id !== next.id)] };
    });
    if (!saved) return null;
    clearDraft(); if (!keepOpen) clearEntryRoute(); setBaseEntry(JSON.stringify(next)); setEntry(keepOpen ? next : null);
    setNotice(complete ? "复盘已完成。下一次记录时，继续检查你的交易规则。" : "草稿已保存到个人数据库，可以随时继续。");
    return next;
  }
  async function deriveRule() {
    if (rule && !window.confirm("放弃当前尚未保存的规则编辑，改为从这篇复盘提炼规则？")) return;
    const saved = await persistEntry(entry?.status === "complete", true);
    if (!saved) return;
    setRule(createTradingRule(saved)); setBaseRule(""); setRuleErrors([]); setReturnToEntry(true); setView("rules");
    setNotice("来源复盘已保存。把经验写成可检查的条件与动作，再保存为规则。");
  }
  async function createCustomRule() {
    if (rule && !window.confirm("放弃当前尚未保存的规则编辑，创建新的交易规则？")) return;
    const saved = await persistEntry(entry?.status === "complete", true);
    if (!saved) return;
    setRule({ ...createTradingRule(), sourceEntryId: saved.id }); setBaseRule(""); setRuleErrors([]); setReturnToEntry(true); setView("rules");
    setNotice("复盘草稿已保留。保存自定义规则后，会自动加入本次复盘的检查清单。");
  }
  async function persistRule() {
    if (!rule) return;
    const errors = validateTradingRule(rule); setRuleErrors(errors); if (errors.length) return;
    let updatedRule = rule;
    const saved = await commit((latest) => {
      const existing = latest.rules.find((item) => item.id === rule.id);
      const next = { ...rule, version: baseRule ? (JSON.parse(baseRule) as TradingRule).version + 1 : 1, updatedAt: new Date().toISOString() };
      assertUnchanged(`rule:${rule.id}`, existing, baseRule, next);
      updatedRule = next;
      return { ...latest, rules: [next, ...latest.rules.filter((item) => item.id !== rule.id)] };
    });
    if (saved) {
      setRule(null);
      if (returnToEntry && entry && updatedRule.status !== "retired") {
        setEntry({ ...entry, ruleChecks: [...entry.ruleChecks.filter((check) => check.ruleId !== updatedRule.id), snapshotTradingRule(updatedRule)] });
        setDraftSaved(false); setView("journal"); setNotice("自定义规则已保存并加入本次检查。请选择执行结果，再保存复盘。");
      } else setNotice("规则已保存。历史复盘保留原版本，新记录可选择新版本进行检查。");
      setReturnToEntry(false);
    }
  }
  async function persistStrategy(strategy: TradingStrategy, base: string) {
    const saved = await commit((latest) => {
      const current = latest.strategies.find((item) => item.id === strategy.id);
      const next = { ...strategy, updatedAt: new Date().toISOString() };
      assertUnchanged(`strategy:${strategy.id}`, current, base, next);
      return { ...latest, strategies: [next, ...latest.strategies.filter((item) => item.id !== strategy.id)] };
    });
    if (saved) setNotice("策略已保存。下一篇复盘可直接载入策略与规则，历史名称与检查快照保持不变。");
    return saved;
  }
  async function removeEntry(item: ReviewEntry) {
    if (state.rules.some((r) => r.sourceEntryId === item.id)) { setError("这条复盘是交易规则的来源，需保留以便追溯。"); return; }
    if (!window.confirm(`删除“${item.title || "未命名复盘"}”？此操作无法撤销，建议先导出备份。`)) return;
    if (await commit((latest) => {
      if (latest.rules.some((r) => r.sourceEntryId === item.id)) throw new Error("该复盘已关联规则，不能删除。");
      const current = latest.entries.find((r) => r.id === item.id);
      if (current && JSON.stringify(current) !== JSON.stringify(item)) throw new Error("该记录已在其他窗口更新，请刷新后重试。");
      return { ...latest, entries: latest.entries.filter((r) => r.id !== item.id) };
    })) { if (entry?.id === item.id) { clearDraft(); setEntry(null); } setNotice("复盘记录已删除。"); }
  }

  function closeRule() {
    if (savingRef.current || !window.confirm("放弃未保存的规则编辑？")) return;
    setRule(null); if (returnToEntry) setView("journal"); setReturnToEntry(false);
  }

  return <div className={styles.page}>
    <SiteBanner activePage="review" appearance={appearance} onToggleAppearance={toggleAppearance} statusText="复盘与规则 · 账户同步" />
    <main className={styles.main}>
      <header className={styles.hero}>
        <div><h1>交易复盘</h1><p>记录当时的判断，回看之后的变化，逐步建立自己的交易规则。</p></div>
        <button className={styles.primary} disabled={!ready || blocked || saving} onClick={() => openEntry()}>＋ 写一篇复盘</button>
      </header>
      <div className={styles.stats}>
        <div><span>已完成复盘</span><strong>{totals.completed}<small> 篇</small></strong><p>用记录积累判断的依据</p></div>
        <button onClick={() => { setStatus("draft"); setView("journal"); }}><span>待完成草稿</span><strong>{draftCount}<small> 篇</small></strong><p>接着上一次的思考</p></button>
        <div><span>规则执行率</span><strong>{percent(totals.executionRate)}</strong><p>{totals.followedChecks + totals.brokenChecks} 次已评价检查 · 不以盈亏评纪律</p></div>
        <button onClick={() => { setDueOnly(true); setDate(""); setFromDate(""); setToDate(""); setStatus("all"); setView("journal"); }}><span>到期复核</span><strong>{due}<small> 篇</small></strong><p>回看计划是否需要调整</p></button>
      </div>
      {notice && <p className={styles.notice} role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}>×</button></p>}
      {error && <div className={styles.error} role="alert">{error}{entry && <button onClick={() => download(JSON.stringify({ version: 1, entries: [entry], rules: state.rules, strategies: state.strategies }, null, 2), "复盘编辑备份.json")}>导出当前编辑</button>}{blocked && <button onClick={() => { try { download(accountStorage.getItem(JOURNAL_STORAGE_KEY) ?? "null", "复盘原始数据.json"); } catch { setError("账户数据暂不可读，无法导出。请稍后重试。"); } }}>备份原始数据</button>}</div>}
      <div className={styles.toolbar}>
        <WorkspaceTabs id="review" label="复盘工作区" sticky={false} tabs={[{ id: "journal", label: "复盘记录", count: state.entries.length }, { id: "strategies", label: "交易策略", count: state.strategies.length }, { id: "rules", label: "交易规则", count: state.rules.length }, { id: "insights", label: "复盘洞察" }]} value={view} onChange={setView} />
        <div className={styles.actions}><button disabled={!ready} onClick={() => download(JSON.stringify(state, null, 2), `TrendSight-复盘-${today()}.json`)}>导出备份</button><button disabled={!ready || blocked || saving} onClick={() => fileRef.current?.click()}>导入备份</button>
          <input ref={fileRef} className={styles.hidden} type="file" accept=".json,application/json" aria-label="导入复盘备份文件" onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
            try { if (file.size > 8 * 1024 * 1024) throw new Error("备份文件不能超过 8 MB。"); setImported(parseJournal(JSON.parse(await file.text()))); }
            catch (reason) { setError(`导入失败：${reason instanceof Error ? reason.message : "无效的备份文件"}`); }
          }} />
        </div>
      </div>
      {imported && <div className={styles.importBox}><p>备份包含 {imported.entries.length} 篇复盘、{imported.rules.length} 条规则、{imported.strategies.length} 个策略。仅补入新记录；相同 ID 的不同内容保留当前账户版本。</p><button className={styles.primary} disabled={saving} onClick={async () => {
        let message = "";
        if (await commit((latest) => { const merged = mergeJournal(latest, imported); message = `已导入 ${merged.addedEntries} 篇复盘、${merged.addedRules} 条规则、${merged.addedStrategies} 个策略。${merged.conflicts.length ? `${merged.conflicts.length} 项冲突保留当前账户版本，请保留原备份。` : ""}`; return merged.state; })) { setNotice(message); setImported(null); }
      }}>确认合并</button><button onClick={() => setImported(null)}>取消</button></div>}
      <WorkspacePanel id="review" view="journal" active={view}>
        {!ready ? <p className={styles.empty} role="status">正在读取你的复盘记录…</p> : <>

          <div className={styles.journalGrid}>
            <aside className={styles.sidebar}>
              <ReviewCalendar month={month} onMonth={setMonth} entries={state.entries} date={date} onDate={(next) => setDate(next === date ? "" : next)} />
              <section className={styles.tip}><span className={styles.eyebrow}>一个小习惯</span><h3>先复盘过程，再看结果</h3><p>盈利不一定来自好决策，亏损也不一定代表执行有误。把“做得对”和“赚到了”分开记录。</p><ol><li>当时为什么操作？</li><li>有没有遵守自己的规则？</li><li>下次具体做什么？</li></ol></section>
            </aside>
            <section className={styles.records} aria-label="历史复盘记录">
              <div className={styles.sectionHeading}><div><h2>我的复盘</h2><p>{filtered.length} 篇记录{stockFilter ? ` · ${stockFilter.code}` : ""}{date ? ` · ${date}` : ""}</p></div><button onClick={refresh} disabled={quotesLoading || !filtered.some((e) => e.code)}>{quotesLoading ? "更新行情…" : "刷新最新价"}</button></div>
              <div className={styles.filters}>
                <label className={styles.search}>搜索记录<input type="search" placeholder="股票、策略、标签或心得" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
                <label>记录状态<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="complete">已完成</option></select></label>
                <label>市场<select value={market} onChange={(e) => setMarket(e.target.value as typeof market)}><option value="all">全部市场</option><option value="CN">A 股 / CNY</option><option value="US">美股 / USD</option></select></label>
                <label>开始日期<input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setDate(""); }} /></label><label>结束日期<input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setDate(""); }} /></label>
              </div>
              <div className={styles.filterMeta}><label><input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} /> 只看待复核</label><button onClick={() => { setSearch(""); setStockFilter(null); setStatus("all"); setMarket("all"); setDate(""); setFromDate(""); setToDate(""); setDueOnly(false); }}>重置筛选</button></div>
              <p className={styles.scope}>操作后涨跌 = 最新价相对操作时价格的变化，按原币种、未复权价格比较，不含分红、费用，也不代表账户盈亏。拆股或除权可能影响可比性。</p>
              {quotesError && <p className={styles.error} role="status">{quotesError}</p>}
              {!filtered.length ? <div className={styles.empty}><span className={styles.emptyIcon} aria-hidden="true">↗</span><h3>{state.entries.length ? "没有符合条件的复盘" : "从第一篇复盘开始"}</h3><p>{state.entries.length ? "调整筛选条件，或选择另一个日期。" : "一次交易、一次观望，都值得记录。写下理由、价格和下一步，让经验可追溯。"}</p><button disabled={blocked} className={styles.primary} onClick={() => openEntry()}>记录一次交易或观察</button></div> : <div className={styles.recordList}>{visibleEntries.map((item) => {
                const quote = quotes[`${item.market}:${item.code.trim().toUpperCase()}`];
                const comparable = item.date <= today() && quote && quote.asOfDate && quote.asOfDate >= item.date;
                const delta = comparable && item.operationPrice && item.operationPrice > 0 ? (quote.price / item.operationPrice - 1) * 100 : null;
                const metrics = tradeMetrics(item);
                return <article key={item.id} className={styles.record}>
                  <header><div className={styles.recordDate}><time>{item.date}</time><span data-complete={item.status === "complete"}>{item.status === "complete" ? "已完成" : "草稿"}</span>{item.reviewDate && item.reviewDate <= today() && <span>待复核</span>}</div><div className={styles.rowActions}><button aria-label={`编辑${item.title || "未命名复盘"}`} onClick={() => openEntry(item)}>编辑</button><button aria-label={`删除${item.title || "未命名复盘"}`} onClick={() => removeEntry(item)}>删除</button></div></header>
                  <h3><button onClick={() => openEntry(item)}>{item.title || "未命名复盘"}</button></h3>
                  <p className={styles.identity}>{item.code ? <a href={`/?stock=${encodeURIComponent(item.market === "US" ? `US:${item.code}` : item.code)}`}>{item.name || item.code} <span>{item.code} · {item.market === "US" ? "美股" : "A 股"} ↗</span></a> : "市场观察"}<span>{operationLabels[item.operation]}</span>{item.setup && <span>{item.setup}</span>}</p>
                  <div className={styles.priceStrip}>
                    <div><span>操作时价格</span><strong>{money(item.operationPrice, item.market)}</strong></div>
                    <div><span>最新行情价</span><strong>{money(quote?.price ?? null, item.market)}</strong></div>
                    <div><span>操作后标的涨跌</span><strong data-direction={delta == null ? "" : delta > 0 ? "up" : delta < 0 ? "down" : ""}>{delta == null ? "—" : `${signed(delta)}%`}</strong>{delta != null && quote && item.operationPrice != null && <small>{signed(quote.price - item.operationPrice)} {item.market === "US" ? "USD" : "CNY"}</small>}</div>
                    {item.kind === "trade" && <div><span>已实现净盈亏</span><strong>{money(metrics.netPnl, item.market)}</strong><small>{metrics.netPnl == null ? "待补齐平仓与费用" : "按手动录入成交计算"}</small></div>}
                  </div>
                  <p className={styles.quoteTime}>{quote ? `行情时点：${quote.updatedAt || "数据源未提供"}${!comparable ? " · 行情日期不足以验证操作后变化，暂不计算涨跌" : ""}` : item.code ? quotesLoading ? "正在获取最新行情…" : "暂无可用行情，可稍后刷新" : "填写标的与操作时价格后可跟踪涨跌"}</p>
                  {item.lesson && <p className={styles.lesson}>{item.lesson}</p>}
                  {item.nextAction && <p className={styles.next}><span>下一步</span>{item.nextAction}{item.reviewDate && <time> · {item.reviewDate} 复核</time>}</p>}
                  <div className={styles.tags}>{item.tags.map((tag) => <button key={tag} onClick={() => setSearch(tag)}>#{tag}</button>)}{item.mistakes.map((tag) => <button key={tag} data-mistake onClick={() => setSearch(tag)}>{tag}</button>)}{item.ruleChecks.length > 0 && <span>规则检查 {item.ruleChecks.filter((c) => c.result !== "pending").length}/{item.ruleChecks.length}</span>}</div>
                </article>;
              })}</div>}
              {filtered.length > visibleCount && <button className={styles.loadMore} onClick={() => setVisibleCount((count) => count + 20)}>加载更多记录 · 还有 {filtered.length - visibleCount} 篇</button>}
            </section>
          </div>
        </>}
      </WorkspacePanel>
      <WorkspacePanel id="review" view="strategies" active={view}><StrategyLibrary strategies={state.strategies} rules={state.rules} entries={state.entries} onSave={persistStrategy} disabled={!ready || blocked || saving} onOpenEntry={openEntry} /></WorkspacePanel>
      <WorkspacePanel id="review" view="rules" active={view}>
        <div className={styles.sectionHeading}><div><h2>把经验变成可执行的规则</h2><p>写清适用条件、具体动作和失效条件。在复盘中逐条检查，积累样本后再调整。</p></div><button disabled={!ready || blocked || saving} className={styles.primary} onClick={() => { if (rule && !window.confirm("放弃当前规则编辑并新建？")) return; setRule(createTradingRule()); setBaseRule(""); setRuleErrors([]); setReturnToEntry(false); }}>＋ 新建规则</button></div>

        {!state.rules.length && !rule && <div className={styles.empty}><h3>你的交易规则，从真实经验中生长</h3><p>在复盘结论中点击“沉淀为规则”，保留来源记录；也可以直接创建自己的第一条规则。</p></div>}
        <div className={styles.rulesGrid}>{state.rules.map((item) => {
          const stats = ruleStats(item.id, state.entries); const source = state.entries.find((e) => e.id === item.sourceEntryId);
          return <article className={styles.ruleCard} key={item.id}><div className={styles.ruleMeta}><span>{categoryLabels[item.category]} · {ruleStatusLabels[item.status]}</span><span>v{item.version}</span></div><h3>{item.title}</h3><dl><dt>如果</dt><dd>{item.condition}</dd><dt>那么</dt><dd>{item.action}</dd><dt>失效条件</dt><dd>{item.invalidation}</dd></dl><div className={styles.ruleScore}><strong>{percent(stats.executionRate)}</strong><span>执行率 · {stats.sampleCount} 次评价<br />遵守 {stats.followed} / 违反 {stats.broken} · 跨历史版本</span></div><div className={styles.actions}><button onClick={() => { if (rule && !window.confirm("放弃当前规则编辑？")) return; setRule(structuredClone(item)); setBaseRule(JSON.stringify(item)); setRuleErrors([]); setReturnToEntry(false); }}>编辑规则</button>{source && <button onClick={() => openEntry(source)}>查看来源复盘 ↗</button>}</div></article>;
        })}</div>
      </WorkspacePanel>
      <WorkspacePanel id="review" view="insights" active={view}>
        <div className={styles.sectionHeading}><div><h2>看见重复的模式</h2><p>统计范围：全部已保存复盘。仅完整平仓记录计入收益，未知费用不会按零估算。</p></div></div>
        <div className={styles.rulesGrid}>{(["CN", "US"] as const).map((currency) => { const stats = journalStats(state.entries, currency); return <section key={currency} className={styles.ruleCard}><h3>{currency === "CN" ? "A 股 · CNY" : "美股 · USD"}</h3><div className={styles.insightNumbers}><div><span>已实现净盈亏</span><strong>{money(stats.netPnl, currency)}</strong></div><div><span>盈利比例</span><strong>{percent(stats.winRate)}</strong></div><div><span>完整平仓样本</span><strong>{stats.closedTrades} <small>笔</small></strong></div></div><p className={styles.scope}>手动录入的交易样本，不等同于完整账户收益；小样本不能证明规则有效。</p></section>; })}</div>
        <div className={styles.rulesGrid}><PatternList title="反复出现的执行偏差" entries={state.entries} field="mistakes" onSelect={(tag) => { setSearch(tag); setView("journal"); }} /><PatternList title="我的策略与观察标签" entries={state.entries} field="tags" onSelect={(tag) => { setSearch(tag); setView("journal"); }} /></div>
        <section className={styles.tip}><h3>下一次复盘，验证一个具体改变</h3><p>选择出现频率最高的偏差，写下一条“如果……那么……”的规则。下一笔操作时检查它，复盘时记录是否遵守及原因。执行率只衡量纪律，不预测收益。</p><button onClick={() => setView("rules")}>查看我的交易规则 →</button></section>
      </WorkspacePanel>
      <ReviewDialog open={Boolean(rule)} title={baseRule ? "编辑交易规则" : "新建交易规则"} onClose={closeRule} busy={saving}>
        {rule && <form className={styles.ruleForm} onSubmit={(e) => { e.preventDefault(); void persistRule(); }}>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {ruleErrors.length > 0 && <ul className={styles.error} role="alert">{ruleErrors.map((text) => <li key={text}>{text}</li>)}</ul>}
          <fieldset className={styles.formGrid} disabled={saving}>
            <label className={styles.wide}>规则名称<input required maxLength={120} value={rule.title} onChange={(e) => setRule({ ...rule, title: e.target.value })} placeholder="例如：没有明确失效条件，不开仓" /></label>
            <label>规则类别<select value={rule.category} onChange={(e) => setRule({ ...rule, category: e.target.value as TradingRule["category"] })}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>使用状态<select value={rule.status} onChange={(e) => setRule({ ...rule, status: e.target.value as TradingRule["status"] })}>{Object.entries(ruleStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>适用 / 触发条件<textarea required maxLength={4000} value={rule.condition} onChange={(e) => setRule({ ...rule, condition: e.target.value })} placeholder="什么情形下需要执行这条规则？" /></label>
            <label>具体执行动作<textarea required maxLength={4000} value={rule.action} onChange={(e) => setRule({ ...rule, action: e.target.value })} placeholder="做什么、何时做、如何判断已完成？" /></label>
            <label className={styles.wide}>例外 / 失效条件<textarea required maxLength={4000} value={rule.invalidation} onChange={(e) => setRule({ ...rule, invalidation: e.target.value })} placeholder="何时不适用？什么证据出现时要重新评估？" /></label>
          </fieldset><div className={styles.actions}><button type="submit" disabled={saving} className={styles.primary}>{saving ? "保存中…" : "保存规则"}</button><button type="button" disabled={saving} onClick={closeRule}>取消</button></div>
        </form>}
      </ReviewDialog>
      <ReviewDialog open={Boolean(entry) && !rule} title={entry?.status === "complete" ? "编辑已完成复盘" : "记录复盘"} onClose={closeEntry} busy={saving}>
        {entry && <div className={styles.editor}>
          <p className={styles.draftStatus} role="status">{saving ? "正在保存到个人数据库…" : draftSaved ? "编辑草稿已同步 · 提交后进入历史记录" : "编辑内容将自动暂存到你的账户"}</p>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <ReviewEditor key={entry.id} entry={entry} strategies={state.strategies} rules={state.rules} saving={saving} onCreateRule={createCustomRule} onChange={(next) => { setEntry(next); setDraftSaved(false); }} onSave={persistEntry} onCancel={closeEntry} onDeriveRule={deriveRule} errors={entryErrors} />
        </div>}
      </ReviewDialog>
      <footer className={styles.footer}>复盘、编辑草稿与交易规则自动同步到账户数据库。请确认顶部同步状态后离开；导入时保留当前账户冲突版本。<br />行情来自平台现有数据源，可能存在延迟。复盘用于检验个人决策过程。</footer>
    </main>
  </div>;
}

function ReviewCalendar({ month, onMonth, entries, date, onDate }: { month: string; onMonth: (value: string) => void; entries: ReviewEntry[]; date: string; onDate: (value: string) => void }) {
  if (!month) return null;
  const [year, m] = month.split("-").map(Number);
  const offset = (new Date(year, m - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, m, 0).getDate();
  const move = (n: number) => { const next = new Date(year, m - 1 + n, 1); onMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`); };
  return <section className={styles.calendar} aria-label="复盘日历"><header><button aria-label="上个月" onClick={() => move(-1)}>‹</button><strong>{year} 年 {m} 月</strong><button aria-label="下个月" onClick={() => move(1)}>›</button></header><div className={styles.calendarGrid}>{["一", "二", "三", "四", "五", "六", "日"].map((d) => <span key={d}>{d}</span>)}{Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}{Array.from({ length: days }, (_, i) => { const day = `${month}-${String(i + 1).padStart(2, "0")}`; const count = entries.filter((e) => e.date === day).length; return <button key={day} aria-label={`${day}，${count} 篇复盘`} aria-pressed={date === day} data-today={day === today()} onClick={() => onDate(day)}>{i + 1}{count > 0 && <i aria-hidden="true" />}</button>; })}</div><p>圆点表示已有记录 · 点击日期筛选</p><button className={styles.calendarReset} onClick={() => { onMonth(today().slice(0, 7)); onDate(""); }}>回到本月 · 查看全部记录</button></section>;
}

function PatternList({ title, entries, field, onSelect }: { title: string; entries: ReviewEntry[]; field: "mistakes" | "tags"; onSelect: (value: string) => void }) {
  const counts = new Map<string, number>();
  entries.forEach((entry) => [...new Set(entry[field])].forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
  const rows = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return <section className={styles.ruleCard}><h3>{title}</h3>{rows.length ? <div className={styles.patterns}>{rows.map(([tag, count]) => <button key={tag} onClick={() => onSelect(tag)}><span>{tag}</span><span>{count} 篇 ↗</span><i style={{ width: `${count / rows[0][1] * 100}%` }} /></button>)}</div> : <p className={styles.scope}>在复盘中添加标签后，这里会展示出现频率。点击可回看原始记录。</p>}</section>;
}
