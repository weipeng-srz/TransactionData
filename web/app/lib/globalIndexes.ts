import { parseUSMarketResponse, US_INDEXES, US_QUOTE_SYMBOLS, type USIndexSessionQuote } from "./usMarketIndexes.ts";

const quoteEndpoint = "https://hq.sinajs.cn/list=";
const maxResponseBytes = 512 * 1024;

export type GlobalRegion = "美洲" | "欧洲" | "亚太" | "A股";

export type GlobalIndexDefinition = {
  id: string;
  symbol: string;
  code: string;
  name: string;
  city: string;
  country: string;
  region: GlobalRegion;
  timezone: string;
  session: { open: string; close: string; breakStart?: string; breakEnd?: string };
  map?: { x: number; y: number; anchor: "top" | "right" | "bottom" | "left" };
};

export type GlobalIndexQuote = Omit<GlobalIndexDefinition, "session" | "map"> & {
  price: number;
  change: number;
  changePct: number;
  date: string;
  time: string;
  marketStatus: string;
  map?: GlobalIndexDefinition["map"];
};

export type GlobalIndexFeed = {
  quotes: GlobalIndexQuote[];
  usQuotes: USIndexSessionQuote[];
  source: string;
  fetchedAt: string;
};

export const GLOBAL_INDEXES: GlobalIndexDefinition[] = [
  { id: "tsx", symbol: "b_GSPTSE", code: "GSPTSE", name: "加拿大 S&P/TSX", city: "多伦多", country: "加拿大", region: "美洲", timezone: "America/Toronto", session: { open: "09:30", close: "16:00" }, map: { x: 19, y: 27, anchor: "top" } },
  { id: "bovespa", symbol: "b_IBOV", code: "IBOV", name: "巴西 BOVESPA", city: "圣保罗", country: "巴西", region: "美洲", timezone: "America/Sao_Paulo", session: { open: "10:00", close: "17:55" }, map: { x: 35, y: 72, anchor: "right" } },
  { id: "ftse", symbol: "b_FTSE", code: "FTSE", name: "英国富时 100", city: "伦敦", country: "英国", region: "欧洲", timezone: "Europe/London", session: { open: "08:00", close: "16:30" }, map: { x: 46, y: 29, anchor: "left" } },
  { id: "dax", symbol: "b_DAX", code: "GDAXI", name: "德国 DAX", city: "法兰克福", country: "德国", region: "欧洲", timezone: "Europe/Berlin", session: { open: "09:00", close: "17:30" }, map: { x: 52, y: 29, anchor: "top" } },
  { id: "cac", symbol: "b_CAC", code: "FCHI", name: "法国 CAC 40", city: "巴黎", country: "法国", region: "欧洲", timezone: "Europe/Paris", session: { open: "09:00", close: "17:30" }, map: { x: 49, y: 39, anchor: "bottom" } },
  { id: "sensex", symbol: "b_SENSEX", code: "SENSEX", name: "印度 SENSEX", city: "孟买", country: "印度", region: "亚太", timezone: "Asia/Kolkata", session: { open: "09:15", close: "15:30" }, map: { x: 68, y: 57, anchor: "left" } },
  { id: "shanghai", symbol: "s_sh000001", code: "000001", name: "上证指数", city: "上海", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" }, map: { x: 80, y: 43, anchor: "left" } },
  { id: "csi300", symbol: "s_sh000300", code: "000300", name: "沪深 300", city: "沪深", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "szse", symbol: "s_sz399001", code: "399001", name: "深证成指", city: "深圳", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "chinext", symbol: "s_sz399006", code: "399006", name: "创业板指", city: "深圳", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "star50", symbol: "s_sh000688", code: "000688", name: "科创 50", city: "上海", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "sse50", symbol: "s_sh000016", code: "000016", name: "上证 50", city: "上海", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "csi500", symbol: "s_sh000905", code: "000905", name: "中证 500", city: "沪深", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "csi1000", symbol: "s_sh000852", code: "000852", name: "中证 1000", city: "沪深", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "bse50", symbol: "s_bj899050", code: "899050", name: "北证 50", city: "北京", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "hsi", symbol: "b_HSI", code: "HSI", name: "恒生指数", city: "香港", country: "中国香港", region: "亚太", timezone: "Asia/Hong_Kong", session: { open: "09:30", close: "16:00", breakStart: "12:00", breakEnd: "13:00" }, map: { x: 79, y: 56, anchor: "bottom" } },
  { id: "nikkei", symbol: "b_NKY", code: "N225", name: "日经 225", city: "东京", country: "日本", region: "亚太", timezone: "Asia/Tokyo", session: { open: "09:00", close: "15:30", breakStart: "11:30", breakEnd: "12:30" }, map: { x: 91, y: 38, anchor: "right" } },
  { id: "kospi", symbol: "b_KOSPI", code: "KS11", name: "韩国 KOSPI", city: "首尔", country: "韩国", region: "亚太", timezone: "Asia/Seoul", session: { open: "09:00", close: "15:30" }, map: { x: 85, y: 31, anchor: "top" } },
  { id: "sti", symbol: "b_STI", code: "STI", name: "新加坡海峡时报", city: "新加坡", country: "新加坡", region: "亚太", timezone: "Asia/Singapore", session: { open: "09:00", close: "17:00", breakStart: "12:00", breakEnd: "13:00" }, map: { x: 78, y: 70, anchor: "left" } },
  { id: "asx", symbol: "b_AS30", code: "AS30", name: "澳大利亚 ASX 200", city: "悉尼", country: "澳大利亚", region: "亚太", timezone: "Australia/Sydney", session: { open: "10:00", close: "16:00" }, map: { x: 91, y: 81, anchor: "right" } },
];

export async function fetchGlobalIndexFeed(now = new Date()): Promise<GlobalIndexFeed> {
  const symbols = [...GLOBAL_INDEXES.map((item) => item.symbol), ...US_QUOTE_SYMBOLS].join(",");
  const body = await fetchQuoteText(`${quoteEndpoint}${symbols}`);
  const quotes = parseGlobalIndexResponse(body, now);
  const usQuotes = parseUSMarketResponse(body, now);
  if (quotes.length < Math.ceil(GLOBAL_INDEXES.length / 2)) throw new Error("全球行情服务暂未返回足够的有效指数");
  if (usQuotes.length < Math.ceil(US_INDEXES.length / 2)) throw new Error("美股现货与延长时段行情暂不可用");
  return { quotes, usQuotes, source: "新浪财经全球指数、ETF 延长时段与指数期货 HTTPS 行情", fetchedAt: now.toISOString() };
}

export function parseGlobalIndexResponse(body: string, now = new Date()): GlobalIndexQuote[] {
  const payloads = new Map<string, string>();
  const pattern = /var hq_str_([\w]+)="([\s\S]*?)";/g;
  for (const match of body.matchAll(pattern)) payloads.set(match[1], match[2]);

  return GLOBAL_INDEXES.flatMap((definition) => {
    const payload = payloads.get(definition.symbol);
    if (!payload) return [];
    const fields = payload.split(",").map((item) => item.trim());
    const price = finiteNumber(fields[1]);
    const change = finiteNumber(fields[2]);
    const changePct = finiteNumber(fields[3]);
    if (price == null || price <= 0 || change == null || changePct == null) return [];
    const date = fields.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item)).at(-1) ?? zonedDate(now, definition.timezone);
    const time = fields.filter((item) => /^\d{2}:\d{2}(?::\d{2})?$/.test(item)).at(-1) ?? zonedTime(now, definition.timezone);
    return [{
      id: definition.id,
      symbol: definition.symbol,
      code: definition.code,
      name: definition.name,
      city: definition.city,
      country: definition.country,
      region: definition.region,
      timezone: definition.timezone,
      price,
      change,
      changePct,
      date,
      time,
      marketStatus: resolveMarketStatus(definition, now),
      map: definition.map,
    }];
  });
}

function resolveMarketStatus(definition: GlobalIndexDefinition, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: definition.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((item) => item.type === "weekday")?.value ?? "";
  const hour = parts.find((item) => item.type === "hour")?.value ?? "00";
  const minute = parts.find((item) => item.type === "minute")?.value ?? "00";
  const clock = `${hour}:${minute}`;
  if (weekday === "Sat" || weekday === "Sun") return "周末休市";
  if (definition.session.breakStart && definition.session.breakEnd && clock >= definition.session.breakStart && clock < definition.session.breakEnd) return "午间休市";
  if (clock >= definition.session.open && clock < definition.session.close) return "交易中";
  if (clock < definition.session.open) return "等待开盘";
  return "已收盘";
}

async function fetchQuoteText(endpoint: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      cache: "no-store",
      headers: { Accept: "*/*", "Cache-Control": "no-cache", Referer: "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0 (compatible; TickLens/2.0)" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (reason) {
    throw new Error(`全球行情网络请求失败：${reason instanceof Error ? reason.message : "连接异常"}`);
  }
  if (!response.ok) throw new Error(`全球行情服务请求失败：HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxResponseBytes) throw new Error("全球行情响应超过安全上限");
  try { return new TextDecoder("gbk").decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

function zonedDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function zonedTime(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(value);
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
