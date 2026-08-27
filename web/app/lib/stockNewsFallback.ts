const eastmoneyNewsEndpoint = "https://np-listapi.eastmoney.com/comm/web/getListInfo";
const eastmoneyLookupEndpoint = "https://searchapi.eastmoney.com/api/suggest/get";
const eastmoneyLookupToken = "D43BF722C8E33BDC906FB84D85E326E8";
const maxResponseBytes = 4 * 1024 * 1024;

export type StockNewsFallbackItem = {
  title: string;
  summary: string;
  url: string;
  media: string;
  publishedAt: number | null;
};

export async function fetchEastmoneyStockNews(
  code: string,
  market: "CN" | "US",
  limit: number,
): Promise<StockNewsFallbackItem[]> {
  const quoteId = market === "CN" ? `${code.startsWith("6") ? "1" : "0"}.${code}` : await lookupUSQuoteId(code);
  const endpoint = new URL(eastmoneyNewsEndpoint);
  endpoint.searchParams.set("cfh", "1");
  endpoint.searchParams.set("client", "web");
  endpoint.searchParams.set("mTypeAndCode", quoteId);
  endpoint.searchParams.set("type", "1");
  endpoint.searchParams.set("pageSize", String(Math.min(100, Math.max(20, limit * 3))));

  const body = await fetchJsonText(endpoint, market === "CN"
    ? `https://quote.eastmoney.com/${code.startsWith("6") ? "sh" : "sz"}${code}.html`
    : `https://quote.eastmoney.com/us/${encodeURIComponent(code)}.html`);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("备用新闻源返回了异常内容");
  }
  const result = payload as { code?: unknown; data?: { list?: unknown } } | null;
  if (Number(result?.code) !== 1 || !Array.isArray(result?.data?.list)) {
    throw new Error("备用新闻源未返回有效列表");
  }

  return result.data.list.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const title = String(item.Art_Title ?? "").trim();
    const url = normalizeEastmoneyUrl(String(item.Art_Url ?? item.Art_OriginUrl ?? ""));
    if (!title || !url) return [];
    return [{
      title,
      summary: "",
      url,
      media: String(item.Author ?? "东方财富").trim() || "东方财富",
      publishedAt: parseEastmoneyTime(item.Art_ShowTime),
    }];
  });
}

async function lookupUSQuoteId(code: string): Promise<string> {
  const endpoint = new URL(eastmoneyLookupEndpoint);
  endpoint.searchParams.set("input", code);
  endpoint.searchParams.set("type", "14");
  endpoint.searchParams.set("token", eastmoneyLookupToken);
  const body = await fetchJsonText(endpoint, "https://quote.eastmoney.com/");
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("备用美股代码查询返回了异常内容");
  }
  const rows = (payload as { QuotationCodeTable?: { Data?: unknown } } | null)?.QuotationCodeTable?.Data;
  const match = (Array.isArray(rows) ? rows : []).find((raw) => {
    const item = raw as Record<string, unknown>;
    return String(item.Code ?? "").toUpperCase() === code.toUpperCase() && item.Classify === "UsStock";
  }) as Record<string, unknown> | undefined;
  const quoteId = String(match?.QuoteID ?? "").trim();
  if (!/^\d{3}\.[A-Z0-9.-]{1,12}$/i.test(quoteId)) throw new Error("备用新闻源无法识别该美股代码");
  return quoteId;
}

async function fetchJsonText(endpoint: URL, referer: string): Promise<string> {
  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: referer,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(14_000),
  });
  if (!response.ok) throw new Error(`备用新闻源请求失败：HTTP ${response.status}`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxResponseBytes) throw new Error("备用新闻响应超过安全上限");
  return body;
}

function normalizeEastmoneyUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.protocol === "http:" && url.hostname.endsWith("eastmoney.com")) url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

function parseEastmoneyTime(value: unknown): number | null {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`);
  return Number.isFinite(parsed) ? parsed : null;
}
