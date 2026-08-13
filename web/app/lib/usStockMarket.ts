import { isUSStockSymbol, normalizeUSSymbol } from "./security.ts";
import { lookupUSStock } from "./usStockLookup.ts";

const dailyEndpoint = "https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20_trendsight=/US_MinKService.getDailyK";
const maxResponseBytes = 12 * 1024 * 1024;

export type USDailyRow = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
};

export function normalizeUSMarketRequest(value: unknown): { code: string; days: number } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const input = value as { code?: unknown; days?: unknown };
  const code = normalizeUSSymbol(input.code);
  const days = input.days == null ? 180 : Number(input.days);
  if (!isUSStockSymbol(code)) throw new Error("请输入有效的美股代码，例如 AAPL 或 BRK.B");
  if (!Number.isInteger(days) || days < 20 || days > 1250) throw new Error("交易日数量必须在 20 到 1250 之间");
  return { code, days };
}

export function parseUSDailyResponse(body: string): USDailyRow[] {
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("美股日线服务返回了异常内容");
  let value: unknown;
  try {
    value = JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error("美股日线数据无法解析");
  }
  return (Array.isArray(value) ? value : []).flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const date = String(item.d ?? "").slice(0, 10);
    const open = positiveNumber(item.o);
    const high = positiveNumber(item.h);
    const low = positiveNumber(item.l);
    const close = positiveNumber(item.c);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !open || !high || !low || !close) return [];
    const volume = nonNegativeNumber(item.v);
    return [{ date, open, high, low, close, volume, amount: nonNegativeNumber(item.a) || close * volume }];
  });
}

export async function fetchUSDailyRows(code: string, days = 180): Promise<USDailyRow[]> {
  const request = normalizeUSMarketRequest({ code, days });
  const url = new URL(dailyEndpoint);
  url.searchParams.set("symbol", request.code);
  url.searchParams.set("___qn", "3");
  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      Referer: "https://finance.sina.com.cn/stock/usstock/",
      "User-Agent": "Mozilla/5.0 (compatible; TrendSight/2.0)",
    },
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`美股日线服务请求失败：HTTP ${response.status}`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxResponseBytes) throw new Error("美股日线响应超过安全上限");
  const rows = parseUSDailyResponse(body).slice(-request.days);
  if (!rows.length) throw new Error("美股日线服务未返回可用数据");
  return rows;
}

export async function fetchUSMarketCsv(input: unknown): Promise<string> {
  const { code, days } = normalizeUSMarketRequest(input);
  const [rows, identity] = await Promise.all([
    fetchUSDailyRows(code, days),
    lookupUSStock(code).catch(() => ({ code, name: code, market: "US" as const, currency: "USD" as const })),
  ]);
  const fetchedAt = new Date().toLocaleString("sv-SE", { timeZone: "America/New_York", hour12: false }).replace("T", " ");
  const metadata = [
    `股票代码=${code}`,
    `股票名称=${identity.name}`,
    "市场=US",
    "币种=USD",
    "时区=America/New_York",
    "价格口径=新浪美股日K",
    "成交数据级别=日K聚合",
    "成交时间精度=日线拆分展示",
    `数据截止=${rows.at(-1)?.date ?? ""}`,
    `采集时间=${fetchedAt}`,
  ];
  const header = ["交易日期", "成交时间", "股票代码", "股票名称", "性质", "成交价格(元)", "成交量(股)", "成交金额(元)", "前复权成交价格(元)", "前复权因子", "交易时段", "数据级别"];
  const sessions = [
    { time: "09:30:00", price: (row: USDailyRow) => row.open, share: 0.18 },
    { time: "11:00:00", price: (row: USDailyRow) => row.low, share: 0.27 },
    { time: "14:00:00", price: (row: USDailyRow) => row.high, share: 0.27 },
    { time: "16:00:00", price: (row: USDailyRow) => row.close, share: 0.28 },
  ];
  const records = rows.flatMap((row) => sessions.map((session) => {
    const price = session.price(row);
    const volume = Math.round(row.volume * session.share);
    return [row.date, session.time, code, identity.name, "中性盘", price.toFixed(4), String(volume), (price * volume).toFixed(2), price.toFixed(4), "1", "美股常规交易", "日K聚合"];
  }));
  return `\uFEFF${[
    ["#META", ...metadata],
    header,
    ...records,
  ].map((row) => row.map(csvCell).join(",")).join("\n")}`;
}

function positiveNumber(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function nonNegativeNumber(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
function csvCell(value: string): string { const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe; }
