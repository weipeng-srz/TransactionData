import { isUSStockSymbol, normalizeUSSymbol, type StockIdentity } from "./security.ts";

const lookupEndpoint = "https://suggest3.sinajs.cn/suggest/type=41";
const maxResponseBytes = 512 * 1024;

export function normalizeUSStockLookupRequest(value: unknown): { query: string } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const query = String((value as { query?: unknown }).query ?? "").trim();
  if (!query || query.length > 40) throw new Error("请输入 1 到 40 个字符的美股代码或名称");
  return { query };
}

export function parseUSStockSuggestions(body: string): StockIdentity[] {
  const match = body.match(/="([\s\S]*)";?\s*$/);
  if (!match) return [];
  const seen = new Set<string>();
  return match[1].split(";").flatMap((record) => {
    const fields = record.split(",");
    const code = normalizeUSSymbol(fields[2]);
    const name = String(fields[4] || fields[0] || code).trim();
    if (fields[1] !== "41" || !isUSStockSymbol(code) || !name || seen.has(code)) return [];
    seen.add(code);
    return [{ code, name, market: "US" as const, currency: "USD" as const }];
  });
}

export async function lookupUSStock(query: string): Promise<StockIdentity> {
  const normalizedQuery = normalizeUSStockLookupRequest({ query }).query;
  const url = new URL(lookupEndpoint);
  url.searchParams.set("key", normalizedQuery);
  url.searchParams.set("name", "trendsight");
  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      Referer: "https://finance.sina.com.cn/stock/usstock/",
      "User-Agent": "Mozilla/5.0 (compatible; TrendSight/2.0)",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`美股检索服务请求失败：HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxResponseBytes) throw new Error("美股检索响应超过安全上限");
  const body = decodeText(bytes, "gbk");
  const candidates = parseUSStockSuggestions(body);
  const querySymbol = normalizeUSSymbol(normalizedQuery);
  const exact = candidates.find((item) => item.code === querySymbol)
    ?? candidates.find((item) => item.name.toLowerCase() === normalizedQuery.toLowerCase());
  if (exact) return exact;
  if (candidates[0]) return candidates[0];
  if (isUSStockSymbol(querySymbol)) {
    return { code: querySymbol, name: querySymbol, market: "US", currency: "USD" };
  }
  throw new Error("没有找到匹配的美股代码或名称");
}

function decodeText(bytes: ArrayBuffer, encoding: "gbk" | "utf-8"): string {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}
