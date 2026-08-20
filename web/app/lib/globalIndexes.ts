import { parseUSMarketResponse, US_INDEXES, US_QUOTE_SYMBOLS, type USIndexSessionQuote } from "./usMarketIndexes.ts";

const quoteEndpoint = "https://hq.sinajs.cn/list=";
const vixHistoryEndpoint = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv";
const shanghaiHistoryEndpoint = "https://q.stock.sohu.com/hisHq";
const maxResponseBytes = 512 * 1024;
const maxVixHistoryBytes = 1024 * 1024;
const maxShanghaiHistoryBytes = 2 * 1024 * 1024;
const vixHistoryCacheTtlMs = 6 * 60 * 60 * 1000;
const shanghaiHistoryCacheTtlMs = 5 * 60 * 1000;

let vixHistoryCache: { candles: FearGaugeCandle[]; expiresAt: number } | null = null;
let shanghaiHistoryCache: { candles: ShanghaiIndexCandle[]; expiresAt: number } | null = null;

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
  map?: { longitude: number; latitude: number; anchor: "top" | "right" | "bottom" | "left" };
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
  fearGauges: FearGaugeQuote[];
  shanghaiHistory: ShanghaiIndexCandle[];
  source: string;
  fetchedAt: string;
};

export type FearGaugeQuote = {
  id: "a-share-fear" | "us-vix";
  market: "A股" | "美股";
  code: string;
  name: string;
  value: number;
  change: number | null;
  changePct: number | null;
  level: string;
  description: string;
  updatedAt: string;
  source: string;
  official: boolean;
  history: FearGaugeCandle[];
  formula: string;
  components: Array<{ label: string; value: string }>;
  historyPercentile: number | null;
};

export type FearGaugeCandle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ShanghaiIndexCandle = FearGaugeCandle & {
  amountCny: number;
};

export type ShanghaiVolumeState = "放量" | "缩量" | "量能平稳";

export type ShanghaiIndexAnalysis = {
  date: string;
  volumeState: ShanghaiVolumeState;
  amountChangePct: number;
  amountVs5DayPct: number;
  amountVs20DayPct: number;
  priceChangePct: number;
  fiveDayPriceChangePct: number;
  signal: "价涨量增" | "价涨量缩" | "价跌量增" | "价跌量缩" | "量价变化温和";
  headline: string;
  detail: string;
};

export const GLOBAL_INDEXES: GlobalIndexDefinition[] = [
  { id: "tsx", symbol: "b_GSPTSE", code: "GSPTSE", name: "加拿大 S&P/TSX", city: "多伦多", country: "加拿大", region: "美洲", timezone: "America/Toronto", session: { open: "09:30", close: "16:00" }, map: { longitude: -79.3841, latitude: 43.6486, anchor: "top" } },
  { id: "bovespa", symbol: "b_IBOV", code: "IBOV", name: "巴西 BOVESPA", city: "圣保罗", country: "巴西", region: "美洲", timezone: "America/Sao_Paulo", session: { open: "10:00", close: "17:55" }, map: { longitude: -46.6356, latitude: -23.5456, anchor: "right" } },
  { id: "ftse", symbol: "b_FTSE", code: "FTSE", name: "英国富时 100", city: "伦敦", country: "英国", region: "欧洲", timezone: "Europe/London", session: { open: "08:00", close: "16:30" }, map: { longitude: -0.0994, latitude: 51.5151, anchor: "left" } },
  { id: "dax", symbol: "b_DAX", code: "GDAXI", name: "德国 DAX", city: "法兰克福", country: "德国", region: "欧洲", timezone: "Europe/Berlin", session: { open: "09:00", close: "17:30" }, map: { longitude: 8.6777, latitude: 50.1151, anchor: "top" } },
  { id: "cac", symbol: "b_CAC", code: "FCHI", name: "法国 CAC 40", city: "巴黎", country: "法国", region: "欧洲", timezone: "Europe/Paris", session: { open: "09:00", close: "17:30" }, map: { longitude: 2.3522, latitude: 48.8566, anchor: "bottom" } },
  { id: "sensex", symbol: "b_SENSEX", code: "SENSEX", name: "印度 SENSEX", city: "孟买", country: "印度", region: "亚太", timezone: "Asia/Kolkata", session: { open: "09:15", close: "15:30" }, map: { longitude: 72.8777, latitude: 18.9297, anchor: "left" } },
  { id: "shanghai", symbol: "s_sh000001", code: "000001", name: "上证指数", city: "上海", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" }, map: { longitude: 121.475, latitude: 31.2359, anchor: "left" } },
  { id: "csi300", symbol: "s_sh000300", code: "000300", name: "沪深 300", city: "沪深", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "szse", symbol: "s_sz399001", code: "399001", name: "深证成指", city: "深圳", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "chinext", symbol: "s_sz399006", code: "399006", name: "创业板指", city: "深圳", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "star50", symbol: "s_sh000688", code: "000688", name: "科创 50", city: "上海", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "sse50", symbol: "s_sh000016", code: "000016", name: "上证 50", city: "上海", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "csi500", symbol: "s_sh000905", code: "000905", name: "中证 500", city: "沪深", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "csi1000", symbol: "s_sh000852", code: "000852", name: "中证 1000", city: "沪深", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "bse50", symbol: "s_bj899050", code: "899050", name: "北证 50", city: "北京", country: "中国", region: "A股", timezone: "Asia/Shanghai", session: { open: "09:30", close: "15:00", breakStart: "11:30", breakEnd: "13:00" } },
  { id: "hsi", symbol: "b_HSI", code: "HSI", name: "恒生指数", city: "香港", country: "中国香港", region: "亚太", timezone: "Asia/Hong_Kong", session: { open: "09:30", close: "16:00", breakStart: "12:00", breakEnd: "13:00" }, map: { longitude: 114.1589, latitude: 22.2847, anchor: "bottom" } },
  { id: "nikkei", symbol: "b_NKY", code: "N225", name: "日经 225", city: "东京", country: "日本", region: "亚太", timezone: "Asia/Tokyo", session: { open: "09:00", close: "15:30", breakStart: "11:30", breakEnd: "12:30" }, map: { longitude: 139.7777, latitude: 35.6827, anchor: "right" } },
  { id: "kospi", symbol: "b_KOSPI", code: "KS11", name: "韩国 KOSPI", city: "首尔", country: "韩国", region: "亚太", timezone: "Asia/Seoul", session: { open: "09:00", close: "15:30" }, map: { longitude: 126.924, latitude: 37.5234, anchor: "top" } },
  { id: "sti", symbol: "b_STI", code: "STI", name: "新加坡海峡时报", city: "新加坡", country: "新加坡", region: "亚太", timezone: "Asia/Singapore", session: { open: "09:00", close: "17:00", breakStart: "12:00", breakEnd: "13:00" }, map: { longitude: 103.8507, latitude: 1.2791, anchor: "left" } },
  { id: "asx", symbol: "b_AS30", code: "AS30", name: "澳大利亚 ASX 200", city: "悉尼", country: "澳大利亚", region: "亚太", timezone: "Australia/Sydney", session: { open: "10:00", close: "16:00" }, map: { longitude: 151.2094, latitude: -33.8648, anchor: "right" } },
];

export async function fetchGlobalIndexFeed(now = new Date()): Promise<GlobalIndexFeed> {
  const symbols = [...new Set([...GLOBAL_INDEXES.map((item) => item.symbol), ...US_QUOTE_SYMBOLS, "b_VIX"])].join(",");
  const [body, vixHistory, shanghaiHistory] = await Promise.all([
    fetchQuoteText(`${quoteEndpoint}${symbols}`),
    fetchVixHistory(),
    fetchShanghaiIndexHistory(now),
  ]);
  const quotes = parseGlobalIndexResponse(body, now);
  const usQuotes = parseUSMarketResponse(body, now);
  const fearGauges = parseFearGaugeQuotes(body, quotes, now, vixHistory);
  if (quotes.length < Math.ceil(GLOBAL_INDEXES.length / 2)) throw new Error("全球行情服务暂未返回足够的有效指数");
  if (usQuotes.length < Math.ceil(US_INDEXES.length / 2)) throw new Error("美股现货与延长时段行情暂不可用");
  return { quotes, usQuotes, fearGauges, shanghaiHistory, source: "新浪财经全球指数、搜狐财经上证与深证综指历史日线、CBOE VIX、ETF 延长时段与指数期货 HTTPS 行情", fetchedAt: now.toISOString() };
}

export function parseFearGaugeQuotes(body: string, quotes: GlobalIndexQuote[], now = new Date(), vixHistory: FearGaugeCandle[] = []): FearGaugeQuote[] {
  const gauges: FearGaugeQuote[] = [];
  const vixPayload = body.match(/var hq_str_b_VIX="([\s\S]*?)";/)?.[1];
  if (vixPayload) {
    const fields = vixPayload.split(",").map((item) => item.trim());
    const value = finiteNumber(fields[1]);
    const change = finiteNumber(fields[2]);
    const changePct = finiteNumber(fields[3]);
    if (value != null && value > 0) {
      const date = fields.find((item) => /^\d{4}-\d{2}-\d{2}$/.test(item)) ?? zonedDate(now, "America/New_York");
      const time = fields.find((item) => /^\d{2}:\d{2}(?::\d{2})?$/.test(item)) ?? zonedTime(now, "America/New_York");
      gauges.push({
        id: "us-vix",
        market: "美股",
        code: "VIX",
        name: "CBOE VIX 恐慌指数",
        value,
        change,
        changePct,
        level: fearLevel(value),
        description: "基于标普 500 期权隐含波动率，数值越高表示市场预期波动越大。",
        updatedAt: `${date} ${time}`,
        source: "CBOE VIX · 延时行情",
        official: true,
        history: vixHistory.slice(-160),
        formula: "CBOE 基于标普 500 期权报价计算的 30 天预期波动率指数",
        components: [{ label: "当日涨跌", value: changePct == null ? "—" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` }],
        historyPercentile: historyPercentile(vixHistory.map((candle) => candle.close), value),
      });
    }
  }

  const aShareQuotes = quotes.filter((quote) => quote.region === "A股");
  if (aShareQuotes.length) {
    const decliningCount = aShareQuotes.filter((quote) => quote.changePct < 0).length;
    const advancingCount = aShareQuotes.filter((quote) => quote.changePct > 0).length;
    const decliningRatio = decliningCount / aShareQuotes.length;
    const averageChangePct = aShareQuotes.reduce((sum, quote) => sum + quote.changePct, 0) / aShareQuotes.length;
    const value = Math.round(clamp(15 + decliningRatio * 55 + Math.max(0, -averageChangePct) * 10, 0, 100) * 10) / 10;
    const latest = aShareQuotes[0];
    gauges.unshift({
      id: "a-share-fear",
      market: "A股",
      code: "CN-PRESSURE",
      name: "A股市场压力温度",
      value,
      change: null,
      changePct: null,
      level: aShareFearLevel(value),
      description: `综合 ${aShareQuotes.length} 个核心指数：上涨 ${advancingCount}、下跌 ${decliningCount}，平均涨跌 ${averageChangePct >= 0 ? "+" : ""}${averageChangePct.toFixed(2)}%。仅描述当前横截面压力，不与 VIX 比较。`,
      updatedAt: `${latest.date} ${latest.time}`,
      source: "TrendSight 市场压力代理模型",
      official: false,
      history: [],
      formula: "15 + 核心指数下跌占比 × 55 + max(0, -核心指数平均涨跌幅%) × 10，结果截断至 0–100",
      components: [
        { label: "核心指数下跌占比", value: `${(decliningRatio * 100).toFixed(1)}%（${decliningCount}/${aShareQuotes.length}）` },
        { label: "核心指数平均涨跌", value: `${averageChangePct >= 0 ? "+" : ""}${averageChangePct.toFixed(2)}%` },
      ],
      historyPercentile: null,
    });
  }

  return gauges;
}

function historyPercentile(values: number[], current: number): number | null {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length < 20) return null;
  return valid.filter((value) => value <= current).length / valid.length;
}

export function parseVixHistoryCsv(value: string): FearGaugeCandle[] {
  const lines = value.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((item) => item.trim().toUpperCase());
  const dateIndex = headers.indexOf("DATE");
  const openIndex = headers.indexOf("OPEN");
  const highIndex = headers.indexOf("HIGH");
  const lowIndex = headers.indexOf("LOW");
  const closeIndex = headers.indexOf("CLOSE");
  if ([dateIndex, openIndex, highIndex, lowIndex, closeIndex].some((index) => index < 0)) return [];

  const candles = new Map<string, FearGaugeCandle>();
  for (const line of lines.slice(1)) {
    const fields = line.split(",").map((item) => item.trim());
    const date = normalizeCboeDate(fields[dateIndex]);
    const open = finiteNumber(fields[openIndex]);
    const high = finiteNumber(fields[highIndex]);
    const low = finiteNumber(fields[lowIndex]);
    const close = finiteNumber(fields[closeIndex]);
    if (
      !date
      || open == null
      || high == null
      || low == null
      || close == null
      || open <= 0
      || high < Math.max(open, close)
      || low > Math.min(open, close)
      || low <= 0
    ) continue;
    candles.set(date, { date, open, high, low, close });
  }
  return [...candles.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-160);
}

export function parseShanghaiIndexHistory(value: string): ShanghaiIndexCandle[] {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    return [];
  }
  const first = Array.isArray(payload) ? payload[0] as { hq?: unknown } | undefined : undefined;
  if (!first || !Array.isArray(first.hq)) return [];

  const candles = new Map<string, ShanghaiIndexCandle>();
  for (const item of first.hq) {
    if (!Array.isArray(item)) continue;
    const date = String(item[0] ?? "").slice(0, 10);
    const open = finiteNumber(item[1]);
    const close = finiteNumber(item[2]);
    const low = finiteNumber(item[5]);
    const high = finiteNumber(item[6]);
    const amountTenThousandCny = finiteNumber(item[8]);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || open == null
      || close == null
      || low == null
      || high == null
      || amountTenThousandCny == null
      || open <= 0
      || close <= 0
      || low <= 0
      || high < Math.max(open, close)
      || low > Math.min(open, close)
      || amountTenThousandCny <= 0
    ) continue;
    candles.set(date, { date, open, high, low, close, amountCny: amountTenThousandCny * 10_000 });
  }
  return [...candles.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-260);
}

export function mergeShanghaiIndexWithShenzhenTurnover(
  shanghaiCandles: ShanghaiIndexCandle[],
  shenzhenCandles: ShanghaiIndexCandle[],
): ShanghaiIndexCandle[] {
  const shenzhenByDate = new Map(shenzhenCandles.map((candle) => [candle.date, candle]));
  return shanghaiCandles.flatMap((candle) => {
    const shenzhen = shenzhenByDate.get(candle.date);
    return shenzhen ? [{ ...candle, amountCny: candle.amountCny + shenzhen.amountCny }] : [];
  });
}

export function analyzeShanghaiIndexHistory(candles: ShanghaiIndexCandle[]): ShanghaiIndexAnalysis | null {
  if (candles.length < 2) return null;
  const latest = candles.at(-1)!;
  const previous = candles.at(-2)!;
  const previousFive = candles.slice(-6, -1);
  const previousTwenty = candles.slice(-21, -1);
  const amountChangePct = percentChange(latest.amountCny, previous.amountCny);
  const amountVs5DayPct = percentChange(latest.amountCny, average(previousFive.map((item) => item.amountCny)));
  const amountVs20DayPct = percentChange(latest.amountCny, average(previousTwenty.map((item) => item.amountCny)));
  const priceChangePct = percentChange(latest.close, previous.close);
  const fiveDayAnchor = candles.at(-6) ?? candles[0];
  const fiveDayPriceChangePct = percentChange(latest.close, fiveDayAnchor.close);
  const volumeState: ShanghaiVolumeState = amountChangePct > 5 ? "放量" : amountChangePct < -5 ? "缩量" : "量能平稳";
  const priceDirection = priceChangePct > .15 ? "up" : priceChangePct < -.15 ? "down" : "flat";
  const amountDirection = amountChangePct > 5 ? "up" : amountChangePct < -5 ? "down" : "flat";
  const signal = priceDirection === "up" && amountDirection === "up" ? "价涨量增"
    : priceDirection === "up" && amountDirection === "down" ? "价涨量缩"
      : priceDirection === "down" && amountDirection === "up" ? "价跌量增"
        : priceDirection === "down" && amountDirection === "down" ? "价跌量缩"
          : "量价变化温和";
  const headline = signal === "价涨量增" ? "量价配合偏强"
    : signal === "价涨量缩" ? "上涨但跟量不足"
      : signal === "价跌量增" ? "放量回落，抛压偏强"
        : signal === "价跌量缩" ? "缩量回落，抛压边际减弱"
          : "量价变化仍在常态区间";
  const amountHundredMillion = latest.amountCny / 100_000_000;
  const comparison = amountVs20DayPct >= 0 ? `高于20日均额 ${amountVs20DayPct.toFixed(1)}%` : `低于20日均额 ${Math.abs(amountVs20DayPct).toFixed(1)}%`;
  return {
    date: latest.date,
    volumeState,
    amountChangePct,
    amountVs5DayPct,
    amountVs20DayPct,
    priceChangePct,
    fiveDayPriceChangePct,
    signal,
    headline,
    detail: `${latest.date} 沪深两市成交额 ${amountHundredMillion.toFixed(0)} 亿元，较前一交易日${amountChangePct >= 0 ? "增加" : "减少"} ${Math.abs(amountChangePct).toFixed(1)}%，${comparison}。`,
  };
}

async function fetchVixHistory(): Promise<FearGaugeCandle[]> {
  const now = Date.now();
  if (vixHistoryCache && vixHistoryCache.expiresAt > now) return vixHistoryCache.candles;
  try {
    const response = await fetch(vixHistoryEndpoint, {
      cache: "no-store",
      headers: { Accept: "text/csv" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > maxVixHistoryBytes) throw new Error("历史响应超过安全上限");
    const candles = parseVixHistoryCsv(body);
    if (candles.length < 20) throw new Error("历史数据不足");
    vixHistoryCache = { candles, expiresAt: now + vixHistoryCacheTtlMs };
    return candles;
  } catch {
    return vixHistoryCache?.candles ?? [];
  }
}

async function fetchShanghaiIndexHistory(now: Date): Promise<ShanghaiIndexCandle[]> {
  const cacheNow = Date.now();
  if (shanghaiHistoryCache && shanghaiHistoryCache.expiresAt > cacheNow) return shanghaiHistoryCache.candles;
  try {
    const start = new Date(now.getTime() - 550 * 24 * 60 * 60 * 1000);
    const startDate = zonedDate(start, "Asia/Shanghai").replaceAll("-", "");
    const endDate = zonedDate(now, "Asia/Shanghai").replaceAll("-", "");
    const shanghaiCandles = await fetchSohuIndexHistory("zs_000001", startDate, endDate);
    const shenzhenCandles = await fetchSohuIndexHistory("zs_399106", startDate, endDate);
    const candles = mergeShanghaiIndexWithShenzhenTurnover(shanghaiCandles, shenzhenCandles);
    if (candles.length < 20) throw new Error("上证历史日线不足");
    shanghaiHistoryCache = { candles, expiresAt: cacheNow + shanghaiHistoryCacheTtlMs };
    return candles;
  } catch {
    return shanghaiHistoryCache?.candles ?? [];
  }
}

async function fetchSohuIndexHistory(code: "zs_000001" | "zs_399106", startDate: string, endDate: string): Promise<ShanghaiIndexCandle[]> {
  const endpoint = new URL(shanghaiHistoryEndpoint);
  endpoint.searchParams.set("code", code);
  endpoint.searchParams.set("start", startDate);
  endpoint.searchParams.set("end", endDate);
  endpoint.searchParams.set("stat", "1");
  endpoint.searchParams.set("order", "D");
  endpoint.searchParams.set("period", "d");
  endpoint.searchParams.set("rt", "json");
  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: { Accept: "application/json", Referer: "https://q.stock.sohu.com/", "User-Agent": "Mozilla/5.0 (compatible; TickLens/2.0)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${code} HTTP ${response.status}`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxShanghaiHistoryBytes) throw new Error(`${code} 历史响应超过安全上限`);
  return parseShanghaiIndexHistory(body);
}

function normalizeCboeDate(value: string | undefined): string {
  const match = String(value ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, month, day, year] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) return "";
  return `${year}-${month}-${day}`;
}

function fearLevel(value: number): string {
  if (value < 15) return "极度平静";
  if (value < 20) return "平静";
  if (value < 30) return "正常";
  if (value < 40) return "警惕";
  if (value < 60) return "恐慌";
  return "极度恐慌";
}

function aShareFearLevel(value: number): string {
  if (value < 20) return "压力很低";
  if (value < 35) return "压力较低";
  if (value < 50) return "压力中性";
  if (value < 65) return "压力升温";
  if (value < 80) return "压力较高";
  return "压力极高";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentChange(value: number, baseline: number): number {
  return baseline > 0 ? ((value / baseline) - 1) * 100 : 0;
}
