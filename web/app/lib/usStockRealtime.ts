import type { RealtimeSnapshot } from "./realtimeMarket.ts";
import { isUSStockSymbol, normalizeUSSymbol } from "./security.ts";
import { fetchUSDailyRows } from "./usStockMarket.ts";
import { lookupUSStock } from "./usStockLookup.ts";

const quoteEndpoint = "https://hq.sinajs.cn/list=gb_";
const maxResponseBytes = 512 * 1024;
const activeRequests = new Map<string, Promise<RealtimeSnapshot>>();

export function normalizeUSRealtimeRequest(value: unknown): { code: string } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const code = normalizeUSSymbol((value as { code?: unknown }).code);
  if (!isUSStockSymbol(code)) throw new Error("请输入有效的美股代码，例如 AAPL 或 BRK.B");
  return { code };
}

export function parseUSQuoteResponse(body: string, code: string): RealtimeSnapshot {
  const match = body.match(/="([\s\S]*)";?\s*$/);
  if (!match || !match[1].trim()) throw new Error("美股报价服务暂未返回该证券的数据");
  const fields = match[1].split(",");
  if (fields.length < 27) throw new Error("美股报价字段不完整");
  const price = positiveNumber(fields[1]);
  const previousClose = positiveNumber(fields[26]) || price - finiteNumber(fields[4]);
  if (!price || !previousClose) throw new Error("美股报价暂未返回有效价格");
  const timestamp = String(fields[3] ?? "").trim();
  const date = timestamp.slice(0, 10);
  const time = timestamp.slice(11, 19);
  const volume = nonNegativeNumber(fields[10]);
  return {
    code: normalizeUSSymbol(code),
    name: String(fields[0] ?? "").trim() || normalizeUSSymbol(code),
    date,
    time,
    marketStatus: usMarketStatus(date, time),
    price,
    previousClose,
    open: positiveNumber(fields[5]) || price,
    high: positiveNumber(fields[6]) || price,
    low: positiveNumber(fields[7]) || price,
    change: finiteNumber(fields[4]) || price - previousClose,
    changePct: finiteNumber(fields[2]) || ((price / previousClose) - 1) * 100,
    volume,
    amount: volume * price,
    bids: [],
    asks: [],
    minuteCandles: [],
    source: "新浪美股延时报价（不含五档与分钟线）",
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchUSRealtimeSnapshot(code: string): Promise<RealtimeSnapshot> {
  const normalized = normalizeUSRealtimeRequest({ code }).code;
  const pending = activeRequests.get(normalized);
  if (pending) return pending;
  const request = fetchUSRealtimeSnapshotInternal(normalized);
  activeRequests.set(normalized, request);
  try {
    return await request;
  } finally {
    if (activeRequests.get(normalized) === request) activeRequests.delete(normalized);
  }
}

async function fetchUSRealtimeSnapshotInternal(code: string): Promise<RealtimeSnapshot> {
  try {
    const quoteSymbol = code.toLowerCase().replaceAll(".", "$");
    const response = await fetch(`${quoteEndpoint}${quoteSymbol}`, {
      cache: "no-store",
      headers: {
        Accept: "*/*",
        Referer: "https://finance.sina.com.cn/stock/usstock/",
        "User-Agent": "Mozilla/5.0 (compatible; TrendSight/2.0)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxResponseBytes) throw new Error("响应超过安全上限");
    return parseUSQuoteResponse(decodeText(bytes, "gbk"), code);
  } catch (quoteReason) {
    try {
      return await fallbackFromDaily(code);
    } catch (dailyReason) {
      throw new Error(`美股报价服务不可用：报价源 ${errorMessage(quoteReason)}；日线备用源 ${errorMessage(dailyReason)}`);
    }
  }
}

async function fallbackFromDaily(code: string): Promise<RealtimeSnapshot> {
  const [rows, identity] = await Promise.all([
    fetchUSDailyRows(code, 20),
    lookupUSStock(code).catch(() => ({ code, name: code, market: "US" as const, currency: "USD" as const })),
  ]);
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  if (!latest) throw new Error("没有最近交易日数据");
  const previousClose = previous?.close ?? latest.open;
  return {
    code,
    name: identity.name,
    date: latest.date,
    time: "16:00:00",
    marketStatus: usMarketStatus(latest.date, "16:00:00"),
    price: latest.close,
    previousClose,
    open: latest.open,
    high: latest.high,
    low: latest.low,
    change: latest.close - previousClose,
    changePct: previousClose ? ((latest.close / previousClose) - 1) * 100 : 0,
    volume: latest.volume,
    amount: latest.amount,
    bids: [],
    asks: [],
    minuteCandles: [],
    source: "新浪美股日K备用收盘价（不含五档与分钟线）",
    fetchedAt: new Date().toISOString(),
  };
}

export function usMarketStatus(date: string, time: string): string {
  const current = new Date().toLocaleString("sv-SE", { timeZone: "America/New_York", hour12: false });
  const currentDate = current.slice(0, 10);
  const currentTime = current.slice(11, 19);
  const referenceDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : currentDate;
  const referenceTime = /^\d{2}:\d{2}/.test(time) ? time : currentTime;
  if (referenceDate !== currentDate) return "已收盘";
  const weekday = new Date(`${currentDate}T12:00:00-04:00`).getUTCDay();
  if (weekday === 0 || weekday === 6) return "休市";
  if (referenceTime < "09:30:00") return referenceTime >= "04:00:00" ? "盘前" : "休市";
  if (referenceTime < "16:00:00") return "交易中";
  if (referenceTime < "20:00:00") return "盘后";
  return "已收盘";
}

function decodeText(bytes: ArrayBuffer, encoding: "gbk" | "utf-8"): string { try { return new TextDecoder(encoding).decode(bytes); } catch { return new TextDecoder().decode(bytes); } }
function positiveNumber(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function nonNegativeNumber(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
function finiteNumber(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : "连接异常"; }
