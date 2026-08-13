import { fetchUSRealtimeSnapshot, normalizeUSRealtimeRequest } from "../../lib/usStockRealtime.ts";

export async function POST(request: Request) {
  try {
    const { code } = normalizeUSRealtimeRequest(await safeJson(request));
    return Response.json(await fetchUSRealtimeSnapshot(code), { headers: { "Cache-Control": "no-store", "X-TrendSight-Market": "US" } });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "获取美股报价失败" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET() { return Response.json({ error: "仅支持 POST 请求" }, { status: 405 }); }

async function safeJson(request: Request): Promise<unknown> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 4096) throw new Error("请求内容过大");
  try { return JSON.parse(body); } catch { throw new Error("请求内容不是有效的 JSON"); }
}
