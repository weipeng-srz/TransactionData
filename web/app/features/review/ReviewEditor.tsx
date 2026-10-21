"use client";

import { cloneElement, useId, useRef, useState, type ReactElement, type InputHTMLAttributes } from "react";
import { tradeMetrics, type ReviewEntry, type TradingRule, type TradingStrategy } from "../../lib/tradingJournal";
import { stockRouteKey } from "../../lib/security";
import { focusReviewError, reviewValidation, type ReviewFieldErrors } from "./reviewValidation";
import styles from "./ReviewEditor.module.css";

type ReviewEditorProps = {
  entry: ReviewEntry;
  rules: TradingRule[];
  strategies?: TradingStrategy[];
  onChange: (entry: ReviewEntry) => void;
  onSave: (complete: boolean) => void;
  onCancel: () => void;
  onDeriveRule: () => void;
  onCreateRule: () => void;
  errors: string[];
  saving?: boolean;
};

const commonMistakes = ["追涨杀跌", "计划外交易", "未执行止损", "过早止盈", "仓位过重", "频繁交易", "忽视市场环境", "情绪化决策"];
const emotions = ["平静", "自信", "犹豫", "焦虑", "贪婪", "恐惧", "懊悔", "冲动"];

function EditorField({ label, required, hint, children, wide = false, name, id, error }: {
  label: string; required?: boolean; hint?: string; children: ReactElement<InputHTMLAttributes<HTMLInputElement>>; wide?: boolean;
  name: string; id: string; error?: string;
}) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  return <label className={`${styles.field} ${wide ? styles.wide : ""}`} htmlFor={id}>
    <span className={styles.label}>{label}<small>{required ? "必填" : "选填"}</small></span>
    {cloneElement(children, { id, name, "data-field": name, "aria-required": required || undefined, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy } as InputHTMLAttributes<HTMLInputElement>)}
    {error && <span id={`${id}-error`} className={styles.fieldError}>{error}</span>}
    {hint && <span id={`${id}-hint`} className={styles.hint}>{hint}</span>}
  </label>;
}

function metricText(value: number | null | undefined, suffix = "", signed = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${signed && value > 0 ? "+" : ""}${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${suffix}`;
}

export default function ReviewEditor({ entry, rules, strategies = [], onChange, onSave, onCancel, onDeriveRule, onCreateRule, errors, saving = false }: ReviewEditorProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [validationMode, setValidationMode] = useState<boolean | null>(null);
  const [nativeErrors, setNativeErrors] = useState<ReviewFieldErrors>({});
  const [tagInput, setTagInput] = useState("");
  const [mistakeInput, setMistakeInput] = useState("");
  const [selectedRule, setSelectedRule] = useState("");
  const metrics = tradeMetrics(entry);
  const currency = entry.market === "US" ? "美元" : "元";
  const availableRules = rules.filter((rule) => rule.status !== "retired" && !entry.ruleChecks.some((check) => check.ruleId === rule.id));
  const reviewedRules = entry.ruleChecks.filter((check) => check.result !== "pending").length;
  const linkedStrategy = strategies.find((strategy) => strategy.id === entry.strategyId);
  const validation = reviewValidation(entry, validationMode ?? false);
  const fieldErrors = validationMode === null ? {} : { ...validation.fields, ...nativeErrors };
  const sections = [
    { anchor: "record", number: "01", title: "交易档案" },
    { anchor: "plan", number: "02", title: "计划与执行" },
    { anchor: "behavior", number: "03", title: "行为与规则" },
    { anchor: "reflection", number: "04", title: "总结与行动" },
  ];

  function field(name: string) {
    return { name, id: `${id}-${encodeURIComponent(name)}`, error: fieldErrors[name] };
  }

  function save(complete: boolean, proceed?: () => void) {
    if (saving) return;
    setValidationMode(complete);
    const next = reviewValidation(entry, complete);
    const invalidInputs: ReviewFieldErrors = {};
    for (const control of Array.from(formRef.current?.querySelectorAll<HTMLInputElement>("input[data-field]") ?? [])) {
      if (control.validity.badInput) invalidInputs[control.dataset.field ?? ""] = "请输入有效的数字或日期";
    }
    setNativeErrors(invalidInputs);
    const invalidFields = { ...next.fields, ...invalidInputs };
    if (next.errors.length || Object.keys(invalidInputs).length) {
      focusReviewError(formRef.current, invalidFields);
      return;
    }
    if (proceed) proceed();
    else onSave(complete);
  }

  function update<K extends keyof ReviewEntry>(key: K, value: ReviewEntry[K]) {
    onChange({ ...entry, [key]: value });
  }

  function numberValue(value: string): number | null {
    return value.trim() === "" ? null : Number(value);
  }

  function addTag() {
    const tags = tagInput.split(/[,，、\n]/).map((tag) => tag.trim()).filter(Boolean);
    if (tags.length) update("tags", [...new Set([...entry.tags, ...tags])]);
    setTagInput("");
  }

  function toggleMistake(mistake: string) {
    update("mistakes", entry.mistakes.includes(mistake) ? entry.mistakes.filter((item) => item !== mistake) : [...entry.mistakes, mistake]);
  }

  function addMistake() {
    const mistake = mistakeInput.trim();
    if (mistake && !entry.mistakes.includes(mistake)) update("mistakes", [...entry.mistakes, mistake]);
    setMistakeInput("");
  }

  function addRule() {
    const rule = availableRules.find((item) => item.id === selectedRule);
    if (!rule) return;
    update("ruleChecks", [...entry.ruleChecks, {
      ruleId: rule.id, ruleVersion: rule.version, title: rule.title,
      condition: rule.condition, action: rule.action, invalidation: rule.invalidation,
      result: "pending", note: "",
    }]);
    setSelectedRule("");
  }

  function updateRule(index: number, patch: Partial<ReviewEntry["ruleChecks"][number]>) {
    update("ruleChecks", entry.ruleChecks.map((check, position) => position === index ? { ...check, ...patch } : check));
  }

  function selectStrategy(strategyId: string) {
    if (!strategyId) { update("strategyId", ""); return; }
    const strategy = strategies.find((item) => item.id === strategyId && item.status === "active");
    if (!strategy) return;
    const attached = new Set(entry.ruleChecks.map((check) => check.ruleId));
    const checks = rules.filter((rule) => strategy.ruleIds.includes(rule.id) && rule.status !== "retired" && !attached.has(rule.id)).map((rule) => ({
      ruleId: rule.id, ruleVersion: rule.version, title: rule.title,
      condition: rule.condition, action: rule.action, invalidation: rule.invalidation,
      result: "pending" as const, note: "",
    }));
    onChange({ ...entry, strategyId: strategy.id, setup: strategy.name, ruleChecks: [...entry.ruleChecks, ...checks] });
  }

  return <form ref={formRef} className={styles.editor} noValidate onSubmit={(event) => { event.preventDefault(); save(true); }} onChangeCapture={(event) => {
    const { name } = event.target as EventTarget & { name?: string };
    if (name && nativeErrors[name]) setNativeErrors((current) => { const next = { ...current }; delete next[name]; return next; });
  }}>
    <fieldset className={styles.formBody} disabled={saving}>
    <header className={styles.header}>
      <div>
        <div className={styles.eyebrow}>{entry.status === "complete" ? "编辑已完成记录" : "填写交易复盘"}</div>
        <p>标有「必填」的内容用于完成复盘，其余内容可逐步补充。</p>
      </div>
      <button type="button" className={styles.backButton} onClick={onCancel} disabled={saving}>取消编辑</button>
    </header>

    <nav className={styles.steps} aria-label="复盘章节">
      {sections.map((section) => <a key={section.anchor} href={`#${id}-${section.anchor}`}>
        <span>{section.number}</span>{section.title}
      </a>)}
    </nav>

    {Object.keys(fieldErrors).length > 0 && <p className={styles.validationStatus} role="status">还有 {Object.keys(fieldErrors).length} 项需要检查，已在对应输入框标出；内容会保留。</p>}

    {errors.length > 0 && <div className={styles.errors} role="alert" tabIndex={-1}>
      <strong>暂时无法保存，填写内容已保留</strong>
      <ul>{errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul>
    </div>}

    <section className={styles.section} id={`${id}-record`} aria-labelledby={`${id}-record-title`}>
      <div className={styles.sectionHeading}><span>01</span><div><h3 id={`${id}-record-title`}>交易档案</h3><p>记录交易，也可以记录一次值得跟踪的观察。</p></div></div>
      <div className={styles.grid}>
        <EditorField {...field("title")} label="复盘标题" required wide><input value={entry.title} maxLength={160} onChange={(event) => update("title", event.target.value)} placeholder="例如：突破后回踩买入，是否按计划离场" autoComplete="off" /></EditorField>
        <EditorField {...field("date")} label="操作 / 观察日期" required><input type="date" value={entry.date} onChange={(event) => update("date", event.target.value)} /></EditorField>
        <EditorField {...field("kind")} label="记录类型" required><select value={entry.kind} onChange={(event) => update("kind", event.target.value as ReviewEntry["kind"])}><option value="trade">交易复盘 · 有实际成交</option><option value="observation">观察复盘 · 尚未交易</option></select></EditorField>
        <EditorField {...field("market")} label="交易市场" required><select value={entry.market} onChange={(event) => update("market", event.target.value as ReviewEntry["market"])}><option value="CN">沪深 A 股 · 人民币</option><option value="US">美股 · 美元</option></select></EditorField>
        <EditorField {...field("code")} label="股票代码" required={entry.kind === "trade"} hint={entry.market === "US" ? "例如 AAPL、NVDA" : "输入 6 位证券代码，例如 600519"}><input value={entry.code} onChange={(event) => update("code", event.target.value.toUpperCase())} placeholder={entry.market === "US" ? "AAPL" : "600519"} maxLength={20} autoComplete="off" spellCheck={false} /></EditorField>
        <EditorField {...field("name")} label="股票名称"><input value={entry.name} onChange={(event) => update("name", event.target.value)} placeholder="便于日后查找" maxLength={80} /></EditorField>
        <div className={styles.researchLink}>{entry.code.trim() ? <a href={`/?stock=${encodeURIComponent(stockRouteKey(entry))}&tab=overview`} target="_blank" rel="noreferrer">打开 {entry.name || entry.code} 股票研究 <span aria-hidden="true">↗</span><small>在新标签页查看行情、财务与研究记录</small></a> : <p>填写股票代码后，可从这里打开股票研究。</p>}</div>
        <EditorField {...field("operation")} label="本次操作" required><select value={entry.operation} onChange={(event) => update("operation", event.target.value as ReviewEntry["operation"])}><option value="buy">买入</option><option value="sell">卖出</option><option value="add">加仓</option><option value="reduce">减仓</option><option value="observe">观察</option></select></EditorField>
        <EditorField {...field("operationPrice")} label={`操作时价格（${currency}）`} required={entry.kind === "trade" || Boolean(entry.code.trim())} hint="用于比较操作后的最新涨跌；价格变化与实际交易盈亏分别统计。"><input type="number" min="0" step="any" inputMode="decimal" value={entry.operationPrice ?? ""} onChange={(event) => update("operationPrice", numberValue(event.target.value))} placeholder="记录当时成交价或观察价" /></EditorField>
        <EditorField {...field("marketContext")} label="市场背景" wide hint="把事实和判断分开：指数趋势、板块强弱、成交量、事件与风险。"><textarea rows={3} value={entry.marketContext} onChange={(event) => update("marketContext", event.target.value)} placeholder="当时市场处于什么状态？哪些信息支持或反对这次决策？" /></EditorField>
        <div className={`${styles.field} ${styles.wide}`}>
          <label className={styles.label} htmlFor={`${id}-tag`}>复盘标签<small>选填</small></label>
          <div className={styles.inputRow}><input id={`${id}-tag`} name="tagInput" data-field="tagInput" value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="例如 趋势交易、财报、突破（逗号分隔）" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} /><button type="button" onClick={addTag} disabled={!tagInput.trim()}>添加标签</button></div>
          {entry.tags.length > 0 && <div className={styles.chips}>{entry.tags.map((tag) => <button type="button" key={tag} className={styles.tag} onClick={() => update("tags", entry.tags.filter((item) => item !== tag))} aria-label={`移除标签 ${tag}`}>{tag}<span aria-hidden="true">×</span></button>)}</div>}
        </div>
      </div>
    </section>

    <section className={styles.section} id={`${id}-plan`} aria-labelledby={`${id}-plan-title`}>
      <div className={styles.sectionHeading}><span>02</span><div><h3 id={`${id}-plan-title`}>计划与执行</h3><p>保留最初计划，才能看清实际执行偏离了什么。</p></div></div>
      <div className={styles.grid}>
        <EditorField {...field("strategyId")} label="选择交易策略" wide hint="选择策略会加入尚未关联的可用规则。切换或清空策略时，已有检查与历史版本保留，可在下方手动移除。"><select value={entry.strategyId} onChange={(event) => selectStrategy(event.target.value)}><option value="">不关联策略 / 自定义交易形态</option>{entry.strategyId && !linkedStrategy && <option value={entry.strategyId} disabled>{entry.setup || "历史策略"} · 暂不可用</option>}{strategies.filter((strategy) => strategy.status === "active" || strategy.id === entry.strategyId).map((strategy) => <option key={strategy.id} value={strategy.id} disabled={strategy.status === "archived"}>{strategy.name}{strategy.status === "archived" ? " · 已停用（历史关联）" : ""}</option>)}</select></EditorField>
        {linkedStrategy?.description && <p className={`${styles.strategyDescription} ${styles.wide}`}>{linkedStrategy.description}</p>}
        <EditorField {...field("setup")} label="本次策略名称 / 交易形态" hint="保留本次记录的名称，可补充或自定义。策略库后续改名不会覆盖此处。"><input value={entry.setup} onChange={(event) => update("setup", event.target.value)} placeholder="例如：趋势回踩、突破确认、价值修复" maxLength={160} /></EditorField>
        <EditorField {...field("direction")} label="交易方向" required><select value={entry.direction} onChange={(event) => update("direction", event.target.value as ReviewEntry["direction"])}><option value="long">做多</option><option value="short">做空</option></select></EditorField>
        <EditorField {...field("thesis")} label="决策依据" required wide hint="完成复盘前填写。写出可观察的证据，以及判断失效的条件。"><textarea rows={3} value={entry.thesis} onChange={(event) => update("thesis", event.target.value)} placeholder="我为什么参与或观察？什么发生时说明判断错误？" /></EditorField>
      </div>
      <fieldset className={styles.pricePlan}><legend>事前计划 <small>选填 · 价格单位：{currency}</small></legend>
        <div className={styles.threeColumns}>
          <EditorField {...field("plannedEntry")} label="计划入场价"><input type="number" min="0" step="any" inputMode="decimal" value={entry.plannedEntry ?? ""} onChange={(event) => update("plannedEntry", numberValue(event.target.value))} placeholder="未设定" /></EditorField>
          <EditorField {...field("stopLoss")} label="初始止损价" hint="保留最初止损，作为 R 倍数的基准。"><input type="number" min="0" step="any" inputMode="decimal" value={entry.stopLoss ?? ""} onChange={(event) => update("stopLoss", numberValue(event.target.value))} placeholder="未设定" /></EditorField>
          <EditorField {...field("targetPrice")} label="计划目标价"><input type="number" min="0" step="any" inputMode="decimal" value={entry.targetPrice ?? ""} onChange={(event) => update("targetPrice", numberValue(event.target.value))} placeholder="未设定" /></EditorField>
        </div>
      </fieldset>
      {entry.kind === "trade" ? <fieldset className={styles.execution}><legend>实际执行 <small>尚未平仓时，平仓价与日期可留空</small></legend>
        <div className={styles.grid}>
          <EditorField {...field("entryPrice")} label={`实际入场均价（${currency}）`} required><input type="number" min="0" step="any" inputMode="decimal" value={entry.entryPrice ?? ""} onChange={(event) => update("entryPrice", numberValue(event.target.value))} placeholder="成交均价" /></EditorField>
          <EditorField {...field("quantity")} label="成交数量（股）" required hint="用于计算这次复盘的收益；一次记录对应同一批次交易。"><input type="number" min="0" step="any" inputMode="decimal" value={entry.quantity ?? ""} onChange={(event) => update("quantity", numberValue(event.target.value))} placeholder="股数，非手数" /></EditorField>
          <EditorField {...field("entryDate")} label="开仓日期" required><input type="date" value={entry.entryDate} onChange={(event) => update("entryDate", event.target.value)} /></EditorField>
          <EditorField {...field("exitPrice")} label={`实际平仓均价（${currency}）`}><input type="number" min="0" step="any" inputMode="decimal" value={entry.exitPrice ?? ""} onChange={(event) => update("exitPrice", numberValue(event.target.value))} placeholder="未平仓则留空" /></EditorField>
          <EditorField {...field("exitDate")} label="平仓日期"><input type="date" value={entry.exitDate} onChange={(event) => update("exitDate", event.target.value)} /></EditorField>
          <EditorField {...field("fees")} label={`交易总费用（${currency}）`} hint="填写此次交易全部佣金与税费。无费用请填 0；留空时不计算净盈亏。"><input type="number" min="0" step="any" inputMode="decimal" value={entry.fees ?? ""} onChange={(event) => update("fees", numberValue(event.target.value))} placeholder="未确认费用" /></EditorField>
        </div>
      </fieldset> : <div className={styles.observationNote}>观察记录无需填写成交信息。保留触发条件，之后可以将记录类型改为交易复盘，继续跟踪实际执行。</div>}
      <dl className={styles.metrics} aria-label="交易计算结果">
        <div><dt>净盈亏 {entry.kind === "trade" ? `· ${currency}` : ""}</dt><dd data-tone={metrics.netPnl == null ? "neutral" : metrics.netPnl > 0 ? "positive" : metrics.netPnl < 0 ? "negative" : "neutral"}>{entry.kind === "trade" ? metricText(metrics.netPnl, "", true) : "—"}</dd></div>
        <div><dt>净收益率</dt><dd>{entry.kind === "trade" ? metricText(metrics.returnPct, "%", true) : "—"}</dd></div>
        <div><dt>实际 R 倍数</dt><dd>{entry.kind === "trade" ? metricText(metrics.rMultiple, "R", true) : "—"}</dd></div>
        <div><dt>计划盈亏比</dt><dd>{metricText(metrics.plannedRR, " : 1")}</dd></div>
      </dl>
      <p className={styles.metricNote}>净盈亏扣除费用；R 倍数衡量收益相对初始风险的大小。缺少成交、已确认费用或有效止损时，相关指标显示「—」。未平仓交易不计已实现盈亏；操作后价格涨跌单独在列表展示。</p>
    </section>

    <section className={styles.section} id={`${id}-behavior`} aria-labelledby={`${id}-behavior-title`}>
      <div className={styles.sectionHeading}><span>03</span><div><h3 id={`${id}-behavior-title`}>行为与规则</h3><p>把结果与过程分开：盈利也可能违反规则，亏损也可能是合格执行。</p></div></div>
      <div className={styles.grid}>
        <EditorField {...field("emotion")} label="主要交易情绪"><select value={entry.emotion} onChange={(event) => update("emotion", event.target.value)}><option value="">选择当时最明显的情绪</option>{!emotions.includes(entry.emotion) && entry.emotion && <option value={entry.emotion}>{entry.emotion}</option>}{emotions.map((emotion) => <option key={emotion} value={emotion}>{emotion}</option>)}</select></EditorField>
        <EditorField {...field("wentWell")} label="做得好的地方"><textarea rows={2} value={entry.wentWell} onChange={(event) => update("wentWell", event.target.value)} placeholder="哪些行为值得下次继续执行？" /></EditorField>
      </div>
      <fieldset className={styles.mistakes}><legend>失误标签 <small>选填 · 可多选，无失误可留空</small></legend>
        <div className={styles.chips}>{[...new Set([...commonMistakes, ...entry.mistakes])].map((mistake) => <button type="button" key={mistake} className={styles.choice} aria-pressed={entry.mistakes.includes(mistake)} onClick={() => toggleMistake(mistake)}>{entry.mistakes.includes(mistake) && <span aria-hidden="true">✓ </span>}{mistake}</button>)}</div>
        <div className={styles.inputRow}><label className={styles.srOnly} htmlFor={`${id}-mistake`}>自定义失误标签</label><input id={`${id}-mistake`} name="mistakeInput" data-field="mistakeInput" value={mistakeInput} onChange={(event) => setMistakeInput(event.target.value)} placeholder="记录其他失误" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addMistake(); } }} /><button type="button" onClick={addMistake} disabled={!mistakeInput.trim()}>添加失误</button></div>
      </fieldset>
      <div className={styles.ruleHeading}><div><h4>执行规则检查</h4><p>加入本次适用的规则，逐条检验执行情况。完成复盘前须检查所有已加入规则；违反规则须填写原因。历史记录保留当时版本。</p></div><div className={styles.ruleTools}><span>{reviewedRules} / {entry.ruleChecks.length} 已检查</span><button type="button" onClick={() => save(entry.status === "complete", onCreateRule)} disabled={saving}>＋ 自定义交易规则</button></div></div>
      <p className={styles.createRuleHint}>需要新规则时可直接自定义。当前编辑会先保存为草稿；规则保存后自动加入本次检查，并回到复盘。</p>
      <div className={styles.inputRow}><label className={styles.srOnly} htmlFor={`${id}-rule`}>选择本次检查的规则</label><select id={`${id}-rule`} name="selectedRule" data-field="selectedRule" value={selectedRule} onChange={(event) => setSelectedRule(event.target.value)}><option value="">{availableRules.length ? "选择试行中或执行中的规则" : "暂无可加入的规则"}</option>{availableRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.title} · v{rule.version}{rule.status === "testing" ? " · 试行" : ""}</option>)}</select><button type="button" onClick={addRule} disabled={!availableRules.some((rule) => rule.id === selectedRule)}>加入检查</button></div>
      {entry.ruleChecks.length === 0 && <p className={styles.emptyRules}>还没有规则检查。可以先完成复盘，再从结论提炼第一条规则；已有规则可在上方加入。</p>}
      <div className={styles.ruleList}>{entry.ruleChecks.map((check, index) => <article className={styles.ruleCard} key={`${check.ruleId}-${index}`}>
        <header><div><strong>{check.title}</strong><span>v{check.ruleVersion} · 本次快照</span></div><button type="button" className={styles.removeButton} onClick={() => update("ruleChecks", entry.ruleChecks.filter((_, position) => position !== index))} aria-label={`移除规则检查 ${check.title}`}>移除</button></header>
        <dl className={styles.ruleSnapshot}><div><dt>触发条件</dt><dd>{check.condition || "未设定"}</dd></div><div><dt>执行动作</dt><dd>{check.action || "未设定"}</dd></div><div><dt>失效条件</dt><dd>{check.invalidation || "未设定"}</dd></div></dl>
        <div className={styles.ruleInputs}><EditorField {...field(`ruleChecks.${check.ruleId}.result`)} label="执行结果" required><select value={check.result} onChange={(event) => updateRule(index, { result: event.target.value as ReviewEntry["ruleChecks"][number]["result"] })}><option value="pending">待检查</option><option value="followed">遵守规则</option><option value="broken">违反规则</option><option value="na">本次不适用</option></select></EditorField><EditorField {...field(`ruleChecks.${check.ruleId}.note`)} label="事实与原因" required={check.result === "broken"}><textarea rows={2} value={check.note} onChange={(event) => updateRule(index, { note: event.target.value })} placeholder="用具体行为说明：何时执行、如何偏离、为什么不适用？" /></EditorField></div>
      </article>)}</div>
    </section>

    <section className={styles.section} id={`${id}-reflection`} aria-labelledby={`${id}-reflection-title`}>
      <div className={styles.sectionHeading}><span>04</span><div><h3 id={`${id}-reflection-title`}>总结与行动</h3><p>把模糊的感受，写成下一次可以执行、检查和修订的动作。</p></div></div>
      <div className={styles.grid}>
        <EditorField {...field("lesson")} label="核心经验" required hint="完成复盘前填写。避免只写「耐心」「自律」，描述具体的条件和行为。"><textarea rows={4} value={entry.lesson} onChange={(event) => update("lesson", event.target.value)} placeholder="这次最值得保留的一条经验是什么？哪些证据支持它？" /></EditorField>
        <EditorField {...field("nextAction")} label="下一次行动" required hint="完成复盘前填写。使用「当……时，我会……；如果……则停止」的句式。"><textarea rows={4} value={entry.nextAction} onChange={(event) => update("nextAction", event.target.value)} placeholder="例如：下一次突破后等待回踩确认；跌破事前止损价则退出，不临时扩大风险。" /></EditorField>
        <EditorField {...field("reviewDate")} label="下次复核日期" hint="在复盘列表跟踪到期记录，检查经验是否仍然有效。"><input type="date" value={entry.reviewDate} onChange={(event) => update("reviewDate", event.target.value)} /></EditorField>
        <div className={styles.deriveBox}><div><strong>让经验成为可验证的规则</strong><p>从本次总结创建一条试行规则，继续用后续复盘积累执行证据。</p></div><button type="button" onClick={() => save(entry.status === "complete", onDeriveRule)} disabled={saving || !entry.lesson.trim() || !entry.nextAction.trim()}>提炼交易规则 <span aria-hidden="true">↗</span></button></div>
      </div>
    </section>

    <footer className={styles.footer}><div><strong>{entry.status === "complete" ? "更新这次复盘" : "不必一次写完"}</strong><span>保存草稿可稍后继续；完成复盘需要补齐必填内容。</span></div><div className={styles.footerActions}><button type="button" onClick={() => save(false)} disabled={saving}>{saving ? "保存中…" : "保存草稿"}</button><button type="submit" className={styles.primary} disabled={saving}>{saving ? "保存中…" : entry.status === "complete" ? "保存已完成复盘" : "完成复盘"}</button></div></footer>
    </fieldset>
  </form>;
}
