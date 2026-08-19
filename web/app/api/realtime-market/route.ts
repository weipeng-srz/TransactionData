import { fetchRealtimeSnapshot, normalizeRealtimeRequest } from "../../lib/realtimeMarket.ts";

export async function POST(request: Request) {
  let code: string;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 2048) throw new Error("请求内容过大");
    ({ code } = normalizeRealtimeRequest(JSON.parse(body)));
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "实时行情请求无效" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const snapshot = await fetchRealtimeSnapshot(code);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store", "X-TickLens-Source": "realtime-market-auto-fallback" } });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "获取实时行情失败" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET() { return Response.json({ error: "仅支持 POST 请求" }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }); }
