const eastmoneyDailyTradesEndpoint = "https://push2.eastmoney.com/api/qt/stock/details/get";
const tencentDailyTradesEndpoint = "https://stock.gtimg.cn/data/index.php";
const maxResponseBytes = 4 * 1024 * 1024;

export type DailyTradesRequest = {
  code: string;
  date: string;
  name: string;
  previousClose: number | null;
};

export type DailyTrade = {
  time: string;
  price: number;
  priceChange: number | null;
  volumeLots: number;
  tradeCount: number | null;
  amount: number | null;
  sideCode: string;
};

export type ParsedDailyTrades = {
  code: string;
  previousClose: number | null;
  trades: DailyTrade[];
  source: string;
  tradeCountBasis: string;
  amountBasis: string;
};

export function normalizeDailyTradesRequest(value: unknown): DailyTradesRequest {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const input = value as { code?: unknown; date?: unknown; name?: unknown; previousClose?: unknown };
  const code = String(input.code ?? "").trim().replace(/^(?:sh|sz)/i, "").replace(/\.(?:sh|sz)$/i, "");
  if (!/^\d{6}$/.test(code)) throw new Error("请输入有效的 6 位沪深 A 股代码");
  const date = String(input.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00+08:00`))) {
    throw new Error("交易日期格式无效");
  }
  const name = String(input.name ?? "").trim().slice(0, 80) || code;
  const previousClose = positiveNumber(input.previousClose);
  return { code, date, name, previousClose };
}

export async function fetchDailyTradesCsv(request: DailyTradesRequest): Promise<string> {
  let parsed: ParsedDailyTrades;
  let primaryError: unknown;
  try {
    parsed = await fetchEastmoneyDailyTrades(request.code);
  } catch (reason) {
    primaryError = reason;
    try {
      parsed = await fetchTencentDailyTrades(request);
    } catch (fallbackError) {
      throw new Error(`逐笔成交主备服务均不可用：主源 ${errorMessage(primaryError)}；备用源 ${errorMessage(fallbackError)}`);
    }
  }
  if (parsed.code !== request.code) throw new Error("逐笔成交服务返回了不匹配的股票代码");
  if (!parsed.trades.length) throw new Error("该交易日暂未返回可下载的逐笔成交明细");
  return buildDailyTradesCsv(request, parsed);
}

async function fetchEastmoneyDailyTrades(code: string): Promise<ParsedDailyTrades> {
  const isShanghai = /^[569]/.test(code);
  const endpoint = new URL(eastmoneyDailyTradesEndpoint);
  endpoint.searchParams.set("secid", `${isShanghai ? "1" : "0"}.${code}`);
  endpoint.searchParams.set("fields1", "f1,f2,f3,f4,f5");
  endpoint.searchParams.set("fields2", "f51,f52,f53,f54,f55");
  endpoint.searchParams.set("pos", "-200000");
  endpoint.searchParams.set("iscca", "1");
  endpoint.searchParams.set("ndays", "1");
  endpoint.searchParams.set("_", Date.now().toString());
  return parseDailyTradesResponse(await fetchProviderText(endpoint, "https://quote.eastmoney.com/", "东方财富逐笔成交"));
}

async function fetchTencentDailyTrades(request: DailyTradesRequest): Promise<ParsedDailyTrades> {
  const symbol = `${/^[569]/.test(request.code) ? "sh" : "sz"}${request.code}`;
  const timelineEndpoint = new URL(tencentDailyTradesEndpoint);
  timelineEndpoint.searchParams.set("appn", "detail");
  timelineEndpoint.searchParams.set("action", "timeline");
  timelineEndpoint.searchParams.set("c", symbol);
  const timeline = parseTencentTradeTimeline(await fetchProviderText(timelineEndpoint, "https://gu.qq.com/", "腾讯成交时间线"));
  if (timeline.date !== request.date) throw new Error(`成交明细日期为 ${timeline.date}，请先刷新单日行情后再下载`);

  const trades: DailyTrade[] = [];
  const concurrency = 8;
  for (let start = 0; start < timeline.pageCount; start += concurrency) {
    const pageNumbers = Array.from({ length: Math.min(concurrency, timeline.pageCount - start) }, (_, index) => start + index);
    const batches = await Promise.all(pageNumbers.map(async (page) => {
      const endpoint = new URL(tencentDailyTradesEndpoint);
      endpoint.searchParams.set("appn", "detail");
      endpoint.searchParams.set("action", "data");
      endpoint.searchParams.set("c", symbol);
      endpoint.searchParams.set("p", String(page));
      return parseTencentDailyTradePage(await fetchProviderText(endpoint, "https://gu.qq.com/", `腾讯成交明细第 ${page + 1} 页`));
    }));
    batches.forEach((batch) => trades.push(...batch));
  }
  return {
    code: request.code,
    previousClose: request.previousClose,
    trades,
    source: "腾讯公开Level-1成交明细（东方财富主源不可用时自动降级）",
    tradeCountBasis: "备用源不提供切片内成交笔数，字段留空",
    amountBasis: "上游成交额",
  };
}

async function fetchProviderText(endpoint: URL, referer: string, label: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: referer,
        "User-Agent": "Mozilla/5.0 (compatible; TrendSight/2.0)",
      },
      signal: AbortSignal.timeout(14_000),
    });
  } catch (reason) {
    throw new Error(`${label}网络请求失败：${reason instanceof Error ? reason.message : "连接异常"}`);
  }
  if (!response.ok) throw new Error(`${label}请求失败：HTTP ${response.status}`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxResponseBytes) throw new Error(`${label}响应超过安全上限`);
  return body;
}

export function parseDailyTradesResponse(body: string): ParsedDailyTrades {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("逐笔成交数据无法解析");
  }
  const root = payload as { rc?: unknown; data?: { code?: unknown; prePrice?: unknown; details?: unknown } } | null;
  if (Number(root?.rc) !== 0 || !root?.data || !Array.isArray(root.data.details)) {
    throw new Error("逐笔成交服务返回了异常内容");
  }
  const code = String(root.data.code ?? "").trim();
  const previousClose = positiveNumber(root.data.prePrice);
  if (!/^\d{6}$/.test(code) || !previousClose) throw new Error("逐笔成交基础字段不完整");
  const trades = root.data.details.flatMap((raw) => {
    const fields = String(raw).split(",");
    const time = String(fields[0] ?? "").trim();
    const price = positiveNumber(fields[1]);
    const volumeLots = nonNegativeInteger(fields[2]);
    const tradeCount = nonNegativeInteger(fields[3]);
    const sideCode = String(fields[4] ?? "").trim();
    // 集合竞价期间的未成交快照通常为 0 笔；它们不是成交记录，不能写进逐笔文件。
    if (!/^\d{2}:\d{2}:\d{2}$/.test(time) || !price || volumeLots == null || !tradeCount) return [];
    return [{ time, price, priceChange: null, volumeLots, tradeCount, amount: null, sideCode }];
  });
  return {
    code,
    previousClose,
    trades,
    source: "东方财富公开Level-1成交明细",
    tradeCountBasis: "单条Level-1时间切片内聚合的成交笔数",
    amountBasis: "成交价×成交量估算",
  };
}

export function parseTencentTradeTimeline(body: string): { date: string; pageCount: number } {
  const value = parseJavascriptArray(body, "腾讯成交时间线");
  const compactDate = String(value[0] ?? "");
  const ranges = String(value[1] ?? "").split("|").filter(Boolean);
  if (!/^\d{8}$/.test(compactDate) || !ranges.length || ranges.length > 120) throw new Error("腾讯成交时间线字段不完整");
  return { date: `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`, pageCount: ranges.length };
}

export function parseTencentDailyTradePage(body: string): DailyTrade[] {
  const value = parseJavascriptArray(body, "腾讯成交明细");
  const rows = String(value[1] ?? "").split("|").filter(Boolean);
  return rows.flatMap((raw) => {
    const fields = raw.split("/");
    const time = String(fields[1] ?? "").trim();
    const price = positiveNumber(fields[2]);
    const priceChange = finiteNumber(fields[3]);
    const volumeLots = nonNegativeInteger(fields[4]);
    const amount = finiteNumber(fields[5]);
    const sideCode = String(fields[6] ?? "").trim();
    if (!/^\d{2}:\d{2}:\d{2}$/.test(time) || !price || volumeLots == null || amount == null || amount < 0) return [];
    return [{ time, price, priceChange, volumeLots, tradeCount: null, amount, sideCode }];
  });
}

export function buildDailyTradesCsv(request: DailyTradesRequest, parsed: ParsedDailyTrades): string {
  const fetchedAt = new Date().toISOString();
  const lines: string[][] = [[
    "#META",
    `股票代码=${request.code}`,
    `股票名称=${request.name}`,
    `交易日期=${request.date}`,
    "成交数据级别=公开Level-1成交明细",
    "成交时间精度=约3秒",
    "数据序号口径=文件内单日顺序",
    `成交笔数口径=${parsed.tradeCountBasis}`,
    `成交金额口径=${parsed.amountBasis}`,
    `数据来源=${parsed.source}`,
    `采集时间=${fetchedAt}`,
  ], [
    "交易日期", "成交时间", "数据序号", "股票代码", "股票名称", "成交价格(元)", "价格变动(元)", "涨跌幅(%)",
    "成交量(手)", "成交量(股)", "成交笔数", "成交金额(元)", "性质", "原始性质代码", "交易时段", "数据级别",
  ]];
  const previousClose = parsed.previousClose ?? request.previousClose;
  let previousPrice = previousClose ?? parsed.trades[0]?.price ?? 0;
  parsed.trades.forEach((trade, index) => {
    const volumeShares = trade.volumeLots * 100;
    const change = trade.priceChange ?? trade.price - previousPrice;
    lines.push([
      request.date,
      trade.time,
      String(index + 1),
      request.code,
      request.name,
      trade.price.toFixed(3),
      change.toFixed(3),
      previousClose ? (((trade.price / previousClose) - 1) * 100).toFixed(3) : "",
      String(trade.volumeLots),
      String(volumeShares),
      trade.tradeCount == null ? "" : String(trade.tradeCount),
      (trade.amount ?? trade.price * volumeShares).toFixed(2),
      sideName(trade.sideCode),
      trade.sideCode,
      sessionName(trade.time),
      "公开Level-1成交明细（约3秒聚合）",
    ]);
    previousPrice = trade.price;
  });
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function sideName(value: string): string {
  if (value === "1" || value === "S") return "卖盘";
  if (value === "2" || value === "B") return "买盘";
  if (value === "4" || value === "M") return "中性盘";
  return "其他";
}

function sessionName(time: string): string {
  const [hour, minute, second] = time.split(":").map(Number);
  const seconds = hour * 3600 + minute * 60 + second;
  if (seconds >= 9 * 3600 + 15 * 60 && seconds <= 9 * 3600 + 25 * 60) return "开盘集合竞价";
  if ((seconds >= 9 * 3600 + 30 * 60 && seconds <= 11 * 3600 + 30 * 60)
    || (seconds >= 13 * 3600 && seconds < 14 * 3600 + 57 * 60)) return "连续竞价";
  if (seconds >= 14 * 3600 + 57 * 60 && seconds <= 15 * 3600) return "收盘集合竞价";
  if (seconds > 15 * 3600 && seconds <= 15 * 3600 + 30 * 60) return "盘后交易";
  return "其他时段";
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function parseJavascriptArray(body: string, label: string): unknown[] {
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error(`${label}返回了异常内容`);
  let value: unknown;
  try { value = JSON.parse(body.slice(start, end + 1)); } catch { throw new Error(`${label}数据无法解析`); }
  if (!Array.isArray(value)) throw new Error(`${label}返回了异常内容`);
  return value;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "未知错误";
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(?:\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
