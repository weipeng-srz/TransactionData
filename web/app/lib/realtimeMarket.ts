const minuteEndpoint = "https://quotes.sina.cn/cn/api/jsonp_v2.php/ticklens=/CN_MarketDataService.getKLineData";
const quoteEndpoint = "https://hq.sinajs.cn/list=";
const tencentQuoteEndpoint = "https://qt.gtimg.cn/q=";
const eastmoneyMinuteEndpoint = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const maxResponseBytes = 2 * 1024 * 1024;
const sinaRateLimitCooldownMs = 60_000;
const realtimeRequests = new Map<string, Promise<RealtimeSnapshot>>();
let sinaUnavailableUntil = 0;

export type RealtimeMinuteCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
};

export type OrderBookLevel = { level: number; price: number; volume: number };

export type RealtimeSnapshot = {
  code: string;
  name: string;
  date: string;
  time: string;
  marketStatus: string;
  price: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number;
  amount: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  minuteCandles: RealtimeMinuteCandle[];
  source: string;
  fetchedAt: string;
};

type QuoteData = Omit<RealtimeSnapshot, "code" | "marketStatus" | "minuteCandles" | "source" | "fetchedAt">;

export function normalizeRealtimeRequest(value: unknown): { code: string } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const rawCode = String((value as { code?: unknown }).code ?? "").trim();
  const code = rawCode.replace(/^(?:sh|sz)/i, "").replace(/\.(?:sh|sz)$/i, "");
  if (!/^\d{6}$/.test(code)) throw new Error("请输入有效的 6 位沪深 A 股代码");
  return { code };
}

export async function fetchRealtimeSnapshot(code: string): Promise<RealtimeSnapshot> {
  const normalized = normalizeRealtimeRequest({ code }).code;
  const activeRequest = realtimeRequests.get(normalized);
  if (activeRequest) return activeRequest;

  const request = fetchRealtimeSnapshotWithFallback(normalized);
  realtimeRequests.set(normalized, request);
  try {
    return await request;
  } finally {
    if (realtimeRequests.get(normalized) === request) realtimeRequests.delete(normalized);
  }
}

async function fetchRealtimeSnapshotWithFallback(normalized: string): Promise<RealtimeSnapshot> {
  let primaryError: unknown = new Error("新浪主源正处于限流冷却期");
  if (Date.now() >= sinaUnavailableUntil) {
    try {
      const snapshot = await fetchSinaSnapshot(normalized);
      sinaUnavailableUntil = 0;
      return snapshot;
    } catch (reason) {
      primaryError = reason;
      const message = errorMessage(reason);
      if (/HTTP (?:403|429)\b/.test(message)) sinaUnavailableUntil = Date.now() + sinaRateLimitCooldownMs;
    }
  }

  try {
    return await fetchFallbackSnapshot(normalized);
  } catch (fallbackError) {
    throw new Error(`实时行情主备服务均不可用：主源 ${errorMessage(primaryError)}；备用源 ${errorMessage(fallbackError)}`);
  }
}

async function fetchSinaSnapshot(normalized: string): Promise<RealtimeSnapshot> {
  const symbol = `${/^[569]/.test(normalized) ? "sh" : "sz"}${normalized}`;
  const minuteUrl = new URL(minuteEndpoint);
  minuteUrl.searchParams.set("symbol", symbol);
  minuteUrl.searchParams.set("scale", "1");
  minuteUrl.searchParams.set("ma", "no");
  minuteUrl.searchParams.set("datalen", "480");
  const requestNonce = Date.now().toString();
  minuteUrl.searchParams.set("_", requestNonce);

  const [minuteBody, quoteBody] = await Promise.all([
    fetchText(minuteUrl, "utf-8"),
    fetchText(`${quoteEndpoint}${symbol}`, "gbk"),
  ]);
  const quote = parseQuoteResponse(quoteBody);
  const allMinutes = parseMinuteKlineResponse(minuteBody);
  const latestDate = quote.date || allMinutes.at(-1)?.time.slice(0, 10) || "";
  const minuteCandles = allMinutes
    .filter((item) => item.time.startsWith(latestDate))
    .map((item) => ({ ...item, time: item.time.slice(11, 16) }));
  return {
    code: normalized,
    ...quote,
    marketStatus: marketStatus(quote.date, quote.time),
    minuteCandles,
    source: "新浪 HTTPS 实时行情与五档盘口",
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchFallbackSnapshot(normalized: string): Promise<RealtimeSnapshot> {
  const isShanghai = /^[569]/.test(normalized);
  const symbol = `${isShanghai ? "sh" : "sz"}${normalized}`;
  const minuteUrl = new URL(eastmoneyMinuteEndpoint);
  minuteUrl.searchParams.set("secid", `${isShanghai ? "1" : "0"}.${normalized}`);
  minuteUrl.searchParams.set("klt", "1");
  minuteUrl.searchParams.set("fqt", "0");
  minuteUrl.searchParams.set("lmt", "480");
  minuteUrl.searchParams.set("end", "20500101");
  minuteUrl.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  minuteUrl.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  minuteUrl.searchParams.set("_", Date.now().toString());

  const [quoteBody, minuteBody] = await Promise.all([
    fetchProviderText(`${tencentQuoteEndpoint}${symbol}`, "gbk", "https://gu.qq.com/"),
    fetchProviderText(minuteUrl, "utf-8", "https://quote.eastmoney.com/"),
  ]);
  const quote = parseTencentQuoteResponse(quoteBody);
  const allMinutes = parseEastmoneyMinuteResponse(minuteBody);
  if (!allMinutes.length) throw new Error("分钟行情没有返回可用数据");
  const latestDate = quote.date || allMinutes.at(-1)?.time.slice(0, 10) || "";
  const minuteCandles = allMinutes
    .filter((item) => item.time.startsWith(latestDate))
    .map((item) => ({ ...item, time: item.time.slice(11, 16) }));
  return {
    code: normalized,
    ...quote,
    date: latestDate,
    marketStatus: marketStatus(latestDate, quote.time),
    minuteCandles,
    source: "腾讯 HTTPS 实时盘口 + 东方财富分钟行情（新浪主源自动降级）",
    fetchedAt: new Date().toISOString(),
  };
}

export function parseQuoteResponse(body: string): QuoteData {
  const match = body.match(/="([\s\S]*)";?\s*$/);
  if (!match) throw new Error("实时盘口服务返回了异常内容");
  const fields = match[1].split(",");
  if (fields.length < 32) throw new Error("实时盘口字段不完整");
  const previousClose = positiveNumber(fields[2]);
  const current = positiveNumber(fields[3]) || positiveNumber(fields[1]) || previousClose;
  if (!current || !previousClose) throw new Error("实时盘口暂未返回有效价格");
  const bids = Array.from({ length: 5 }, (_, index) => ({ level: index + 1, volume: nonNegativeNumber(fields[10 + index * 2]), price: nonNegativeNumber(fields[11 + index * 2]) }));
  const asks = Array.from({ length: 5 }, (_, index) => ({ level: index + 1, volume: nonNegativeNumber(fields[20 + index * 2]), price: nonNegativeNumber(fields[21 + index * 2]) }));
  return {
    name: String(fields[0] ?? "").trim(),
    date: String(fields[30] ?? "").trim(),
    time: String(fields[31] ?? "").trim(),
    price: current,
    previousClose,
    open: positiveNumber(fields[1]) || current,
    high: positiveNumber(fields[4]) || current,
    low: positiveNumber(fields[5]) || current,
    change: current - previousClose,
    changePct: ((current / previousClose) - 1) * 100,
    volume: nonNegativeNumber(fields[8]),
    amount: nonNegativeNumber(fields[9]),
    bids,
    asks,
  };
}

export function parseTencentQuoteResponse(body: string): QuoteData {
  const match = body.match(/="([\s\S]*)";?\s*$/);
  if (!match) throw new Error("备用实时盘口服务返回了异常内容");
  const fields = match[1].split("~");
  if (fields.length < 36) throw new Error("备用实时盘口字段不完整");
  const previousClose = positiveNumber(fields[4]);
  const current = positiveNumber(fields[3]) || positiveNumber(fields[5]) || previousClose;
  if (!current || !previousClose) throw new Error("备用实时盘口暂未返回有效价格");
  const timestamp = String(fields[30] ?? "").trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  const bids = Array.from({ length: 5 }, (_, index) => ({
    level: index + 1,
    price: nonNegativeNumber(fields[9 + index * 2]),
    volume: nonNegativeNumber(fields[10 + index * 2]) * 100,
  }));
  const asks = Array.from({ length: 5 }, (_, index) => ({
    level: index + 1,
    price: nonNegativeNumber(fields[19 + index * 2]),
    volume: nonNegativeNumber(fields[20 + index * 2]) * 100,
  }));
  const amountParts = String(fields[35] ?? "").split("/");
  const amount = nonNegativeNumber(amountParts[2]) || nonNegativeNumber(fields[37]) * 10_000;
  return {
    name: String(fields[1] ?? "").trim(),
    date: timestamp ? `${timestamp[1]}-${timestamp[2]}-${timestamp[3]}` : "",
    time: timestamp ? `${timestamp[4]}:${timestamp[5]}:${timestamp[6]}` : "",
    price: current,
    previousClose,
    open: positiveNumber(fields[5]) || current,
    high: positiveNumber(fields[33]) || current,
    low: positiveNumber(fields[34]) || current,
    change: current - previousClose,
    changePct: ((current / previousClose) - 1) * 100,
    volume: nonNegativeNumber(fields[6]) * 100,
    amount,
    bids,
    asks,
  };
}

export function parseMinuteKlineResponse(body: string): RealtimeMinuteCandle[] {
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("分钟行情服务返回了异常内容");
  let value: unknown;
  try { value = JSON.parse(body.slice(start, end + 1)); } catch { throw new Error("分钟行情数据无法解析"); }
  return (Array.isArray(value) ? value : []).flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const time = String(item.day ?? "");
    const open = positiveNumber(item.open);
    const high = positiveNumber(item.high);
    const low = positiveNumber(item.low);
    const close = positiveNumber(item.close);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time) || !open || !high || !low || !close) return [];
    return [{ time, open, high, low, close, volume: nonNegativeNumber(item.volume), amount: nonNegativeNumber(item.amount) }];
  });
}

export function parseEastmoneyMinuteResponse(body: string): RealtimeMinuteCandle[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("备用分钟行情数据无法解析");
  }
  const data = (payload as { data?: { klines?: unknown } } | null)?.data;
  if (!Array.isArray(data?.klines)) throw new Error("备用分钟行情服务返回了异常内容");
  return data.klines.flatMap((raw) => {
    const fields = String(raw).split(",");
    const time = String(fields[0] ?? "");
    const open = positiveNumber(fields[1]);
    const close = positiveNumber(fields[2]);
    const high = positiveNumber(fields[3]);
    const low = positiveNumber(fields[4]);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(time) || !open || !high || !low || !close) return [];
    return [{
      time: `${time}:00`,
      open,
      high,
      low,
      close,
      volume: nonNegativeNumber(fields[5]) * 100,
      amount: nonNegativeNumber(fields[6]),
    }];
  });
}

async function fetchText(endpoint: string | URL, encoding: "utf-8" | "gbk"): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        Accept: "*/*",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: "https://finance.sina.com.cn/",
        "User-Agent": "Mozilla/5.0 (compatible; TickLens/2.0)",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (reason) {
    throw new Error(`实时行情网络请求失败：${reason instanceof Error ? reason.message : "连接异常"}`);
  }
  if (!response.ok) throw new Error(`实时行情服务请求失败：HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxResponseBytes) throw new Error("实时行情响应超过安全上限");
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    // Some edge runtimes only expose UTF-8. The quote's numeric fields remain
    // ASCII-safe even when the optional Chinese name cannot be decoded as GBK.
    return new TextDecoder().decode(bytes);
  }
}

async function fetchProviderText(endpoint: string | URL, encoding: "utf-8" | "gbk", referer: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        Accept: "*/*",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: referer,
        "User-Agent": "Mozilla/5.0 (compatible; TickLens/2.0)",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (reason) {
    throw new Error(`备用实时行情网络请求失败：${errorMessage(reason)}`);
  }
  if (!response.ok) throw new Error(`备用实时行情服务请求失败：HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxResponseBytes) throw new Error("备用实时行情响应超过安全上限");
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function marketStatus(date: string, time: string): string {
  const now = new Date();
  const nowDate = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const nowTime = now.toLocaleTimeString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false });
  if (date !== nowDate) return "非交易时段";
  if ((nowTime >= "09:15:00" && nowTime <= "11:30:00") || (nowTime >= "13:00:00" && nowTime <= "15:00:00")) return "交易中";
  if (nowTime > "11:30:00" && nowTime < "13:00:00") return "午间休市";
  if (nowTime > "15:00:00" || time >= "15:00:00") return "已收盘";
  return "等待开盘";
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "未知错误";
}

function positiveNumber(value: unknown): number { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; }
function nonNegativeNumber(value: unknown): number { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
