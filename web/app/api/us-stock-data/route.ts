import { fetchUSMarketCsv, normalizeUSMarketRequest } from "../../lib/usStockMarket.ts";

export async function POST(request: Request) {
  try {
    const input = await safeJson(request);
    normalizeUSMarketRequest(input);
    const csv = await fetchUSMarketCsv(input);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900", "X-TrendSight-Source": "sina-us-daily" } });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "获取美股行情失败" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET() { return Response.json({ error: "仅支持 POST 请求" }, { status: 405 }); }

async function safeJson(request: Request): Promise<unknown> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 4096) throw new Error("请求内容过大");
  try { return JSON.parse(body); } catch { throw new Error("请求内容不是有效的 JSON"); }
}
