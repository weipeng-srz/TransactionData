export type FinancialViewMode = "single" | "cumulative" | "ttm";

export type FinancialMetrics = {
  revenue: number | null;
  operatingCost: number | null;
  grossProfit: number | null;
  operatingProfit: number | null;
  parentNetProfit: number | null;
  deductNetProfit: number | null;
  nonRecurringProfit: number | null;
  operatingCashFlow: number | null;
  investingCashFlow: number | null;
  financingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  researchExpense: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  deductMargin: number | null;
  cashCoverage: number | null;
  researchExpenseRatio: number | null;
  roe: number | null;
  roic: number | null;
};

export type FinancialBalanceMetrics = {
  accountsReceivable: number | null;
  inventory: number | null;
  contractLiabilities: number | null;
  goodwill: number | null;
  fixedAssets: number | null;
  constructionInProgress: number | null;
  cash: number | null;
  interestBearingDebt: number | null;
  netDebt: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  parentEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  debtAssetRatio: number | null;
  receivableDays: number | null;
  inventoryDays: number | null;
  interestCoverage: number | null;
};

export type FinancialAnalysisPeriod = {
  reportDate: string;
  noticeDate: string;
  periodLabel: string;
  reportType: string;
  fiscalYear: number;
  quarter: number;
  single: FinancialMetrics;
  cumulative: FinancialMetrics;
  ttm: FinancialMetrics;
  singleYoY: FinancialMetrics;
  singleQoQ: FinancialMetrics;
  cumulativeYoY: FinancialMetrics;
  cumulativeQoQ: FinancialMetrics;
  ttmYoY: FinancialMetrics;
  ttmQoQ: FinancialMetrics;
  balance: FinancialBalanceMetrics;
  balanceYoY: FinancialBalanceMetrics;
  balanceQoQ: FinancialBalanceMetrics;
};

export type FinancialAnalysis = {
  periods: FinancialAnalysisPeriod[];
  latestReportDate: string;
  sourceScope: string;
};

type Row = Record<string, unknown>;
type NullableNumberMap = Record<string, number | null>;

const flowKeys = [
  "revenue",
  "operatingCost",
  "operatingProfit",
  "parentNetProfit",
  "deductNetProfit",
  "operatingCashFlow",
  "investingCashFlow",
  "financingCashFlow",
  "capex",
  "researchExpense",
] as const;

const rateKeys = new Set<keyof FinancialMetrics>([
  "grossMargin",
  "netMargin",
  "deductMargin",
  "cashCoverage",
  "researchExpenseRatio",
  "roe",
  "roic",
]);

const balanceRateKeys = new Set<keyof FinancialBalanceMetrics>([
  "currentRatio",
  "quickRatio",
  "debtAssetRatio",
  "receivableDays",
  "inventoryDays",
  "interestCoverage",
]);

export function emptyFinancialAnalysis(): FinancialAnalysis {
  return { periods: [], latestReportDate: "", sourceScope: "合并报表 · 正式财报" };
}

export function buildFinancialAnalysis({
  income,
  balance,
  cashflow,
  indicators,
}: {
  income: unknown;
  balance: unknown;
  cashflow: unknown;
  indicators: unknown;
}): FinancialAnalysis {
  const incomeRows = rowsFrom(income);
  const balanceByDate = rowsByDate(balance);
  const cashflowByDate = rowsByDate(cashflow);
  const indicatorByDate = rowsByDate(indicators);
  const rawPeriods = incomeRows.flatMap((incomeRow) => {
    const reportDate = toDate(incomeRow.REPORT_DATE);
    if (!reportDate) return [];
    const quarter = quarterFromDate(reportDate);
    const balanceRow = balanceByDate.get(reportDate) ?? {};
    const cashflowRow = cashflowByDate.get(reportDate) ?? {};
    const indicatorRow = indicatorByDate.get(reportDate) ?? {};
    const cumulativeRaw: NullableNumberMap = {
      revenue: toNumber(incomeRow.TOTAL_OPERATE_INCOME),
      operatingCost: toNumber(incomeRow.OPERATE_COST),
      operatingProfit: toNumber(incomeRow.OPERATE_PROFIT),
      parentNetProfit: toNumber(incomeRow.PARENT_NETPROFIT),
      deductNetProfit: toNumber(incomeRow.DEDUCT_PARENT_NETPROFIT),
      operatingCashFlow: toNumber(cashflowRow.NETCASH_OPERATE),
      investingCashFlow: toNumber(cashflowRow.NETCASH_INVEST),
      financingCashFlow: toNumber(cashflowRow.NETCASH_FINANCE),
      capex: toNumber(cashflowRow.CONSTRUCT_LONG_ASSET),
      researchExpense: toNumber(incomeRow.RESEARCH_EXPENSE),
    };
    return [{
      reportDate,
      noticeDate: toDate(incomeRow.NOTICE_DATE),
      periodLabel: String(incomeRow.REPORT_DATE_NAME ?? indicatorRow.REPORT_DATE_NAME ?? "").trim() || periodLabel(reportDate),
      reportType: String(incomeRow.REPORT_TYPE ?? indicatorRow.REPORT_TYPE ?? "").trim() || reportType(quarter),
      fiscalYear: Number(reportDate.slice(0, 4)),
      quarter,
      ordinal: Number(reportDate.slice(0, 4)) * 4 + quarter,
      cumulativeRaw,
      balance: parseBalance(balanceRow, indicatorRow),
      reportedRoe: toNumber(indicatorRow.ROEJQ),
      reportedRoic: toNumber(indicatorRow.ROIC),
    }];
  }).sort((left, right) => left.ordinal - right.ordinal);

  const rawByOrdinal = new Map(rawPeriods.map((period) => [period.ordinal, period]));
  const prepared = rawPeriods.map((period) => {
    const previousQuarter = rawByOrdinal.get(period.ordinal - 1);
    const singleRaw = period.quarter === 1
      ? period.cumulativeRaw
      : previousQuarter?.fiscalYear === period.fiscalYear
        ? subtractMaps(period.cumulativeRaw, previousQuarter.cumulativeRaw)
        : nullMap(flowKeys);
    const trailingPeriods = [0, 1, 2, 3].map((offset) => rawByOrdinal.get(period.ordinal - offset));
    const ttmRaw = trailingPeriods.every(Boolean)
      ? sumMaps(trailingPeriods.map((item) => {
        if (!item) return nullMap(flowKeys);
        if (item.quarter === 1) return item.cumulativeRaw;
        const prior = rawByOrdinal.get(item.ordinal - 1);
        return prior?.fiscalYear === item.fiscalYear
          ? subtractMaps(item.cumulativeRaw, prior.cumulativeRaw)
          : nullMap(flowKeys);
      }))
      : nullMap(flowKeys);
    const yearAgoBalance = rawByOrdinal.get(period.ordinal - 4)?.balance;
    const averageEquity = averageNullable(period.balance.parentEquity, yearAgoBalance?.parentEquity ?? null);
    const ttmRoe = dividePercent(ttmRaw.parentNetProfit, averageEquity);
    return {
      ...period,
      single: deriveMetrics(singleRaw, null, null),
      cumulative: deriveMetrics(period.cumulativeRaw, period.reportedRoe, period.reportedRoic),
      ttm: deriveMetrics(ttmRaw, ttmRoe, period.reportedRoic),
    };
  });

  const preparedByOrdinal = new Map(prepared.map((period) => [period.ordinal, period]));
  const periods = prepared.map((period): FinancialAnalysisPeriod => {
    const previous = preparedByOrdinal.get(period.ordinal - 1);
    const yearAgo = preparedByOrdinal.get(period.ordinal - 4);
    return {
      reportDate: period.reportDate,
      noticeDate: period.noticeDate,
      periodLabel: period.periodLabel,
      reportType: period.reportType,
      fiscalYear: period.fiscalYear,
      quarter: period.quarter,
      single: period.single,
      cumulative: period.cumulative,
      ttm: period.ttm,
      singleYoY: compareMetrics(period.single, yearAgo?.single),
      singleQoQ: compareMetrics(period.single, previous?.single),
      cumulativeYoY: compareMetrics(period.cumulative, yearAgo?.cumulative),
      cumulativeQoQ: compareMetrics(period.cumulative, previous?.cumulative),
      ttmYoY: compareMetrics(period.ttm, yearAgo?.ttm),
      ttmQoQ: compareMetrics(period.ttm, previous?.ttm),
      balance: period.balance,
      balanceYoY: compareBalance(period.balance, yearAgo?.balance),
      balanceQoQ: compareBalance(period.balance, previous?.balance),
    };
  }).reverse();

  return {
    periods,
    latestReportDate: periods[0]?.reportDate ?? "",
    sourceScope: "合并报表 · 正式财报",
  };
}

function parseBalance(row: Row, indicators: Row): FinancialBalanceMetrics {
  const debtParts = [row.SHORT_LOAN, row.LONG_LOAN, row.BOND_PAYABLE, row.NONCURRENT_LIAB_1YEAR, row.LEASE_LIAB]
    .map(toNumber)
    .filter((value): value is number => value != null);
  const interestBearingDebt = debtParts.length ? debtParts.reduce((sum, value) => sum + value, 0) : null;
  const cash = toNumber(row.MONETARYFUNDS);
  return {
    accountsReceivable: toNumber(row.ACCOUNTS_RECE),
    inventory: toNumber(row.INVENTORY),
    contractLiabilities: toNumber(row.CONTRACT_LIAB),
    goodwill: toNumber(row.GOODWILL),
    fixedAssets: toNumber(row.FIXED_ASSET),
    constructionInProgress: toNumber(row.CIP),
    cash,
    interestBearingDebt,
    netDebt: interestBearingDebt == null || cash == null ? null : interestBearingDebt - cash,
    totalAssets: toNumber(row.TOTAL_ASSETS),
    totalLiabilities: toNumber(row.TOTAL_LIABILITIES),
    parentEquity: toNumber(row.TOTAL_PARENT_EQUITY),
    currentRatio: toNumber(indicators.LD),
    quickRatio: toNumber(indicators.SD),
    debtAssetRatio: toNumber(indicators.ZCFZL) ?? dividePercent(toNumber(row.TOTAL_LIABILITIES), toNumber(row.TOTAL_ASSETS)),
    receivableDays: toNumber(indicators.YSZKZZTS),
    inventoryDays: toNumber(indicators.CHZZTS),
    interestCoverage: toNumber(indicators.INTEREST_COVERAGE_RATIO) ?? toNumber(indicators.INTSTCOVRATE),
  };
}

function deriveMetrics(raw: NullableNumberMap, roe: number | null, roic: number | null): FinancialMetrics {
  const revenue = raw.revenue ?? null;
  const operatingCost = raw.operatingCost ?? null;
  const parentNetProfit = raw.parentNetProfit ?? null;
  const deductNetProfit = raw.deductNetProfit ?? null;
  const operatingCashFlow = raw.operatingCashFlow ?? null;
  const capex = raw.capex ?? null;
  const grossProfit = revenue == null || operatingCost == null ? null : revenue - operatingCost;
  return {
    revenue,
    operatingCost,
    grossProfit,
    operatingProfit: raw.operatingProfit ?? null,
    parentNetProfit,
    deductNetProfit,
    nonRecurringProfit: parentNetProfit == null || deductNetProfit == null ? null : parentNetProfit - deductNetProfit,
    operatingCashFlow,
    investingCashFlow: raw.investingCashFlow ?? null,
    financingCashFlow: raw.financingCashFlow ?? null,
    capex,
    freeCashFlow: operatingCashFlow == null || capex == null ? null : operatingCashFlow - capex,
    researchExpense: raw.researchExpense ?? null,
    grossMargin: dividePercent(grossProfit, revenue),
    netMargin: dividePercent(parentNetProfit, revenue),
    deductMargin: dividePercent(deductNetProfit, revenue),
    cashCoverage: divideRatio(operatingCashFlow, parentNetProfit),
    researchExpenseRatio: dividePercent(raw.researchExpense ?? null, revenue),
    roe,
    roic,
  };
}

function compareMetrics(current: FinancialMetrics, comparison?: FinancialMetrics): FinancialMetrics {
  return mapObject(current, (key, value) => {
    const prior = comparison?.[key] ?? null;
    return rateKeys.has(key) ? difference(value, prior) : growth(value, prior);
  });
}

function compareBalance(current: FinancialBalanceMetrics, comparison?: FinancialBalanceMetrics): FinancialBalanceMetrics {
  return mapObject(current, (key, value) => {
    const prior = comparison?.[key] ?? null;
    return balanceRateKeys.has(key) ? difference(value, prior) : growth(value, prior);
  });
}

function rowsFrom(value: unknown): Row[] {
  const data = (value as { result?: { data?: unknown } } | null)?.result?.data;
  return (Array.isArray(data) ? data : [])
    .filter((item): item is Row => Boolean(item && typeof item === "object"))
    .filter((row, index, rows) => {
      const date = toDate(row.REPORT_DATE);
      return Boolean(date) && rows.findIndex((candidate) => toDate(candidate.REPORT_DATE) === date) === index;
    });
}

function rowsByDate(value: unknown): Map<string, Row> {
  return new Map(rowsFrom(value).map((row) => [toDate(row.REPORT_DATE), row]));
}

function subtractMaps(current: NullableNumberMap, previous: NullableNumberMap): NullableNumberMap {
  return Object.fromEntries(flowKeys.map((key) => [key, subtract(current[key], previous[key])])) as NullableNumberMap;
}

function sumMaps(items: NullableNumberMap[]): NullableNumberMap {
  return Object.fromEntries(flowKeys.map((key) => {
    const values = items.map((item) => item[key]);
    return [key, values.some((value) => value == null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)];
  })) as NullableNumberMap;
}

function nullMap(keys: readonly string[]): NullableNumberMap {
  return Object.fromEntries(keys.map((key) => [key, null]));
}

function mapObject<T extends Record<string, number | null>>(
  value: T,
  mapper: (key: keyof T, value: number | null) => number | null,
): T {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapper(key as keyof T, item)])) as T;
}

function growth(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function difference(current: number | null, previous: number | null): number | null {
  return current == null || previous == null ? null : current - previous;
}

function subtract(current: number | null | undefined, previous: number | null | undefined): number | null {
  return current == null || previous == null ? null : current - previous;
}

function dividePercent(numerator: number | null, denominator: number | null): number | null {
  const ratio = divideRatio(numerator, denominator);
  return ratio == null ? null : ratio * 100;
}

function divideRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

function averageNullable(left: number | null, right: number | null): number | null {
  return left == null || right == null ? null : (left + right) / 2;
}

function toDate(value: unknown): string {
  return String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function quarterFromDate(date: string): number {
  return Math.ceil(Number(date.slice(5, 7)) / 3);
}

function periodLabel(date: string): string {
  return `${date.slice(0, 4)}Q${quarterFromDate(date)}`;
}

function reportType(quarter: number): string {
  return ["", "一季报", "半年报", "三季报", "年报"][quarter] ?? "定期报告";
}
