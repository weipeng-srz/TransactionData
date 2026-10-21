"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createTradingStrategy, validateTradingStrategy, type TradingStrategy, type TradingRule, type ReviewEntry } from "../../lib/tradingJournal";
import styles from "./StrategyLibrary.module.css";

type StrategyLibraryProps = {
  strategies: TradingStrategy[];
  rules: TradingRule[];
  entries: ReviewEntry[];
  onSave: (strategy: TradingStrategy, base: string) => boolean | Promise<boolean>;
  disabled?: boolean;
  onOpenEntry?: (entry: ReviewEntry) => void;
};
type StrategyEditor = { draft: TradingStrategy; base: string; initial: string };

export default function StrategyLibrary({ strategies, rules, entries, onSave, disabled = false, onOpenEntry }: StrategyLibraryProps) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<StrategyEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "archived">("all");
  const [search, setSearch] = useState("");
  const dirty = Boolean(editor && JSON.stringify(editor.draft) !== editor.initial);
  const draftId = editor?.draft.id;
  const query = search.trim().toLowerCase();
  const filtered = strategies.filter((strategy) => (status === "all" || strategy.status === status)
    && (!query || `${strategy.name} ${strategy.description}`.toLowerCase().includes(query)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const activeCount = strategies.filter((strategy) => strategy.status === "active").length;

  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  useEffect(() => { if (draftId) nameRef.current?.focus(); }, [draftId]);
  useEffect(() => { if (errors.length) errorRef.current?.focus(); }, [errors]);

  function openEditor(strategy?: TradingStrategy) {
    if (disabled || (dirty && !window.confirm("放弃当前尚未保存的策略编辑？"))) return;
    const draft = strategy ? { ...strategy, ruleIds: [...strategy.ruleIds] } : createTradingStrategy();
    setEditor({ draft, base: strategy ? JSON.stringify(strategy) : "", initial: JSON.stringify(draft) });
    setErrors([]); setNotice("");
  }
  function updateDraft(patch: Partial<TradingStrategy>) {
    if (disabled) return;
    setEditor((current) => current ? { ...current, draft: { ...current.draft, ...patch } } : null);
  }
  function closeEditor() {
    if (saving) return;
    if (dirty && !window.confirm("放弃当前尚未保存的策略编辑？已保存的策略会保留。")) return;
    setEditor(null); setErrors([]);
  }
  async function saveStrategy() {
    if (!editor || disabled || saving) return;
    const next = { ...editor.draft, name: editor.draft.name.trim(), description: editor.draft.description.trim() };
    const nextErrors = validateTradingStrategy(next);
    // Retired or unavailable rules may remain on an existing strategy for
    // historical context, but cannot be newly selected into another strategy.
    const originalRuleIds = new Set<string>(editor.base ? (JSON.parse(editor.base) as TradingStrategy).ruleIds : []);
    if (next.ruleIds.some((ruleId) => !originalRuleIds.has(ruleId) && !rules.some((rule) => rule.id === ruleId && rule.status !== "retired"))) {
      nextErrors.push("部分新选规则已停用或不可用，请移除后保存。");
    }
    setErrors(nextErrors);
    if (nextErrors.length) return;
    setSaving(true);
    try {
      if (!await onSave(next, editor.base)) {
        setErrors(["策略保存失败，编辑内容已保留。请处理页面提示后重试。"]);
        return;
      }
      setEditor(null);
      setNotice(next.status === "archived" ? "策略已停用，历史复盘与规则关联仍然保留。" : "策略已保存，新复盘可以选择这套策略。");
    } catch (reason) {
      setErrors([`策略保存失败，编辑内容已保留。${reason instanceof Error ? reason.message : "请稍后重试。"}`]);
    } finally { setSaving(false); }
  }

  return <section className={styles.library} aria-labelledby={`${id}-heading`}>
    <header className={styles.heading}>
      <div><h2 id={`${id}-heading`}>把规则组织成自己的交易策略</h2><p>写清适用场景，组合需要执行的规则，再用复盘持续检验。</p></div>
      <button type="button" className={styles.primary} disabled={disabled || saving} onClick={() => openEditor()}>＋ 新建策略</button>
    </header>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {editor && <form className={styles.editor} noValidate onSubmit={(event) => { event.preventDefault(); saveStrategy(); }}>
      <div className={styles.editorHeading}><h3>{editor.base ? "编辑交易策略" : "建立一套交易策略"}</h3><span>{dirty ? "有未保存的修改" : "填写后保存到策略库"}</span></div>
      {errors.length > 0 && <div className={styles.errors} role="alert" ref={errorRef} tabIndex={-1}><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
      <fieldset className={styles.fields} disabled={disabled || saving}>
        <label className={styles.field}>策略名称 <small>必填</small><input ref={nameRef} value={editor.draft.name} maxLength={300} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="例如：趋势回踩确认" autoComplete="off" /></label>
        <label className={styles.field}>使用状态<select value={editor.draft.status} onChange={(event) => updateDraft({ status: event.target.value as TradingStrategy["status"] })}><option value="active">使用中 · 可用于新复盘</option><option value="archived">已停用 · 保留历史记录</option></select></label>
        <label className={`${styles.field} ${styles.wide}`}>适用场景与策略说明 <small>选填</small><textarea rows={4} maxLength={20000} value={editor.draft.description} onChange={(event) => updateDraft({ description: event.target.value })} placeholder="什么市场环境与交易形态适用？观察哪些证据？何时放弃？" /></label>
      </fieldset>
      <fieldset className={styles.rulePicker} disabled={disabled || saving}><legend>关联交易规则 <small>{editor.draft.ruleIds.length} 条已选</small></legend>
        <p>选择使用中或待验证的规则。新复盘会载入当时的规则内容，历史检查不会被之后的修改覆盖。</p>
        <div className={styles.ruleOptions}>{rules.filter((rule) => rule.status !== "retired" || editor.draft.ruleIds.includes(rule.id)).map((rule) => <label key={rule.id} className={styles.ruleOption} data-retired={rule.status === "retired"}>
          <input type="checkbox" checked={editor.draft.ruleIds.includes(rule.id)} onChange={(event) => updateDraft({ ruleIds: event.target.checked ? [...new Set([...editor.draft.ruleIds, rule.id])] : editor.draft.ruleIds.filter((ruleId) => ruleId !== rule.id) })} />
          <span><strong>{rule.title}</strong><small>{rule.status === "retired" ? "已停用 · 仅保留历史关联，不用于新复盘；取消勾选可移除" : rule.status === "testing" ? "待验证" : "使用中"} · v{rule.version}</small><span>{rule.condition || rule.action}</span></span>
        </label>)}</div>
        {editor.draft.ruleIds.filter((ruleId) => !rules.some((rule) => rule.id === ruleId)).map((ruleId) => <label key={ruleId} className={styles.ruleOption} data-retired="true"><input type="checkbox" checked onChange={() => updateDraft({ ruleIds: editor.draft.ruleIds.filter((value) => value !== ruleId) })} /><span><strong>关联规则暂不可用</strong><small>{ruleId} · 不用于新复盘，取消勾选可移除</small></span></label>)}
        {!rules.some((rule) => rule.status !== "retired") && !editor.draft.ruleIds.length && <p className={styles.emptyRules}>还没有可选规则。可以先保存策略，再到「交易规则」建立检查项。</p>}
      </fieldset>
      <footer className={styles.editorFooter}><p>{editor.draft.status === "archived" ? "停用后不再用于新复盘，历史记录与样本仍然保留。" : "调整策略名称和规则组合，只影响之后选择策略的复盘。"}</p><div><button type="button" disabled={saving} onClick={closeEditor}>取消编辑</button><button type="submit" className={styles.primary} disabled={disabled || saving}>{editor.draft.status === "archived" ? "保存为停用策略" : "保存策略"}</button></div></footer>
    </form>}
    <div className={styles.filters}>
      <label>搜索策略<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名称或适用场景" /></label>
      <label>策略状态<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部策略</option><option value="active">使用中</option><option value="archived">已停用</option></select></label>
      <span>{activeCount} 个使用中 · {strategies.length - activeCount} 个已停用</span>
    </div>
    {!filtered.length ? <div className={styles.empty}><h3>{strategies.length ? "没有符合筛选的策略" : "从一套能执行的策略开始"}</h3><p>{strategies.length ? "调整名称或状态筛选，查看其他策略。" : "给你的交易方法起个名字，把适用场景与执行规则放在一起。"}</p>{strategies.length ? <button type="button" onClick={() => { setSearch(""); setStatus("all"); }}>清除筛选</button> : <button type="button" disabled={disabled || saving} onClick={() => openEditor()}>建立第一套策略</button>}</div> : <div className={styles.cards}>{filtered.map((strategy) => {
      const samples = entries.filter((entry) => entry.strategyId === strategy.id).sort((left, right) => right.date.localeCompare(left.date));
      const completed = samples.filter((entry) => entry.status === "complete").length;
      const availableRuleCount = strategy.ruleIds.filter((ruleId) => rules.some((rule) => rule.id === ruleId && rule.status !== "retired")).length;
      return <article className={styles.card} key={strategy.id}>
        <header><span className={styles.badge} data-active={strategy.status === "active"}>{strategy.status === "active" ? "使用中" : "已停用"}</span><button type="button" disabled={disabled || saving} onClick={() => openEditor(strategy)} aria-label={`编辑策略 ${strategy.name}`}>编辑策略</button></header>
        <h3>{strategy.name}</h3><p className={styles.description}>{strategy.description || "尚未补充适用场景，可通过编辑策略完善。"}</p>
        <dl className={styles.metrics}><div><dt>关联规则</dt><dd>{strategy.ruleIds.length}<small> 条 · {availableRuleCount} 条可用</small></dd></div><div><dt>复盘样本</dt><dd>{samples.length}<small> 篇 · {completed} 篇已完成</small></dd></div></dl>
        {strategy.ruleIds.length > 0 && <div className={styles.ruleTags}>{strategy.ruleIds.map((ruleId) => { const rule = rules.find((item) => item.id === ruleId); return <span key={ruleId} data-unavailable={!rule || rule.status === "retired"}>{rule?.title || "规则不可用"}{rule?.status === "retired" ? " · 已停用" : ""}</span>; })}</div>}
        {samples.length > 0 ? <details className={styles.samples}><summary>回看关联复盘（{samples.length} 篇）</summary><ul>{samples.map((entry) => <li key={entry.id}>{onOpenEntry ? <button type="button" onClick={() => onOpenEntry(entry)}><span>{entry.title || "未命名复盘"}</span><small>{entry.date} · {entry.status === "complete" ? "已完成" : "草稿"}</small></button> : <span>{entry.title || "未命名复盘"} · {entry.date}</span>}</li>)}</ul></details> : <p className={styles.sampleHint}>在复盘中选择此策略后，样本会汇总到这里。</p>}
        {strategy.status === "archived" && <p className={styles.sampleHint}>已停止用于新复盘，历史名称和规则检查仍按当时记录保留。</p>}
      </article>;
    })}</div>}
  </section>;
}
