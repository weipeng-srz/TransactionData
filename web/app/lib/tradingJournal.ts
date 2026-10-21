/** Versioned, local-first journal. Invalid backups fail as a whole; history is never truncated. */
import { cnStockCodePattern, usStockSymbolPattern } from "./security.ts";

export const JOURNAL_STORAGE_KEY = "trendsight.trading-journal.v1";
const MAX_ENTRIES = 10_000;
const MAX_RULES = 1_000;
const MAX_STRATEGIES = 1_000;
const MAX_BACKUP_LENGTH = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20_000;
const MAX_NUMBER = 1_000_000_000_000;
const chinaDateFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });

function todayInChina(): string {
  return chinaDateFormatter.format(new Date());
}

export type JournalMarket = "CN" | "US";
export type ReviewOperation = "buy" | "sell" | "add" | "reduce" | "observe";
export type RuleCheck = {
  ruleId: string;
  ruleVersion: number;
  title: string;
  condition: string;
  action: string;
  invalidation: string;
  result: "pending" | "followed" | "broken" | "na";
  note: string;
};

export type ReviewEntry = {
  id: string;
  date: string;
  title: string;
  status: "draft" | "complete";
  market: JournalMarket;
  code: string;
  name: string;
  kind: "trade" | "observation";
  operation: ReviewOperation;
  operationPrice: number | null;
  marketContext: string;
  setup: string;
  strategyId: string;
  thesis: string;
  plannedEntry: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  quantity: number | null;
  fees: number | null;
  entryDate: string;
  exitDate: string;
  direction: "long" | "short";
  emotion: string;
  tags: string[];
  mistakes: string[];
  wentWell: string;
  lesson: string;
  nextAction: string;
  reviewDate: string;
  ruleChecks: RuleCheck[];
  createdAt: string;
  updatedAt: string;
};

export type TradingRule = {
  id: string;
  title: string;
  condition: string;
  action: string;
  invalidation: string;
  category: "entry" | "exit" | "risk" | "discipline";
  status: "testing" | "active" | "retired";
  version: number;
  sourceEntryId: string;
  createdAt: string;
  updatedAt: string;
};

export type TradingStrategy = {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  ruleIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type JournalState = { version: 1; entries: ReviewEntry[]; rules: TradingRule[]; strategies: TradingStrategy[] };
export type JournalStorage = Pick<Storage, "getItem" | "setItem">;
export type TradeMetrics = {
  netPnl: number | null;
  returnPct: number | null;
  rMultiple: number | null;
  plannedRR: number | null;
};
export type JournalStats = {
  total: number;
  drafts: number;
  completed: number;
  closedTrades: number;
  wins: number;
  winRate: number | null;
  netPnl: number | null;
  executionRate: number | null;
  followedChecks: number;
  brokenChecks: number;
};

function newId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}`;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function emptyJournal(): JournalState {
  return { version: 1, entries: [], rules: [], strategies: [] };
}

export function createReviewEntry(
  date = today(),
  stock?: { code: string; name: string; market?: JournalMarket },
): ReviewEntry {
  const now = new Date().toISOString();
  return {
    id: newId("review"), date, title: "", status: "draft", market: stock?.market ?? "CN",
    code: stock?.code ?? "", name: stock?.name ?? "", kind: "trade", operation: "observe", operationPrice: null,
    marketContext: "", setup: "", strategyId: "", thesis: "",
    plannedEntry: null, stopLoss: null, targetPrice: null, entryPrice: null, exitPrice: null,
    quantity: null, fees: null, entryDate: "", exitDate: "", direction: "long", emotion: "",
    tags: [], mistakes: [], wentWell: "", lesson: "", nextAction: "", reviewDate: "", ruleChecks: [],
    createdAt: now, updatedAt: now,
  };
}

export function createTradingRule(entry?: ReviewEntry): TradingRule {
  const now = new Date().toISOString();
  return {
    id: newId("rule"), title: "", condition: entry?.setup ?? "", action: entry?.nextAction ?? "",
    invalidation: "", category: "discipline", status: "testing", version: 1,
    sourceEntryId: entry?.id ?? "", createdAt: now, updatedAt: now,
  };
}

export function createTradingStrategy(): TradingStrategy {
  const now = new Date().toISOString();
  return { id: newId("strategy"), name: "", description: "", status: "active", ruleIds: [], createdAt: now, updatedAt: now };
}

/** Capture all wording now: subsequent rule edits must not rewrite past checks. */
export function snapshotTradingRule(rule: TradingRule): RuleCheck {
  return {
    ruleId: rule.id, ruleVersion: rule.version, title: rule.title, condition: rule.condition,
    action: rule.action, invalidation: rule.invalidation, result: "pending", note: "",
  };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function positive(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_NUMBER;
}

const numericFields = {
  operationPrice: "操作时价格",
  plannedEntry: "计划入场价", stopLoss: "止损价", targetPrice: "目标价", entryPrice: "实际入场价",
  exitPrice: "实际出场价", quantity: "数量", fees: "总费用",
} as const;

export function validateReviewEntry(entry: ReviewEntry, completing = entry.status === "complete"): string[] {
  const errors: string[] = [];
  if (!validDate(entry.date)) errors.push("请填写有效的复盘日期");
  for (const [key, label] of Object.entries(numericFields)) {
    const value = entry[key as keyof typeof numericFields];
    if (value !== null && (key === "fees"
      ? !Number.isFinite(value) || value < 0 || value > MAX_NUMBER
      : !positive(value))) errors.push(`${label}须为${key === "fees" ? "不小于 0" : "大于 0"}的有效数字`);
  }
  for (const [key, label] of [["entryDate", "入场日期"], ["exitDate", "出场日期"], ["reviewDate", "再次复查日期"]] as const) {
    if (entry[key] && !validDate(entry[key])) errors.push(`${label}无效`);
  }
  if (entry.entryDate && entry.exitDate && entry.exitDate < entry.entryDate) errors.push("出场日期不能早于入场日期");
  if (entry.reviewDate && entry.reviewDate < entry.date) errors.push("再次复查日期不能早于复盘日期");
  if (entry.code && !(entry.market === "CN" ? cnStockCodePattern : usStockSymbolPattern).test(entry.code)) {
    errors.push(entry.market === "CN" ? "A 股代码须为 6 位数字且不含空格" : "美股代码须为最多 10 位的大写代码且不含空格");
  }
  if (entry.title.length > 300) errors.push("标题不能超过 300 字");
  for (const key of ["marketContext", "setup", "thesis", "wentWell", "lesson", "nextAction"] as const) {
    if (entry[key].length > MAX_TEXT_LENGTH) errors.push("单个文本字段不能超过 20000 字");
  }
  if (completing) {
    const currentDate = todayInChina();
    for (const [key, label] of [["date", "操作 / 观察日期"], ["entryDate", "入场日期"], ["exitDate", "出场日期"]] as const) {
      if (entry[key] && entry[key] > currentDate) errors.push(`${label}不能晚于北京时间今日；未来计划请保存草稿`);
    }
    if (!entry.title.trim()) errors.push("完成前请填写复盘标题");
    if (!entry.thesis.trim()) errors.push("完成前请记录交易或观察逻辑");
    if (!entry.lesson.trim()) errors.push("完成前请写下复盘结论");
    if (!entry.nextAction.trim()) errors.push("完成前请明确下一次的行动");
    if ((entry.code.trim() || entry.kind === "trade") && !positive(entry.operationPrice)) errors.push("完成前请记录操作时价格");
    if (entry.kind === "trade") {
      if (!entry.code.trim()) errors.push("交易复盘需要股票代码");
      if (!positive(entry.entryPrice)) errors.push("交易复盘需要实际入场价");
      if (!positive(entry.quantity)) errors.push("交易复盘需要数量");
      if (!entry.entryDate) errors.push("交易复盘需要入场日期");
      if ((entry.exitPrice !== null) !== Boolean(entry.exitDate)) errors.push("平仓时请同时填写出场价和出场日期");
    }
    if (entry.ruleChecks.some((check) => check.result === "pending")) errors.push("请逐条评价关联规则的执行情况");
    if (entry.ruleChecks.some((check) => check.result === "broken" && !check.note.trim())) errors.push("请为未遵守的规则补充原因");
  }
  return [...new Set(errors)];
}

export function validateTradingRule(rule: TradingRule): string[] {
  const errors: string[] = [];
  for (const [key, label] of [["title", "规则名称"], ["condition", "触发条件"], ["action", "执行动作"], ["invalidation", "失效条件"]] as const) {
    if (!rule[key].trim()) errors.push(`请填写${label}`);
    if (rule[key].length > (key === "title" ? 300 : MAX_TEXT_LENGTH)) errors.push(`${label}过长`);
  }
  if (!Number.isSafeInteger(rule.version) || rule.version < 1) errors.push("规则版本无效");
  return errors;
}

export function validateTradingStrategy(strategy: TradingStrategy): string[] {
  const errors: string[] = [];
  if (!strategy.name.trim()) errors.push("请填写策略名称");
  if (strategy.name.length > 300) errors.push("策略名称不能超过 300 字");
  if (strategy.description.length > MAX_TEXT_LENGTH) errors.push("策略说明不能超过 20000 字");
  if (strategy.status !== "active" && strategy.status !== "archived") errors.push("策略状态无效");
  if (strategy.ruleIds.length > MAX_RULES) errors.push("关联规则数量超过上限");
  if (strategy.ruleIds.some((id) => !id.trim() || id.length > 200)) errors.push("策略关联规则 ID 无效");
  if (new Set(strategy.ruleIds).size !== strategy.ruleIds.length) errors.push("策略不能重复关联相同规则");
  return errors;
}

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}格式无效`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key))) throw new Error(`${label}包含不支持的字段，请使用兼容版本导入`);
  if (keys.some((key) => !Object.prototype.hasOwnProperty.call(result, key))) throw new Error(`${label}缺少必要字段`);
  return result;
}

function string(value: unknown, label: string, max = MAX_TEXT_LENGTH, required = false): asserts value is string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error(`${label}为空、过长或格式无效`);
}

function oneOf(value: unknown, options: readonly string[], label: string): void {
  if (typeof value !== "string" || !options.includes(value)) throw new Error(`${label}无效`);
}

function timestamp(value: unknown, label: string): void {
  string(value, label, 40, true);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || !validDate(value.slice(0, 10))) {
    throw new Error(`${label}无效`);
  }
}

function list(value: unknown, label: string, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}格式无效或超过 ${max} 条上限，未删减任何记录`);
}

function uniqueIds(items: { id: string }[], label: string): void {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error(`${label}包含重复 ID，导入已取消`);
}

const checkKeys = ["ruleId", "ruleVersion", "title", "condition", "action", "invalidation", "result", "note"];
const ruleKeys = ["id", "title", "condition", "action", "invalidation", "category", "status", "version", "sourceEntryId", "createdAt", "updatedAt"];
const strategyKeys = ["id", "name", "description", "status", "ruleIds", "createdAt", "updatedAt"];
const entryKeys = [
  "id", "date", "title", "status", "market", "code", "name", "kind", "operation", "operationPrice", "marketContext", "setup", "strategyId", "thesis",
  "plannedEntry", "stopLoss", "targetPrice", "entryPrice", "exitPrice", "quantity", "fees", "entryDate", "exitDate",
  "direction", "emotion", "tags", "mistakes", "wentWell", "lesson", "nextAction", "reviewDate", "ruleChecks", "createdAt", "updatedAt",
];

function parseCheck(value: unknown): RuleCheck {
  const check = object(value, checkKeys, "规则执行快照");
  string(check.ruleId, "规则 ID", 200, true);
  string(check.title, "规则名称", 300, true);
  for (const key of ["condition", "action", "invalidation"]) string(check[key], "规则快照", MAX_TEXT_LENGTH, true);
  string(check.note, "规则执行备注");
  if (!Number.isSafeInteger(check.ruleVersion) || Number(check.ruleVersion) < 1) throw new Error("规则快照版本无效");
  oneOf(check.result, ["pending", "followed", "broken", "na"], "规则执行结果");
  return { ...check } as RuleCheck;
}

function parseEntry(value: unknown, validate = true): ReviewEntry {
  // Version 1 predates strategy assignment. Add only that missing field, never normalize existing values.
  const compatible = value && typeof value === "object" && !Array.isArray(value) && !Object.prototype.hasOwnProperty.call(value, "strategyId")
    ? { ...value, strategyId: "" } : value;
  const entry = object(compatible, entryKeys, "复盘记录");
  string(entry.id, "复盘 ID", 200, true);
  string(entry.strategyId, "策略 ID", 200);
  for (const key of ["date", "entryDate", "exitDate", "reviewDate"]) string(entry[key], "日期", 10);
  string(entry.title, "复盘标题", 300);
  string(entry.code, "股票代码", 30);
  string(entry.name, "股票名称", 200);
  string(entry.emotion, "情绪", 200);
  for (const key of ["marketContext", "setup", "thesis", "wentWell", "lesson", "nextAction"]) string(entry[key], "复盘文本");
  oneOf(entry.status, ["draft", "complete"], "复盘状态");
  oneOf(entry.market, ["CN", "US"], "市场");
  oneOf(entry.kind, ["trade", "observation"], "复盘类型");
  oneOf(entry.operation, ["buy", "sell", "add", "reduce", "observe"], "操作类型");
  oneOf(entry.direction, ["long", "short"], "交易方向");
  for (const key of Object.keys(numericFields)) {
    if (entry[key] !== null && (typeof entry[key] !== "number" || !Number.isFinite(entry[key]))) throw new Error("价格、数量和费用必须为有限数字或空值");
  }
  for (const key of ["tags", "mistakes"]) {
    list(entry[key], "标签", 50);
    for (const item of entry[key]) string(item, "标签", 100, true);
  }
  list(entry.ruleChecks, "关联规则", MAX_RULES);
  const ruleChecks = entry.ruleChecks.map(parseCheck);
  if (new Set(ruleChecks.map((check) => check.ruleId)).size !== ruleChecks.length) throw new Error("同一复盘不能重复关联相同规则");
  timestamp(entry.createdAt, "创建时间");
  timestamp(entry.updatedAt, "更新时间");
  const result = { ...entry, tags: [...entry.tags as string[]], mistakes: [...entry.mistakes as string[]], ruleChecks } as ReviewEntry;
  const errors = validate ? validateReviewEntry(result) : [];
  if (errors.length) throw new Error(`复盘「${result.title || result.id}」：${errors.join("；")}`);
  return result;
}

/** Restore an editor's intermediate state without applying completed-record business rules. */
export function parseEditingReviewEntry(value: unknown): ReviewEntry {
  return parseEntry(value, false);
}

function parseRule(value: unknown): TradingRule {
  const rule = object(value, ruleKeys, "交易规则");
  string(rule.id, "规则 ID", 200, true);
  string(rule.sourceEntryId, "来源复盘 ID", 200);
  string(rule.title, "规则名称", 300);
  for (const key of ["condition", "action", "invalidation"]) string(rule[key], "规则文本");
  oneOf(rule.category, ["entry", "exit", "risk", "discipline"], "规则分类");
  oneOf(rule.status, ["testing", "active", "retired"], "规则状态");
  timestamp(rule.createdAt, "规则创建时间");
  timestamp(rule.updatedAt, "规则更新时间");
  const result = { ...rule } as TradingRule;
  const errors = validateTradingRule(result);
  if (errors.length) throw new Error(`规则「${result.title || result.id}」：${errors.join("；")}`);
  return result;
}

function parseStrategy(value: unknown): TradingStrategy {
  const strategy = object(value, strategyKeys, "交易策略");
  string(strategy.id, "策略 ID", 200, true);
  string(strategy.name, "策略名称", 300, true);
  string(strategy.description, "策略说明");
  oneOf(strategy.status, ["active", "archived"], "策略状态");
  list(strategy.ruleIds, "策略关联规则", MAX_RULES);
  strategy.ruleIds.forEach((id) => string(id, "关联规则 ID", 200, true));
  timestamp(strategy.createdAt, "策略创建时间");
  timestamp(strategy.updatedAt, "策略更新时间");
  const result = { ...strategy, ruleIds: [...strategy.ruleIds] } as TradingStrategy;
  const errors = validateTradingStrategy(result);
  if (errors.length) throw new Error(`策略「${result.name}」：${errors.join("；")}`);
  return result;
}

/** Accept a parsed JSON value or a JSON string. Never silently recover by deleting history. */
export function parseJournal(value: unknown): JournalState {
  let input = value;
  if (typeof input === "string") {
    if (input.length > MAX_BACKUP_LENGTH) throw new Error("复盘备份超过 20 MB 上限，未导入任何记录");
    try { input = JSON.parse(input); } catch { throw new Error("复盘数据不是有效的 JSON，原始数据已保留"); }
  }
  const compatible = input && typeof input === "object" && !Array.isArray(input) ? { strategies: [], ...input } : input;
  const state = object(compatible, ["version", "entries", "rules", "strategies"], "复盘数据");
  if (state.version !== 1) throw new Error("不支持的复盘数据版本，请使用兼容版本打开");
  list(state.entries, "复盘记录", MAX_ENTRIES);
  list(state.rules, "交易规则", MAX_RULES);
  list(state.strategies, "交易策略", MAX_STRATEGIES);
  const entries = state.entries.map((value) => parseEntry(value));
  const rules = state.rules.map(parseRule);
  const strategies = state.strategies.map(parseStrategy);
  uniqueIds(entries, "复盘记录");
  uniqueIds(rules, "交易规则");
  uniqueIds(strategies, "交易策略");
  const result: JournalState = { version: 1, entries, rules, strategies };
  if (JSON.stringify(result).length > MAX_BACKUP_LENGTH) throw new Error("复盘数据超过 20 MB 上限，未删减任何记录");
  return result;
}

export function readJournal(storage: Pick<JournalStorage, "getItem">): JournalState {
  const value = storage.getItem(JOURNAL_STORAGE_KEY);
  return value === null ? emptyJournal() : parseJournal(value);
}

export function saveJournal(storage: Pick<JournalStorage, "setItem">, state: JournalState): void {
  const serialized = JSON.stringify(parseJournal(state));
  // Surface quota/private-mode failures to the UI, without clearing existing storage.
  storage.setItem(JOURNAL_STORAGE_KEY, serialized);
}

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Underlying stock movement since the recorded operation, regardless of trade direction. */
export function priceChange(operationPrice: number | null, latestPrice: number | null): { amount: number; percent: number } | null {
  if (!positive(operationPrice) || !positive(latestPrice)) return null;
  const amount = latestPrice - operationPrice;
  const percent = amount / operationPrice * 100;
  return Number.isFinite(percent) ? { amount, percent } : null;
}

export function tradeMetrics(entry: ReviewEntry): TradeMetrics {
  const result: TradeMetrics = { netPnl: null, returnPct: null, rMultiple: null, plannedRR: null };
  if (entry.kind !== "trade") return result;
  const sign = entry.direction === "long" ? 1 : -1;
  if (positive(entry.plannedEntry) && positive(entry.stopLoss) && positive(entry.targetPrice)) {
    const risk = (entry.plannedEntry - entry.stopLoss) * sign;
    const reward = (entry.targetPrice - entry.plannedEntry) * sign;
    if (risk > 0 && reward > 0) result.plannedRR = finite(reward / risk);
  }
  // Missing fees are unknown, not zero. Open positions and observations are not realized P/L.
  if (!positive(entry.entryPrice) || !positive(entry.exitPrice) || !positive(entry.quantity)
    || entry.fees === null || !Number.isFinite(entry.fees) || entry.fees < 0
    || !validDate(entry.entryDate) || !validDate(entry.exitDate) || entry.exitDate < entry.entryDate
    || entry.exitDate > todayInChina()) return result;
  result.netPnl = finite((entry.exitPrice - entry.entryPrice) * sign * entry.quantity - entry.fees);
  if (result.netPnl === null) return result;
  result.returnPct = finite(result.netPnl / (entry.entryPrice * entry.quantity) * 100);
  if (positive(entry.stopLoss)) {
    const risk = (entry.entryPrice - entry.stopLoss) * sign;
    if (risk > 0) result.rMultiple = finite(result.netPnl / (risk * entry.quantity));
  }
  return result;
}

export function journalStats(entries: ReviewEntry[], market?: JournalMarket): JournalStats {
  const selected = market ? entries.filter((entry) => entry.market === market) : entries;
  const completed = selected.filter((entry) => entry.status === "complete");
  const closed = completed.map((entry) => ({ entry, metrics: tradeMetrics(entry) })).filter(({ metrics }) => metrics.netPnl !== null);
  const wins = closed.filter(({ metrics }) => metrics.netPnl! > 0).length;
  const checks = completed.flatMap((entry) => entry.ruleChecks);
  const followedChecks = checks.filter((check) => check.result === "followed").length;
  const brokenChecks = checks.filter((check) => check.result === "broken").length;
  const sameCurrency = new Set(closed.map(({ entry }) => entry.market)).size <= 1;
  return {
    total: selected.length, drafts: selected.length - completed.length, completed: completed.length,
    closedTrades: closed.length, wins, winRate: closed.length ? wins / closed.length * 100 : null,
    netPnl: closed.length && sameCurrency ? finite(closed.reduce((sum, { metrics }) => sum + metrics.netPnl!, 0)) : null,
    executionRate: followedChecks + brokenChecks ? followedChecks / (followedChecks + brokenChecks) * 100 : null,
    followedChecks, brokenChecks,
  };
}

export function ruleStats(ruleId: string, entries: ReviewEntry[]): { followed: number; broken: number; sampleCount: number; executionRate: number | null } {
  const checks = entries.filter((entry) => entry.status === "complete").flatMap((entry) => entry.ruleChecks).filter((check) => check.ruleId === ruleId);
  const followed = checks.filter((check) => check.result === "followed").length;
  const broken = checks.filter((check) => check.result === "broken").length;
  const sampleCount = followed + broken;
  return { followed, broken, sampleCount, executionRate: sampleCount ? followed / sampleCount * 100 : null };
}

/** Additive import: conflicts are reported and local copies retained, never overwritten. */
export function mergeJournal(current: JournalState, incoming: JournalState): {
  state: JournalState; addedEntries: number; addedRules: number; addedStrategies: number; conflicts: string[];
} {
  const local = parseJournal(current);
  const imported = parseJournal(incoming);
  const conflicts: string[] = [];
  function merge<T extends { id: string; title?: string; name?: string }>(existing: T[], added: T[], label: string): T[] {
    const index = new Map(existing.map((item) => [item.id, item]));
    const result = [...existing];
    for (const item of added) {
      const match = index.get(item.id);
      if (!match) result.push(item);
      else if (JSON.stringify(match) !== JSON.stringify(item)) conflicts.push(`${label}「${item.title || item.name || item.id}」与当前账户版本不同，已保留当前账户版本`);
    }
    return result;
  }
  const entries = merge(local.entries, imported.entries, "复盘");
  const rules = merge(local.rules, imported.rules, "规则");
  const strategies = merge(local.strategies, imported.strategies, "策略");
  const state = parseJournal({ version: 1, entries, rules, strategies });
  return {
    state, addedEntries: entries.length - local.entries.length, addedRules: rules.length - local.rules.length,
    addedStrategies: strategies.length - local.strategies.length, conflicts,
  };
}
