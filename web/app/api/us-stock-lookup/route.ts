import { lookupUSStock, normalizeUSStockLookupRequest } from "../../lib/usStockLookup.ts";

export async function POST(request: Request) {
  let query: string;
  try {
    ({ query } = normalizeUSStockLookupRequest(await safeJson(request)));
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "美股检索请求无效" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    return Response.json(await lookupUSStock(query), { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "美股检索服务不可用";
    return Response.json({ error: message }, { status: message.includes("没有找到匹配") ? 404 : 502, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET() { return Response.json({ error: "仅支持 POST 请求" }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }); }

async function safeJson(request: Request): Promise<unknown> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 4096) throw new Error("请求内容过大");
  try { return JSON.parse(body); } catch { throw new Error("请求内容不是有效的 JSON"); }
}
