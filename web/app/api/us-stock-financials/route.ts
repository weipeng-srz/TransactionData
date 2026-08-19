import { fetchUSFinancials, normalizeUSFinancialRequest } from "../../lib/usStockFinancials.ts";

export async function POST(request: Request) {
  let code: string;
  try {
    ({ code } = normalizeUSFinancialRequest(await safeJson(request)));
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "美股财报请求无效" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    return Response.json(await fetchUSFinancials(code), { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400", "X-TrendSight-Source": "sec-company-facts" } });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "获取美股财报失败" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET() { return Response.json({ error: "仅支持 POST 请求" }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }); }

async function safeJson(request: Request): Promise<unknown> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 4096) throw new Error("请求内容过大");
  try { return JSON.parse(body); } catch { throw new Error("请求内容不是有效的 JSON"); }
}
