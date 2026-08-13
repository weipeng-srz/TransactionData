import {
  emptyFundamentalSnapshot,
  emptyHolderStructure,
  type FinancialDataset,
  type FinancialReport,
} from "./financials.ts";
import type {
  FinancialAnalysisPeriod,
  FinancialBalanceMetrics,
  FinancialMetrics,
} from "./financialAnalysis.ts";
import { isUSStockSymbol, normalizeUSSymbol } from "./security.ts";
import { lookupUSStock } from "./usStockLookup.ts";
import { fetchUSRealtimeSnapshot } from "./usStockRealtime.ts";

const tickerEndpoint = "https://www.sec.gov/files/company_tickers.json";
const companyFactsEndpoint = "https://data.sec.gov/api/xbrl/companyfacts";
// SEC asks automated clients to identify an application and a contact address.
// Deployments can override the project contact without changing application code.
const secUserAgent = typeof process !== "undefined" && process.env?.SEC_USER_AGENT
  ? process.env.SEC_USER_AGENT
  : "TrendSight contact@trendsight.dev";
const maxResponseBytes = 24 * 1024 * 1024;
const cacheLifetimeMs = 6 * 60 * 60 * 1000;

type SecTicker = { cik_str?: unknown; ticker?: unknown; title?: unknown };
type SecUnit = { start?: string; end?: string; val?: number; accn?: string; fy?: number; fp?: string; form?: string; filed?: string; frame?: string };
type SecFact = { units?: Record<string, SecUnit[]> };
type SecCompanyFacts = {
  entityName?: string;
  sicDescription?: string;
  facts?: { "us-gaap"?: Record<string, SecFact>; dei?: Record<string, SecFact> };
};
type PeriodSeed = { fiscalYear: number; quarter: number; fp: string; reportDate: string; noticeDate: string; accn: string };

let tickerCache: { expiresAt: number; value: Record<string, SecTicker> } | null = null;

const flowConcepts = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  operatingCost: ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
  operatingProfit: ["OperatingIncomeLoss"],
  parentNetProfit: ["NetIncomeLoss", "ProfitLoss"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities"],
  investingCashFlow: ["NetCashProvidedByUsedInInvestingActivities"],
  financingCashFlow: ["NetCashProvidedByUsedInFinancingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsForAdditionsToPropertyPlantAndEquipment"],
  researchExpense: ["ResearchAndDevelopmentExpense"],
} as const;

export function normalizeUSFinancialRequest(value: unknown): { code: string } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const code = normalizeUSSymbol((value as { code?: unknown }).code);
  if (!isUSStockSymbol(code)) throw new Error("请输入有效的美股代码，例如 AAPL 或 BRK.B");
  return { code };
}

export async function fetchUSFinancials(code: string): Promise<FinancialDataset> {
  const normalized = normalizeUSFinancialRequest({ code }).code;
  const tickers = await fetchSecTickers();
  const secSymbol = normalized.replaceAll(".", "-");
  const ticker = Object.values(tickers).find((item) => String(item.ticker ?? "").toUpperCase() === secSymbol);
  const cik = Number(ticker?.cik_str);
  if (!Number.isInteger(cik) || cik <= 0) throw new Error("SEC 未找到该美股代码对应的公司档案");
  const cikText = String(cik).padStart(10, "0");
  const [companyFacts, identity, quote] = await Promise.all([
    fetchSecJson<SecCompanyFacts>(`${companyFactsEndpoint}/CIK${cikText}.json`),
    lookupUSStock(normalized).catch(() => ({ code: normalized, name: String(ticker?.title ?? normalized), market: "US" as const, currency: "USD" as const })),
    fetchUSRealtimeSnapshot(normalized).catch(() => null),
  ]);
  const periods = buildUSFinancialPeriods(companyFacts);
  if (!periods.length) throw new Error("SEC Company Facts 未返回可用的季度财务数据");
  const reports = buildReports(periods);
  const latest = periods[0];
  const shares = latestFact(companyFacts, ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"], "shares");
  const equity = latest.balance.parentEquity;
  const ttmRevenue = latest.ttm.revenue;
  const ttmProfit = latest.ttm.parentNetProfit;
  const ttmCashFlow = latest.ttm.operatingCashFlow;
  const price = quote?.price ?? null;
  const marketCap = shares != null && price != null ? shares * price : null;
  const snapshot = {
    ...emptyFundamentalSnapshot(),
    asOfDate: quote?.date || latest.reportDate,
    industry: String(companyFacts.sicDescription ?? "").trim(),
    closePrice: price,
    totalMarketCap: marketCap,
    floatMarketCap: marketCap,
    totalShares: shares,
    peTtm: multiple(marketCap, ttmProfit),
    pb: multiple(marketCap, equity),
    psTtm: multiple(marketCap, ttmRevenue),
    pcfTtm: multiple(marketCap, ttmCashFlow),
  };
  const holderStructure = {
    ...emptyHolderStructure(),
    asOfDate: latest.reportDate,
    reportLabel: "SEC Company Facts",
    analysis: "SEC Company Facts 不提供可直接映射的实时机构持仓结构。",
  };
  return {
    code: normalized,
    name: identity.name || String(companyFacts.entityName ?? normalized),
    reports,
    snapshot,
    holderStructure,
    analysis: { periods, latestReportDate: latest.reportDate, sourceScope: "SEC Company Facts · USD · 正式申报" },
    source: "美国 SEC Company Facts（美元口径）",
    fetchedAt: new Date().toISOString(),
  };
}

export function buildUSFinancialPeriods(companyFacts: SecCompanyFacts): FinancialAnalysisPeriod[] {
  const revenueFacts = factsFor(companyFacts, flowConcepts.revenue, "USD");
  const seeds = periodSeeds(revenueFacts);
  const raw = seeds.map((seed) => {
    const single = deriveMetrics(Object.fromEntries(Object.entries(flowConcepts).map(([key, concepts]) => [
      key,
      singlePeriodValue(companyFacts, concepts, seed, seeds),
    ])) as Record<string, number | null>);
    const balance = buildBalance(companyFacts, seed);
    return { seed, single, balance };
  }).sort((left, right) => ordinal(left.seed) - ordinal(right.seed));
  const byOrdinal = new Map(raw.map((item) => [ordinal(item.seed), item]));
  return raw.map((item): FinancialAnalysisPeriod => {
    const prior = byOrdinal.get(ordinal(item.seed) - 1);
    const yearAgo = byOrdinal.get(ordinal(item.seed) - 4);
    const fiscalPeriods = raw.filter((candidate) => candidate.seed.fiscalYear === item.seed.fiscalYear && candidate.seed.quarter <= item.seed.quarter);
    const trailing = [0, 1, 2, 3].map((offset) => byOrdinal.get(ordinal(item.seed) - offset));
    const cumulative = sumMetrics(fiscalPeriods.map((candidate) => candidate.single));
    const ttm = trailing.every(Boolean) ? sumMetrics(trailing.map((candidate) => candidate!.single)) : emptyMetrics();
    if (ttm.parentNetProfit != null && item.balance.parentEquity != null) {
      const priorEquity = yearAgo?.balance.parentEquity;
      ttm.roe = priorEquity == null ? percent(ttm.parentNetProfit, item.balance.parentEquity) : percent(ttm.parentNetProfit, (item.balance.parentEquity + priorEquity) / 2);
    }
    return {
      reportDate: item.seed.reportDate,
      noticeDate: item.seed.noticeDate,
      periodLabel: `${item.seed.fiscalYear}Q${item.seed.quarter}`,
      reportType: item.seed.quarter === 4 ? "10-K 年报" : "10-Q 季报",
      fiscalYear: item.seed.fiscalYear,
      quarter: item.seed.quarter,
      single: item.single,
      cumulative,
      ttm,
      singleYoY: compareMetrics(item.single, yearAgo?.single),
      singleQoQ: compareMetrics(item.single, prior?.single),
      cumulativeYoY: compareMetrics(cumulative, yearAgo ? sumMetrics(raw.filter((candidate) => candidate.seed.fiscalYear === yearAgo.seed.fiscalYear && candidate.seed.quarter <= item.seed.quarter).map((candidate) => candidate.single)) : undefined),
      cumulativeQoQ: compareMetrics(cumulative, prior ? sumMetrics(raw.filter((candidate) => candidate.seed.fiscalYear === prior.seed.fiscalYear && candidate.seed.quarter <= prior.seed.quarter).map((candidate) => candidate.single)) : undefined),
      ttmYoY: compareMetrics(ttm, yearAgo ? sumMetrics([0, 1, 2, 3].map((offset) => byOrdinal.get(ordinal(yearAgo.seed) - offset)?.single ?? emptyMetrics())) : undefined),
      ttmQoQ: compareMetrics(ttm, prior ? sumMetrics([0, 1, 2, 3].map((offset) => byOrdinal.get(ordinal(prior.seed) - offset)?.single ?? emptyMetrics())) : undefined),
      balance: item.balance,
      balanceYoY: compareBalance(item.balance, yearAgo?.balance),
      balanceQoQ: compareBalance(item.balance, prior?.balance),
    };
  }).reverse().slice(0, 40);
}

function periodSeeds(facts: SecUnit[]): PeriodSeed[] {
  const grouped = new Map<string, SecUnit[]>();
  facts.filter((item) => (item.form === "10-Q" || item.form === "10-K") && Number.isInteger(item.fy) && ["Q1", "Q2", "Q3", "FY"].includes(String(item.fp)))
    .forEach((item) => {
      const key = `${item.fy}-${item.fp}`;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });
  return [...grouped.values()].flatMap((items) => {
    const latestEnd = [...items].sort((left, right) => String(right.end ?? "").localeCompare(String(left.end ?? "")) || String(right.filed ?? "").localeCompare(String(left.filed ?? "")))[0];
    const quarter = latestEnd.fp === "FY" ? 4 : Number(String(latestEnd.fp).slice(1));
    if (!latestEnd.end || !latestEnd.accn || !Number.isInteger(quarter)) return [];
    return [{ fiscalYear: Number(latestEnd.fy), quarter, fp: String(latestEnd.fp), reportDate: latestEnd.end, noticeDate: String(latestEnd.filed ?? ""), accn: latestEnd.accn }];
  }).sort((left, right) => ordinal(left) - ordinal(right)).slice(-40);
}

function singlePeriodValue(companyFacts: SecCompanyFacts, concepts: readonly string[], seed: PeriodSeed, seeds: PeriodSeed[]): number | null {
  const entries = factsFor(companyFacts, concepts, "USD").filter((item) => item.accn === seed.accn && item.end === seed.reportDate);
  const candidates = entries.filter((item) => item.start && item.val != null);
  const selected = [...candidates].sort((left, right) => durationDays(left) - durationDays(right))[0];
  if (seed.quarter < 4 && durationDays(selected ?? {}) <= 125) return finiteOrNull(selected?.val);
  if (seed.quarter < 4) {
    const cumulative = [...candidates].sort((left, right) => durationDays(right) - durationDays(left))[0];
    const cumulativeValue = finiteOrNull(cumulative?.val);
    if (cumulativeValue == null || seed.quarter === 1) return cumulativeValue;
    const previousSeed = seeds.find((item) => item.fiscalYear === seed.fiscalYear && item.quarter === seed.quarter - 1);
    if (!previousSeed) return null;
    const previousEntries = factsFor(companyFacts, concepts, "USD")
      .filter((item) => item.accn === previousSeed.accn && item.end === previousSeed.reportDate && item.start && item.val != null)
      .sort((left, right) => durationDays(right) - durationDays(left));
    const previousCumulative = finiteOrNull(previousEntries[0]?.val);
    return previousCumulative == null ? null : cumulativeValue - previousCumulative;
  }
  const annual = [...candidates].sort((left, right) => durationDays(right) - durationDays(left))[0];
  const annualValue = finiteOrNull(annual?.val);
  if (annualValue == null) return null;
  const priorSeeds = seeds.filter((item) => item.fiscalYear === seed.fiscalYear && item.quarter < 4);
  const priorValues = priorSeeds.map((item) => singlePeriodValue(companyFacts, concepts, item, seeds));
  return priorValues.some((value) => value == null) ? null : annualValue - priorValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function buildBalance(companyFacts: SecCompanyFacts, seed: PeriodSeed): FinancialBalanceMetrics {
  const value = (concepts: readonly string[]) => instantValue(companyFacts, concepts, seed);
  const cash = value(["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]);
  const debtParts = [
    value(["ShortTermBorrowings"]), value(["LongTermDebtCurrent"]), value(["LongTermDebtNoncurrent"]), value(["FinanceLeaseLiability"]),
  ].filter((item): item is number => item != null);
  const debt = debtParts.length ? debtParts.reduce((sum, item) => sum + item, 0) : null;
  const assets = value(["Assets"]);
  const liabilities = value(["Liabilities"]);
  const currentAssets = value(["AssetsCurrent"]);
  const currentLiabilities = value(["LiabilitiesCurrent"]);
  const inventory = value(["InventoryNet"]);
  return {
    accountsReceivable: value(["AccountsReceivableNetCurrent"]),
    inventory,
    contractLiabilities: value(["ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"]),
    goodwill: value(["Goodwill"]),
    fixedAssets: value(["PropertyPlantAndEquipmentNet"]),
    constructionInProgress: null,
    cash,
    interestBearingDebt: debt,
    netDebt: debt == null || cash == null ? null : debt - cash,
    totalAssets: assets,
    totalLiabilities: liabilities,
    parentEquity: value(["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]),
    currentRatio: ratio(currentAssets, currentLiabilities),
    quickRatio: currentAssets == null || inventory == null ? null : ratio(currentAssets - inventory, currentLiabilities),
    debtAssetRatio: percent(liabilities, assets),
    receivableDays: null,
    inventoryDays: null,
    interestCoverage: null,
  };
}

function instantValue(companyFacts: SecCompanyFacts, concepts: readonly string[], seed: PeriodSeed): number | null {
  const candidates = factsFor(companyFacts, concepts, "USD").filter((item) => item.end === seed.reportDate && item.val != null);
  return finiteOrNull(candidates.find((item) => item.accn === seed.accn)?.val ?? candidates.at(-1)?.val);
}

function factsFor(companyFacts: SecCompanyFacts, concepts: readonly string[], unit: string): SecUnit[] {
  for (const facts of [companyFacts.facts?.["us-gaap"], companyFacts.facts?.dei]) {
    if (!facts) continue;
    for (const concept of concepts) {
      const entries = facts[concept]?.units?.[unit];
      if (Array.isArray(entries) && entries.length) return entries;
    }
  }
  return [];
}

function latestFact(companyFacts: SecCompanyFacts, concepts: readonly string[], unit: string): number | null {
  const entries = factsFor(companyFacts, concepts, unit).filter((item) => item.val != null);
  return finiteOrNull([...entries].sort((left, right) => String(right.end ?? "").localeCompare(String(left.end ?? "")))[0]?.val);
}

function deriveMetrics(raw: Record<string, number | null>): FinancialMetrics {
  const revenue = raw.revenue ?? null;
  const operatingCost = raw.operatingCost ?? null;
  const parentNetProfit = raw.parentNetProfit ?? null;
  const grossProfit = revenue == null || operatingCost == null ? null : revenue - operatingCost;
  const operatingCashFlow = raw.operatingCashFlow ?? null;
  const capex = raw.capex ?? null;
  return {
    revenue, operatingCost, grossProfit, operatingProfit: raw.operatingProfit ?? null, parentNetProfit,
    deductNetProfit: null, nonRecurringProfit: null, operatingCashFlow,
    investingCashFlow: raw.investingCashFlow ?? null, financingCashFlow: raw.financingCashFlow ?? null, capex,
    freeCashFlow: operatingCashFlow == null || capex == null ? null : operatingCashFlow - Math.abs(capex),
    researchExpense: raw.researchExpense ?? null, grossMargin: percent(grossProfit, revenue), netMargin: percent(parentNetProfit, revenue),
    deductMargin: null, cashCoverage: ratio(operatingCashFlow, parentNetProfit), researchExpenseRatio: percent(raw.researchExpense ?? null, revenue), roe: null, roic: null,
  };
}

function emptyMetrics(): FinancialMetrics { return deriveMetrics({}); }
function emptyBalance(): FinancialBalanceMetrics { return { accountsReceivable: null, inventory: null, contractLiabilities: null, goodwill: null, fixedAssets: null, constructionInProgress: null, cash: null, interestBearingDebt: null, netDebt: null, totalAssets: null, totalLiabilities: null, parentEquity: null, currentRatio: null, quickRatio: null, debtAssetRatio: null, receivableDays: null, inventoryDays: null, interestCoverage: null }; }
function sumMetrics(items: FinancialMetrics[]): FinancialMetrics { const result = emptyMetrics(); (Object.keys(result) as Array<keyof FinancialMetrics>).forEach((key) => { if (["grossMargin", "netMargin", "deductMargin", "cashCoverage", "researchExpenseRatio", "roe", "roic"].includes(key)) return; const values = items.map((item) => item[key]); result[key] = values.some((value) => value == null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0); }); return deriveMetrics(result); }
function compareMetrics(current: FinancialMetrics, prior?: FinancialMetrics): FinancialMetrics { const result = emptyMetrics(); (Object.keys(result) as Array<keyof FinancialMetrics>).forEach((key) => { const a = current[key]; const b = prior?.[key] ?? null; result[key] = ["grossMargin", "netMargin", "deductMargin", "researchExpenseRatio", "roe", "roic"].includes(key) ? difference(a, b) : growth(a, b); }); return result; }
function compareBalance(current: FinancialBalanceMetrics, prior?: FinancialBalanceMetrics): FinancialBalanceMetrics { const result = emptyBalance(); (Object.keys(result) as Array<keyof FinancialBalanceMetrics>).forEach((key) => { const a = current[key]; const b = prior?.[key] ?? null; result[key] = ["currentRatio", "quickRatio", "debtAssetRatio", "receivableDays", "inventoryDays", "interestCoverage"].includes(key) ? difference(a, b) : growth(a, b); }); return result; }
function buildReports(periods: FinancialAnalysisPeriod[]): FinancialReport[] { return periods.slice(0, 12).map((period) => ({ reportDate: period.reportDate, noticeDate: period.noticeDate, periodLabel: period.periodLabel, reportType: period.reportType, revenue: period.single.revenue, revenueYoY: period.singleYoY.revenue, netProfit: period.single.parentNetProfit, netProfitYoY: period.singleYoY.parentNetProfit, basicEps: null, bookValuePerShare: null, operatingCashFlowPerShare: null, roe: period.ttm.roe, roa: null, grossMargin: period.single.grossMargin, netMargin: period.single.netMargin, debtAssetRatio: period.balance.debtAssetRatio })); }
function durationDays(item: SecUnit): number { const start = Date.parse(String(item.start ?? "")); const end = Date.parse(String(item.end ?? "")); return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 86_400_000) : Number.MAX_SAFE_INTEGER; }
function ordinal(seed: PeriodSeed): number { return seed.fiscalYear * 4 + seed.quarter; }
function finiteOrNull(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function ratio(a: number | null, b: number | null): number | null { return a == null || b == null || b === 0 ? null : a / b; }
function percent(a: number | null, b: number | null): number | null { const value = ratio(a, b); return value == null ? null : value * 100; }
function growth(a: number | null, b: number | null): number | null { return a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100; }
function difference(a: number | null, b: number | null): number | null { return a == null || b == null ? null : a - b; }
function multiple(a: number | null, b: number | null): number | null { return a == null || b == null || b <= 0 ? null : a / b; }

async function fetchSecTickers(): Promise<Record<string, SecTicker>> {
  if (tickerCache && tickerCache.expiresAt > Date.now()) return tickerCache.value;
  const value = await fetchSecJson<Record<string, SecTicker>>(tickerEndpoint);
  tickerCache = { value, expiresAt: Date.now() + cacheLifetimeMs };
  return value;
}

async function fetchSecJson<T>(endpoint: string): Promise<T> {
  const response = await fetch(endpoint, { headers: { Accept: "application/json", "User-Agent": secUserAgent }, signal: AbortSignal.timeout(18_000) });
  if (!response.ok) throw new Error(`SEC 数据服务请求失败：HTTP ${response.status}`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxResponseBytes) throw new Error("SEC 数据响应超过安全上限");
  try { return JSON.parse(body) as T; } catch { throw new Error("SEC 数据服务返回了异常内容"); }
}
