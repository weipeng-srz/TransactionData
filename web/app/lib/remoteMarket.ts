import { lookupStock } from "./stockLookup.ts";

const sinaKlineEndpoint = "https://quotes.sina.cn/cn/api/jsonp_v2.php/ticklens=/CN_MarketDataService.getKLineData";
const sinaFactorBase = "https://finance.sina.com.cn/realstock/company";
const maxResponseBytes = 4 * 1024 * 1024;

export type RemoteMarketRequest = {
  code: string;
  days: number;
  kind: "stock" | "index";
};

type KlineRow = {
  day?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
};

type FactorEvent = { date: string; factor: number };

export function normalizeRemoteMarketRequest(value: unknown): RemoteMarketRequest {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const input = value as { code?: unknown; days?: unknown; kind?: unknown };
  const rawCode = String(input.code ?? "").trim();
  const code = rawCode.replace(/^(?:sh|sz)/i, "").replace(/\.(?:sh|sz)$/i, "");
  if (!/^\d{6}$/.test(code)) throw new Error("请输入有效的 6 位沪深代码");
  const days = input.days == null ? 250 : Number(input.days);
  if (!Number.isInteger(days) || days < 20 || days > 1250) throw new Error("历史区间必须在 20 到 1250 个交易日之间");
  return { code, days, kind: input.kind === "index" ? "index" : "stock" };
}

export async function fetchRemoteMarketCsv(request: RemoteMarketRequest): Promise<string> {
  const symbol = toSinaSymbol(request.code, request.kind);
  const [rows, name, factors] = await Promise.all([
    fetchKlines(symbol, request.days),
    resolveName(request.code, request.kind),
    request.kind === "stock" ? fetchFactors(symbol).catch(() => [] as FactorEvent[]) : Promise.resolve([] as FactorEvent[]),
  ]);
  if (!rows.length) throw new Error("行情服务没有返回可用的历史数据");
  const fetchedAt = new Date().toISOString();
  const lines: string[][] = [[
    "#META",
    `股票代码=${request.code}`,
    `股票名称=${name}`,
    "价格口径=前复权",
    "成交数据级别=HTTPS日K聚合行情",
    "成交时间精度=日",
    "数据序号口径=每个交易日的OHLC合成点",
    "成交金额口径=典型价格×成交量代理",
    "数据来源=新浪公开K线",
    `采集时间=${fetchedAt}`,
  ]];
  for (const row of rows) {
    const factor = factorForDate(factors, row.date);
    lines.push(["#DAY", `交易日期=${row.date}`, `前复权因子=${factor.toFixed(10)}`, "", "", "", "", "", "", ""]);
  }
  lines.push([
    "交易日期", "成交时间", "数据序号", "股票代码", "股票名称", "原始成交价格(元)", "前复权成交价格(元)",
    "成交量(股)", "成交金额估算(元)", "性质", "原始性质代码", "交易时段", "数据级别",
  ]);
  rows.forEach((row) => {
    const factor = factorForDate(factors, row.date);
    const rawPrices = [row.open, row.high, row.low, row.close];
    const times = ["09:30:00", "10:30:00", "14:00:00", "15:00:00"];
    const volumeParts = splitVolume(row.volume, rawPrices.length);
    rawPrices.forEach((rawPrice, index) => {
      const volume = volumeParts[index];
      lines.push([
        row.date,
        times[index],
        String(index + 1),
        request.code,
        name,
        rawPrice.toFixed(4),
        (rawPrice / factor).toFixed(4),
        String(volume),
        (rawPrice * volume).toFixed(2),
        "",
        "",
        "连续竞价",
        "HTTPS日K聚合行情",
      ]);
    });
  });
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\n")}`;
}

export async function fetchLatestRemotePrice(code: string, kind: "stock" | "index" = "stock"): Promise<number> {
  const rows = await fetchKlines(toSinaSymbol(code, kind), 20);
  const latest = rows.at(-1);
  if (!latest) throw new Error("没有可用的最新价格");
  return latest.close;
}

async function fetchKlines(symbol: string, days: number) {
  const endpoint = new URL(sinaKlineEndpoint);
  endpoint.searchParams.set("symbol", symbol);
  endpoint.searchParams.set("scale", "240");
  endpoint.searchParams.set("ma", "no");
  endpoint.searchParams.set("datalen", String(days));
  const body = await safeFetchText(endpoint, "https://finance.sina.com.cn/");
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("行情服务返回了异常内容");
  let value: unknown;
  try {
    value = JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error("行情服务返回了无法解析的数据");
  }
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const row = item as KlineRow;
    const date = String(row.day ?? "").slice(0, 10);
    const open = finiteNumber(row.open);
    const high = finiteNumber(row.high);
    const low = finiteNumber(row.low);
    const close = finiteNumber(row.close);
    const volume = finiteNumber(row.volume);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || [open, high, low, close, volume].some((number) => number == null) || close! <= 0) return [];
    return [{ date, open: open!, high: high!, low: low!, close: close!, volume: Math.max(0, Math.round(volume!)) }];
  });
}

async function fetchFactors(symbol: string): Promise<FactorEvent[]> {
  const today = new Date().toISOString().slice(0, 10);
  const endpoint = `${sinaFactorBase}/${symbol}/qfq.js?d=${today}`;
  const body = await safeFetchText(endpoint, "https://finance.sina.com.cn/");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  const payload = JSON.parse(body.slice(start, end + 1)) as { data?: Array<{ d?: unknown; f?: unknown }> };
  return (Array.isArray(payload.data) ? payload.data : []).flatMap((item) => {
    const date = String(item.d ?? "");
    const factor = finiteNumber(item.f);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && factor != null && factor > 0 ? [{ date, factor }] : [];
  }).sort((left, right) => right.date.localeCompare(left.date));
}

async function resolveName(code: string, kind: "stock" | "index"): Promise<string> {
  if (kind === "index") return ({ "000300": "沪深300", "000001": "上证指数", "399001": "深证成指", "399006": "创业板指" } as Record<string, string>)[code] ?? code;
  try {
    return (await lookupStock(code)).name;
  } catch {
    return code;
  }
}

function toSinaSymbol(code: string, kind: "stock" | "index"): string {
  if (kind === "index") {
    if (code === "000300" || code === "000001") return `sh${code}`;
    return `sz${code}`;
  }
  return `${/^[569]/.test(code) ? "sh" : "sz"}${code}`;
}

async function safeFetchText(endpoint: string | URL, referer: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Accept: "application/json,text/javascript,*/*;q=0.8", Referer: referer, "User-Agent": "Mozilla/5.0 (compatible; TickLens/2.0)" },
      signal: AbortSignal.timeout(14_000),
    });
  } catch (reason) {
    throw new Error(`行情网络请求失败：${reason instanceof Error ? reason.message : "连接异常"}`);
  }
  if (!response.ok) throw new Error(`行情服务请求失败：HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > maxResponseBytes) throw new Error("行情响应超过安全上限");
  return body;
}

function factorForDate(events: FactorEvent[], date: string): number {
  return events.find((event) => event.date <= date)?.factor ?? 1;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function splitVolume(volume: number, count: number): number[] {
  const base = Math.floor(volume / count);
  return Array.from({ length: count }, (_, index) => index === count - 1 ? volume - base * (count - 1) : base);
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
