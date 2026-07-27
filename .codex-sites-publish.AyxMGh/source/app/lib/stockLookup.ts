const stockSearchEndpoint = "https://searchapi.eastmoney.com/api/suggest/get";
const stockSearchToken = "D43BF722C8E33BDC906FB84D85E326E8";
const maxLookupResponseBytes = 1024 * 1024;

export type StockLookupResult = {
  code: string;
  name: string;
};

export function normalizeStockLookupRequest(value: unknown): { query: string } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const query = String((value as { query?: unknown }).query ?? "").trim();
  if (!query) throw new Error("请输入股票代码或名称");
  if (query.length > 40 || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new Error("股票名称或代码格式无效");
  }
  return { query };
}

export function pickStockLookupResult(value: unknown, query: string): StockLookupResult {
  const table = (value as {
    QuotationCodeTable?: {
      Data?: Array<{
        Code?: unknown;
        Name?: unknown;
        Classify?: unknown;
        QuoteID?: unknown;
      }>;
    };
  } | null)?.QuotationCodeTable;
  const items = Array.isArray(table?.Data) ? table.Data : [];
  const candidates = items.flatMap((item) => {
    const code = String(item.Code ?? "").trim();
    const name = String(item.Name ?? "").trim();
    const quoteID = String(item.QuoteID ?? "").trim();
    if (!/^\d{6}$/.test(code) || !name || item.Classify !== "AStock" || !/^[01]\./.test(quoteID)) return [];
    return [{ code, name }];
  });
  const normalizedQuery = normalizeStockName(query);
  const result = candidates.find((item) => normalizeStockName(item.name) === normalizedQuery) ?? candidates[0];
  if (!result) throw new Error(`没有找到与“${query}”匹配的沪深 A 股`);
  return result;
}

export function parseStockLookupResponse(body: string, query: string): StockLookupResult {
  const value = body.trim();
  if (!value) throw new Error("股票名称查询返回了空响应");
  let payloadText = value;
  const jsonp = value.match(/^[\w$.]+\(([\s\S]*)\)\s*;?$/);
  if (jsonp) payloadText = jsonp[1];
  try {
    return pickStockLookupResult(JSON.parse(payloadText), query);
  } catch (reason) {
    if (reason instanceof SyntaxError) throw new Error("股票名称服务返回了异常页面，请稍后重试");
    throw reason;
  }
}

export async function lookupStock(query: string): Promise<StockLookupResult> {
  const endpoint = new URL(stockSearchEndpoint);
  endpoint.searchParams.set("input", query);
  endpoint.searchParams.set("type", "14");
  endpoint.searchParams.set("token", stockSearchToken);
  endpoint.searchParams.set("cb", "ticklensLookup");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        Referer: "https://quote.eastmoney.com/",
        "User-Agent": "Mozilla/5.0 (compatible; TickLens/1.0)",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (reason) {
    throw new Error(`股票名称查询失败：${reason instanceof Error ? reason.message : "网络连接异常"}`);
  }
  if (!response.ok) throw new Error(`股票名称查询失败：HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > maxLookupResponseBytes) throw new Error("股票名称查询响应过大");
  return parseStockLookupResponse(body, query);
}

function normalizeStockName(value: string): string {
  return value.replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}
