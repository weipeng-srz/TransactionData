import { fetchRealtimeSnapshot, normalizeRealtimeRequest } from "../../lib/realtimeMarket.ts";

export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 2048) throw new Error("请求内容过大");
    const payload = normalizeRealtimeRequest(JSON.parse(body));
    const snapshot = await fetchRealtimeSnapshot(payload.code);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store", "X-TickLens-Source": "sina-realtime-https" } });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "获取实时行情失败" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET() { return Response.json({ error: "仅支持 POST 请求" }, { status: 405 }); }
