const minuteEndpoint = "https://quotes.sina.cn/cn/api/jsonp_v2.php/ticklens=/CN_MarketDataService.getKLineData";
const quoteEndpoint = "https://hq.sinajs.cn/list=";
const maxResponseBytes = 2 * 1024 * 1024;

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

export type RealtimePriceQuote = {
  code: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  date: string;
  time: string;
  marketStatus: string;
};

type QuoteData = Omit<RealtimeSnapshot, "code" | "marketStatus" | "minuteCandles" | "source" | "fetchedAt">;

export function normalizeRealtimeRequest(value: unknown): { code: string } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const rawCode = String((value as { code?: unknown }).code ?? "").trim();
  const code = rawCode.replace(/^(?:sh|sz)/i, "").replace(/\.(?:sh|sz)$/i, "");
  if (!/^\d{6}$/.test(code)) throw new Error("请输入有效的 6 位沪深 A 股代码");
  return { code };
}

export function normalizeRealtimePriceRequest(value: unknown): { codes: string[] } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const rawCodes = (value as { codes?: unknown }).codes;
  if (!Array.isArray(rawCodes)) throw new Error("股票代码列表无效");
  const codes = [...new Set(rawCodes.map((code) => normalizeRealtimeRequest({ code }).code))];
  if (!codes.length || codes.length > 30) throw new Error("每次可检查 1 到 30 只沪深 A 股");
  return { codes };
}

export async function fetchRealtimeSnapshot(code: string): Promise<RealtimeSnapshot> {
  const normalized = normalizeRealtimeRequest({ code }).code;
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

export async function fetchRealtimePrices(codes: string[]): Promise<RealtimePriceQuote[]> {
  const normalized = normalizeRealtimePriceRequest({ codes }).codes;
  const symbols = normalized.map((code) => `${/^[569]/.test(code) ? "sh" : "sz"}${code}`);
  const body = await fetchText(`${quoteEndpoint}${symbols.join(",")}`, "gbk");
  return parseQuoteBatchResponse(body);
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

export function parseQuoteBatchResponse(body: string): RealtimePriceQuote[] {
  const quotes: RealtimePriceQuote[] = [];
  const pattern = /var hq_str_(?:sh|sz)(\d{6})="([\s\S]*?)";/g;
  for (const match of body.matchAll(pattern)) {
    if (!match[2]) continue;
    try {
      const quote = parseQuoteResponse(`var hq_str="${match[2]}";`);
      quotes.push({
        code: match[1],
        name: quote.name,
        price: quote.price,
        previousClose: quote.previousClose,
        change: quote.change,
        changePct: quote.changePct,
        date: quote.date,
        time: quote.time,
        marketStatus: marketStatus(quote.date, quote.time),
      });
    } catch {
      // One suspended or unavailable symbol must not discard valid quotes.
    }
  }
  if (!quotes.length) throw new Error("实时行情服务没有返回可用价格");
  return quotes;
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

function positiveNumber(value: unknown): number { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; }
function nonNegativeNumber(value: unknown): number { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
