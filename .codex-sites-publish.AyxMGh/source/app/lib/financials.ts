import {
  buildFinancialAnalysis,
  emptyFinancialAnalysis,
  type FinancialAnalysis,
} from "./financialAnalysis.ts";

const financialDataEndpoint = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const maxFinancialResponseBytes = 2 * 1024 * 1024;

export type FinancialReport = {
  reportDate: string;
  noticeDate: string;
  periodLabel: string;
  reportType: string;
  revenue: number | null;
  revenueYoY: number | null;
  netProfit: number | null;
  netProfitYoY: number | null;
  basicEps: number | null;
  bookValuePerShare: number | null;
  operatingCashFlowPerShare: number | null;
  roe: number | null;
  roa: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  debtAssetRatio: number | null;
};

export type FundamentalSnapshot = {
  asOfDate: string;
  industry: string;
  closePrice: number | null;
  totalMarketCap: number | null;
  floatMarketCap: number | null;
  totalShares: number | null;
  peTtm: number | null;
  peStatic: number | null;
  pb: number | null;
  psTtm: number | null;
  pcfTtm: number | null;
  peg: number | null;
  peTtmPercentile: number | null;
  pbPercentile: number | null;
  psTtmPercentile: number | null;
  valuationHistoryCount: number;
  valuationHistoryFrom: string;
  dividendYieldTtm: number | null;
  cashDividendPerShareTtm: number | null;
  dividendPaymentsTtm: number;
  latestDividendProfile: string;
  latestDividendDate: string;
};

export type HolderPosition = {
  name: string;
  type: string;
  ratio: number;
  changeRatio: number | null;
  state: string;
};

export type HolderStructure = {
  asOfDate: string;
  reportLabel: string;
  institutionalRatio: number | null;
  retailProxyRatio: number | null;
  previousInstitutionalRatio: number | null;
  institutionalChangePp: number | null;
  topThreeInstitutionalRatio: number | null;
  institutionCount: number;
  topInstitutions: HolderPosition[];
  analysis: string;
};

export type FinancialDataset = {
  code: string;
  name: string;
  reports: FinancialReport[];
  snapshot: FundamentalSnapshot;
  holderStructure: HolderStructure;
  analysis: FinancialAnalysis;
  source: string;
  fetchedAt: string;
};

type EastMoneyFinancialRow = Record<string, unknown>;

export function emptyFinancialDataset(): FinancialDataset {
  return {
    code: "",
    name: "",
    reports: [],
    snapshot: emptyFundamentalSnapshot(),
    holderStructure: emptyHolderStructure(),
    analysis: emptyFinancialAnalysis(),
    source: "东方财富公开财务报表、估值、分红与流通股东数据",
    fetchedAt: "",
  };
}

export function emptyHolderStructure(): HolderStructure {
  return {
    asOfDate: "",
    reportLabel: "",
    institutionalRatio: null,
    retailProxyRatio: null,
    previousInstitutionalRatio: null,
    institutionalChangePp: null,
    topThreeInstitutionalRatio: null,
    institutionCount: 0,
    topInstitutions: [],
    analysis: "",
  };
}

export function emptyFundamentalSnapshot(): FundamentalSnapshot {
  return {
    asOfDate: "",
    industry: "",
    closePrice: null,
    totalMarketCap: null,
    floatMarketCap: null,
    totalShares: null,
    peTtm: null,
    peStatic: null,
    pb: null,
    psTtm: null,
    pcfTtm: null,
    peg: null,
    peTtmPercentile: null,
    pbPercentile: null,
    psTtmPercentile: null,
    valuationHistoryCount: 0,
    valuationHistoryFrom: "",
    dividendYieldTtm: null,
    cashDividendPerShareTtm: null,
    dividendPaymentsTtm: 0,
    latestDividendProfile: "",
    latestDividendDate: "",
  };
}

export function normalizeFinancialRequest(value: unknown): { code: string } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const rawCode = String((value as { code?: unknown }).code ?? "").trim();
  const code = rawCode.replace(/^(?:sh|sz)/i, "").replace(/\.(?:sh|sz)$/i, "");
  if (!/^\d{6}$/.test(code)) throw new Error("请输入有效的 6 位沪深 A 股代码");
  return { code };
}

export function toSecuCode(code: string): string {
  const normalized = normalizeFinancialRequest({ code }).code;
  return `${normalized}.${/^[569]/.test(normalized) ? "SH" : "SZ"}`;
}

export function parseFinancialResponse(
  value: unknown,
  code: string,
  snapshot: FundamentalSnapshot = emptyFundamentalSnapshot(),
  analysis: FinancialAnalysis = emptyFinancialAnalysis(),
  holderStructure: HolderStructure = emptyHolderStructure(),
): FinancialDataset {
  const result = (value as { result?: { data?: unknown } } | null)?.result;
  const rows = (Array.isArray(result?.data) ? result.data : [])
    .filter((item): item is EastMoneyFinancialRow => Boolean(item && typeof item === "object"))
    .sort((left, right) => String(right.REPORT_DATE ?? "").localeCompare(String(left.REPORT_DATE ?? "")));
  const seenDates = new Set<string>();
  const reports = rows.flatMap((item) => {
    const row = item;
    const reportDate = toDate(row.REPORT_DATE);
    if (!reportDate || seenDates.has(reportDate)) return [];
    const revenue = toFiniteNumber(row.TOTALOPERATEREVE);
    const netProfit = toFiniteNumber(row.PARENTNETPROFIT);
    if (revenue == null && netProfit == null) return [];
    seenDates.add(reportDate);
    return [{
      reportDate,
      noticeDate: toDate(row.NOTICE_DATE),
      periodLabel: String(row.REPORT_DATE_NAME ?? "").trim() || formatPeriodLabel(reportDate),
      reportType: String(row.REPORT_TYPE ?? "").trim() || "定期报告",
      revenue,
      revenueYoY: toFiniteNumber(row.TOTALOPERATEREVETZ),
      netProfit,
      netProfitYoY: toFiniteNumber(row.PARENTNETPROFITTZ),
      basicEps: toFiniteNumber(row.EPSJB),
      bookValuePerShare: toFiniteNumber(row.BPS),
      operatingCashFlowPerShare: toFiniteNumber(row.MGJYXJJE),
      roe: toFiniteNumber(row.ROEJQ),
      roa: toFiniteNumber(row.ZZCJLL),
      grossMargin: toFiniteNumber(row.XSMLL),
      netMargin: toFiniteNumber(row.XSJLL),
      debtAssetRatio: toFiniteNumber(row.ZCFZL),
    }];
  }).slice(0, 3);

  if (reports.length === 0) throw new Error("财报服务未返回可用的定期报告数据");
  const firstRow = rows[0];
  return {
    code: normalizeFinancialRequest({ code }).code,
    name: String(firstRow?.SECURITY_NAME_ABBR ?? "").trim(),
    reports,
    snapshot,
    holderStructure,
    analysis,
    source: "东方财富公开财务报表、估值、分红与流通股东数据",
    fetchedAt: new Date().toISOString(),
  };
}

export function parseHolderStructureResponse(value: unknown): HolderStructure {
  const rows = (value as { result?: { data?: unknown } } | null)?.result?.data;
  const records = (Array.isArray(rows) ? rows : []).filter(
    (item): item is EastMoneyFinancialRow => Boolean(item && typeof item === "object"),
  );
  const dates = [...new Set(records.map((row) => toDate(row.END_DATE)).filter(Boolean))].sort((left, right) => right.localeCompare(left));
  const latestDate = dates[0] ?? "";
  if (!latestDate) return emptyHolderStructure();

  const rowsForDate = (date: string) => records
    .filter((row) => toDate(row.END_DATE) === date)
    .sort((left, right) => (toFiniteNumber(left.HOLDER_RANK) ?? 99) - (toFiniteNumber(right.HOLDER_RANK) ?? 99))
    .slice(0, 10);
  const institutionalRows = (date: string) => rowsForDate(date).filter((row) => String(row.IS_HOLDORG ?? "") === "1");
  const ratioForRows = (items: EastMoneyFinancialRow[]) => items.reduce((sum, row) => sum + Math.max(0, toFiniteNumber(row.FREE_HOLDNUM_RATIO) ?? 0), 0);
  const latestInstitutions = institutionalRows(latestDate);
  const previousInstitutions = dates[1] ? institutionalRows(dates[1]) : [];
  const institutionalRatio = Math.min(100, ratioForRows(latestInstitutions));
  const previousInstitutionalRatio = dates[1] ? Math.min(100, ratioForRows(previousInstitutions)) : null;
  const institutionalChangePp = previousInstitutionalRatio == null ? null : institutionalRatio - previousInstitutionalRatio;
  const topInstitutions = latestInstitutions.slice(0, 5).map((row) => ({
    name: String(row.HOLD_NUM_ABBR ?? row.HOLDER_NAME ?? "机构股东").trim(),
    type: String(row.HOLDER_NEWTYPE ?? row.HOLDER_TYPE ?? "机构").trim() || "机构",
    ratio: Math.max(0, toFiniteNumber(row.FREE_HOLDNUM_RATIO) ?? 0),
    changeRatio: toFiniteNumber(row.HOLD_RATIO_CHANGE),
    state: String(row.HOLDER_STATE_NEW ?? row.HOLDNUM_CHANGE_NAME ?? "").trim() || "持有",
  }));
  const direction = institutionalChangePp == null || Math.abs(institutionalChangePp) < 0.1
    ? "与上一期基本持平"
    : institutionalChangePp > 0
      ? `较上一期上升 ${institutionalChangePp.toFixed(2)} 个百分点，集中度提高`
      : `较上一期下降 ${Math.abs(institutionalChangePp).toFixed(2)} 个百分点，集中度回落`;
  const concentration = institutionalRatio >= 50 ? "前十机构持仓较集中" : institutionalRatio >= 30 ? "前十机构持仓中等集中" : "前十机构持仓相对分散";

  return {
    asOfDate: latestDate,
    reportLabel: String(rowsForDate(latestDate)[0]?.REPORT_DATE_NAME ?? "").trim(),
    institutionalRatio,
    retailProxyRatio: Math.max(0, 100 - institutionalRatio),
    previousInstitutionalRatio,
    institutionalChangePp,
    topThreeInstitutionalRatio: Math.min(100, ratioForRows(latestInstitutions.slice(0, 3))),
    institutionCount: latestInstitutions.length,
    topInstitutions,
    analysis: `${concentration}，${direction}。`,
  };
}

export function parseValuationResponse(value: unknown): FundamentalSnapshot {
  const rows = (value as { result?: { data?: unknown } } | null)?.result?.data;
  const records = (Array.isArray(rows) ? rows : []).filter(
    (item): item is EastMoneyFinancialRow => Boolean(item && typeof item === "object"),
  );
  const row = records[0] as
    | EastMoneyFinancialRow
    | undefined;
  if (!row) return emptyFundamentalSnapshot();
  const percentile = (field: string): number | null => {
    const current = toFiniteNumber(row[field]);
    const history = records.map((item) => toFiniteNumber(item[field])).filter((item): item is number => item != null && item > 0);
    if (current == null || current <= 0 || history.length < 20) return null;
    return (history.filter((item) => item <= current).length / history.length) * 100;
  };
  return {
    ...emptyFundamentalSnapshot(),
    asOfDate: toDate(row.TRADE_DATE),
    industry: String(row.BOARD_NAME ?? "").trim(),
    closePrice: toFiniteNumber(row.CLOSE_PRICE),
    totalMarketCap: toFiniteNumber(row.TOTAL_MARKET_CAP),
    floatMarketCap: toFiniteNumber(row.NOTLIMITED_MARKETCAP_A),
    totalShares: toFiniteNumber(row.TOTAL_SHARES),
    peTtm: toFiniteNumber(row.PE_TTM),
    peStatic: toFiniteNumber(row.PE_LAR),
    pb: toFiniteNumber(row.PB_MRQ),
    psTtm: toFiniteNumber(row.PS_TTM),
    pcfTtm: toFiniteNumber(row.PCF_OCF_TTM),
    peg: toFiniteNumber(row.PEG_CAR),
    peTtmPercentile: percentile("PE_TTM"),
    pbPercentile: percentile("PB_MRQ"),
    psTtmPercentile: percentile("PS_TTM"),
    valuationHistoryCount: records.length,
    valuationHistoryFrom: records.length ? toDate(records.at(-1)?.TRADE_DATE) : "",
  };
}

export function parseDividendResponse(
  value: unknown,
  asOfDate: string,
  closePrice: number | null,
): Pick<
  FundamentalSnapshot,
  | "dividendYieldTtm"
  | "cashDividendPerShareTtm"
  | "dividendPaymentsTtm"
  | "latestDividendProfile"
  | "latestDividendDate"
> {
  const rows = (value as { result?: { data?: unknown } } | null)?.result?.data;
  const records = (Array.isArray(rows) ? rows : []).filter(
    (item): item is EastMoneyFinancialRow => Boolean(item && typeof item === "object"),
  );
  const effectiveAsOfDate = asOfDate || new Date().toISOString().slice(0, 10);
  const asOfTime = dateToUtcTime(effectiveAsOfDate);
  const cutoff = new Date(asOfTime);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const seen = new Set<string>();
  let cashDividendPerShareTtm = 0;
  let dividendPaymentsTtm = 0;
  let latestDividendProfile = "";
  let latestDividendDate = "";

  for (const row of records) {
    const exDividendDate = toDate(row.EX_DIVIDEND_DATE);
    const profile = String(row.IMPL_PLAN_PROFILE ?? "").trim();
    if (!latestDividendProfile && profile) {
      latestDividendProfile = profile;
      latestDividendDate = exDividendDate || toDate(row.REPORT_DATE);
    }
    const pretaxCashPerTenShares = toFiniteNumber(row.PRETAX_BONUS_RMB);
    const exDividendTime = dateToUtcTime(exDividendDate);
    const recordKey = `${toDate(row.REPORT_DATE)}:${exDividendDate}:${pretaxCashPerTenShares ?? ""}`;
    if (
      pretaxCashPerTenShares == null ||
      pretaxCashPerTenShares <= 0 ||
      !Number.isFinite(exDividendTime) ||
      exDividendTime <= cutoff.getTime() ||
      exDividendTime > asOfTime ||
      seen.has(recordKey)
    ) continue;
    seen.add(recordKey);
    cashDividendPerShareTtm += pretaxCashPerTenShares / 10;
    dividendPaymentsTtm += 1;
  }

  const hasTtmDividend = dividendPaymentsTtm > 0;
  return {
    dividendYieldTtm: hasTtmDividend && closePrice != null && closePrice > 0
      ? (cashDividendPerShareTtm / closePrice) * 100
      : null,
    cashDividendPerShareTtm: hasTtmDividend ? cashDividendPerShareTtm : null,
    dividendPaymentsTtm,
    latestDividendProfile,
    latestDividendDate,
  };
}

export async function fetchFinancials(code: string): Promise<FinancialDataset> {
  const normalizedCode = normalizeFinancialRequest({ code }).code;
  const requests = [
    fetchEastMoneyReport({
      reportName: "RPT_F10_FINANCE_MAINFINADATA",
      filter: `(SECUCODE=\"${toSecuCode(normalizedCode)}\")`,
      pageSize: 50,
      sortColumns: "REPORT_DATE",
      label: "财报",
    }),
    fetchEastMoneyReport({
      reportName: "RPT_VALUEANALYSIS_DET",
      filter: `(SECURITY_CODE=\"${normalizedCode}\")`,
      pageSize: 1250,
      sortColumns: "TRADE_DATE",
      label: "估值",
      columns: "TRADE_DATE,BOARD_NAME,CLOSE_PRICE,TOTAL_MARKET_CAP,NOTLIMITED_MARKETCAP_A,TOTAL_SHARES,PE_TTM,PE_LAR,PB_MRQ,PS_TTM,PCF_OCF_TTM,PEG_CAR",
    }),
    fetchEastMoneyReport({
      reportName: "RPT_SHAREBONUS_DET",
      filter: `(SECURITY_CODE=\"${normalizedCode}\")`,
      pageSize: 20,
      sortColumns: "REPORT_DATE",
      label: "分红",
    }),
    fetchEastMoneyReport({
      reportName: "RPT_F10_FINANCE_GINCOME",
      filter: `(SECUCODE=\"${toSecuCode(normalizedCode)}\")`,
      pageSize: 50,
      sortColumns: "REPORT_DATE",
      label: "利润表",
    }),
    fetchEastMoneyReport({
      reportName: "RPT_F10_FINANCE_GBALANCE",
      filter: `(SECUCODE=\"${toSecuCode(normalizedCode)}\")`,
      pageSize: 50,
      sortColumns: "REPORT_DATE",
      label: "资产负债表",
    }),
    fetchEastMoneyReport({
      reportName: "RPT_F10_FINANCE_GCASHFLOW",
      filter: `(SECUCODE=\"${toSecuCode(normalizedCode)}\")`,
      pageSize: 50,
      sortColumns: "REPORT_DATE",
      label: "现金流量表",
    }),
    fetchEastMoneyReport({
      reportName: "RPT_F10_EH_FREEHOLDERS",
      filter: `(SECUCODE=\"${toSecuCode(normalizedCode)}\")`,
      pageSize: 20,
      sortColumns: "END_DATE",
      label: "流通股东",
    }),
  ] as const;
  const [financialResult, valuationResult, dividendResult, incomeResult, balanceResult, cashflowResult, holderResult] = await Promise.allSettled(requests);
  if (financialResult.status === "rejected") throw financialResult.reason;

  let snapshot = valuationResult.status === "fulfilled"
    ? parseValuationResponse(valuationResult.value)
    : emptyFundamentalSnapshot();
  if (dividendResult.status === "fulfilled") {
    snapshot = {
      ...snapshot,
      ...parseDividendResponse(dividendResult.value, snapshot.asOfDate, snapshot.closePrice),
    };
  }
  const analysis = incomeResult.status === "fulfilled" && balanceResult.status === "fulfilled" && cashflowResult.status === "fulfilled"
    ? buildFinancialAnalysis({
      income: incomeResult.value,
      balance: balanceResult.value,
      cashflow: cashflowResult.value,
      indicators: financialResult.value,
    })
    : emptyFinancialAnalysis();
  const holderStructure = holderResult.status === "fulfilled"
    ? parseHolderStructureResponse(holderResult.value)
    : emptyHolderStructure();
  return parseFinancialResponse(financialResult.value, normalizedCode, snapshot, analysis, holderStructure);
}

async function fetchEastMoneyReport({
  reportName,
  filter,
  pageSize,
  sortColumns,
  label,
  columns = "ALL",
}: {
  reportName: string;
  filter: string;
  pageSize: number;
  sortColumns: string;
  label: string;
  columns?: string;
}): Promise<unknown> {
  const endpoint = new URL(financialDataEndpoint);
  endpoint.searchParams.set("reportName", reportName);
  endpoint.searchParams.set("columns", columns);
  endpoint.searchParams.set("filter", filter);
  endpoint.searchParams.set("pageNumber", "1");
  endpoint.searchParams.set("pageSize", String(pageSize));
  endpoint.searchParams.set("sortColumns", sortColumns);
  endpoint.searchParams.set("sortTypes", "-1");
  endpoint.searchParams.set("source", "WEB");
  endpoint.searchParams.set("client", "WEB");

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        Referer: "https://data.eastmoney.com/",
        "User-Agent": "Mozilla/5.0 (compatible; TickLens/1.0)",
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (reason) {
    throw new Error(`${label}查询失败：${reason instanceof Error ? reason.message : "网络连接异常"}`);
  }
  if (!response.ok) throw new Error(`${label}查询失败：HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > maxFinancialResponseBytes) throw new Error(`${label}查询响应过大`);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`${label}服务返回了异常页面，请稍后重试`);
  }
  const apiResponse = payload as { success?: unknown; message?: unknown } | null;
  if (apiResponse?.success === false) {
    throw new Error(String(apiResponse.message || `${label}服务未返回有效数据`));
  }
  return payload;
}

function toDate(value: unknown): string {
  const match = String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? "";
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateToUtcTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN;
  return Date.parse(`${value}T00:00:00Z`);
}

function formatPeriodLabel(reportDate: string): string {
  const [year, month] = reportDate.split("-");
  const suffix = { "03": "一季报", "06": "半年报", "09": "三季报", "12": "年报" }[month] ?? "定期报告";
  return `${year}${suffix}`;
}
