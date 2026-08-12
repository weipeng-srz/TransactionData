import { parseCsvRecords } from "./csv.ts";

export type StockHolding = {
  code: string;
  shares: number;
  cost: number;
  updatedAt: string;
};

export type StockHoldings = Record<string, StockHolding>;

export type HoldingMetrics = {
  costValue: number;
  marketValue: number;
  profit: number;
  profitPct: number;
};

export type HoldingImportStock = {
  code: string;
  name: string;
};

export type HoldingsCsvImport = {
  holdings: StockHoldings;
  stocks: HoldingImportStock[];
};

const maxHoldings = 200;
const maxShares = 1_000_000_000_000;
const maxCost = 1_000_000_000;

export function parseHoldings(value: unknown): StockHoldings {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];
  const holdings: StockHoldings = {};

  for (const candidate of candidates.slice(0, maxHoldings)) {
    const holding = normalizeHolding(candidate);
    if (holding) holdings[holding.code] = holding;
  }
  return holdings;
}

export function normalizeHolding(value: unknown): StockHolding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StockHolding>;
  const code = String(candidate.code ?? "").trim();
  const shares = Number(candidate.shares);
  const cost = Number(candidate.cost);
  const updatedAt = String(candidate.updatedAt ?? "");
  if (
    !/^\d{6}$/.test(code)
    || !Number.isInteger(shares)
    || shares <= 0
    || shares > maxShares
    || !Number.isFinite(cost)
    || cost <= 0
    || cost > maxCost
    || Number.isNaN(Date.parse(updatedAt))
  ) return null;
  return { code, shares, cost, updatedAt };
}

export function exportHoldingsCsv(
  holdings: StockHoldings,
  stocks: Array<{ code: string; name: string }>,
): string {
  const names = new Map(stocks.map((stock) => [stock.code, stock.name]));
  const rows = Object.values(holdings)
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((holding) => [
      holding.code,
      names.get(holding.code) ?? "",
      String(holding.shares),
      String(holding.cost),
    ]);
  return `\uFEFF${[
    ["股票代码", "股票名称", "持股数量", "平均成本价"],
    ...rows,
  ].map((row) => row.map(escapeCsvField).join(",")).join("\r\n")}\r\n`;
}

export function parseHoldingsCsv(content: string, updatedAt = new Date().toISOString()): HoldingsCsvImport {
  const records = parseCsvRecords(content).filter((record) => record.some((field) => field.trim()));
  if (!records.length) throw new Error("CSV 文件为空");
  if (records.length - 1 > maxHoldings) throw new Error(`CSV 最多支持 ${maxHoldings} 条持仓记录`);
  const headers = records[0].map((field) => field.replace(/^\uFEFF/, "").trim());
  const indexes = {
    code: findHeader(headers, ["股票代码", "代码", "code"]),
    name: findHeader(headers, ["股票名称", "名称", "name"]),
    shares: findHeader(headers, ["持股数量", "持有股数", "股数", "shares"]),
    cost: findHeader(headers, ["平均成本价", "平均成本", "成本价", "成本", "cost"]),
  };
  if (Object.values(indexes).some((index) => index < 0)) {
    throw new Error("CSV 表头需包含：股票代码、股票名称、持股数量、平均成本价");
  }
  const holdings: StockHoldings = {};
  const stocks: HoldingImportStock[] = [];
  const seen = new Set<string>();
  records.slice(1).forEach((record, index) => {
    const line = index + 2;
    const rawCode = String(record[indexes.code] ?? "").trim();
    const code = /^\d{1,6}$/.test(rawCode) ? rawCode.padStart(6, "0") : rawCode;
    const name = String(record[indexes.name] ?? "").trim();
    const shares = Number(String(record[indexes.shares] ?? "").replace(/,/g, "").trim());
    const cost = Number(String(record[indexes.cost] ?? "").replace(/[¥￥,]/g, "").trim());
    if (!/^\d{6}$/.test(code)) throw new Error(`第 ${line} 行股票代码必须是 6 位数字`);
    if (!name || name.length > 40) throw new Error(`第 ${line} 行股票名称不能为空且不能超过 40 个字符`);
    if (seen.has(code)) throw new Error(`第 ${line} 行股票代码 ${code} 重复`);
    const holding = normalizeHolding({ code, shares, cost, updatedAt });
    if (!holding) throw new Error(`第 ${line} 行的持股数量或平均成本价无效`);
    seen.add(code);
    holdings[code] = holding;
    stocks.push({ code, name });
  });
  if (!stocks.length) throw new Error("CSV 中没有可导入的持仓记录");
  return { holdings, stocks };
}

export function calculateHoldingMetrics(
  shares: number,
  cost: number,
  currentPrice: number | null | undefined,
): HoldingMetrics | null {
  if (
    !Number.isInteger(shares)
    || shares <= 0
    || !Number.isFinite(cost)
    || cost <= 0
    || currentPrice == null
    || !Number.isFinite(currentPrice)
    || currentPrice < 0
  ) return null;
  const costValue = shares * cost;
  const marketValue = shares * currentPrice;
  const profit = marketValue - costValue;
  return {
    costValue,
    marketValue,
    profit,
    profitPct: costValue === 0 ? 0 : (profit / costValue) * 100,
  };
}

function findHeader(headers: string[], candidates: string[]): number {
  const normalizedCandidates = candidates.map((value) => value.toLowerCase());
  return headers.findIndex((header) => normalizedCandidates.includes(header.toLowerCase()));
}

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
