import { validateReviewEntry, type ReviewEntry } from "../../lib/tradingJournal";

export type ReviewFieldErrors = Record<string, string>;

/** Keep domain validation authoritative while locating each message at its input. */
export function reviewValidation(entry: ReviewEntry, completing: boolean): { errors: string[]; fields: ReviewFieldErrors } {
  const errors = validateReviewEntry(entry, completing);
  const fields: ReviewFieldErrors = {};
  const mark = (field: string, message: string) => { if (errors.includes(message) && !fields[field]) fields[field] = message; };
  mark("date", "请填写有效的复盘日期");
  for (const [field, label] of Object.entries({ operationPrice: "操作时价格", plannedEntry: "计划入场价", stopLoss: "止损价", targetPrice: "目标价", entryPrice: "实际入场价", exitPrice: "实际出场价", quantity: "数量", fees: "总费用" })) {
    mark(field, `${label}须为${field === "fees" ? "不小于 0" : "大于 0"}的有效数字`);
  }
  for (const [field, label] of [["entryDate", "入场日期"], ["exitDate", "出场日期"], ["reviewDate", "再次复查日期"]]) mark(field, `${label}无效`);
  mark("exitDate", "出场日期不能早于入场日期");
  mark("reviewDate", "再次复查日期不能早于复盘日期");
  mark("code", "A 股代码须为 6 位数字且不含空格");
  mark("code", "美股代码须为最多 10 位的大写代码且不含空格");
  mark("title", "标题不能超过 300 字");
  for (const field of ["marketContext", "setup", "thesis", "wentWell", "lesson", "nextAction"] as const) {
    if (entry[field].length > 20000) mark(field, "单个文本字段不能超过 20000 字");
  }
  if (completing) {
    for (const [field, label] of [["date", "操作 / 观察日期"], ["entryDate", "入场日期"], ["exitDate", "出场日期"]]) mark(field, `${label}不能晚于北京时间今日；未来计划请保存草稿`);
    for (const [field, message] of Object.entries({ title: "完成前请填写复盘标题", thesis: "完成前请记录交易或观察逻辑", lesson: "完成前请写下复盘结论", nextAction: "完成前请明确下一次的行动", operationPrice: "完成前请记录操作时价格", code: "交易复盘需要股票代码", entryPrice: "交易复盘需要实际入场价", quantity: "交易复盘需要数量", entryDate: "交易复盘需要入场日期" })) mark(field, message);
    if (entry.exitPrice === null) mark("exitPrice", "平仓时请同时填写出场价和出场日期");
    if (!entry.exitDate) mark("exitDate", "平仓时请同时填写出场价和出场日期");
    for (const check of entry.ruleChecks) {
      if (check.result === "pending") fields[`ruleChecks.${check.ruleId}.result`] = "请选择这条规则的执行结果";
      if (check.result === "broken" && !check.note.trim()) fields[`ruleChecks.${check.ruleId}.note`] = "请填写未遵守这条规则的事实与原因";
    }
  }
  return { errors, fields };
}

/** DOM order is the reading order, even when optional sections change. */
export function focusReviewError(form: HTMLFormElement | null, fields: ReviewFieldErrors): void {
  const control = Array.from(form?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-field]") ?? [])
    .find((element) => fields[element.dataset.field ?? ""]);
  if (!control) return;
  control.focus({ preventScroll: true });
  const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  control.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
}
