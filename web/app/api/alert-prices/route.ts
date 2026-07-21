import { fetchRealtimePrices, normalizeRealtimePriceRequest } from "../../lib/realtimeMarket.ts";

export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 4096) throw new Error("请求内容过大");
    const { codes } = normalizeRealtimePriceRequest(JSON.parse(body));
    const quotes = await fetchRealtimePrices(codes);
    return Response.json({ quotes }, {
      headers: { "Cache-Control": "no-store", "X-TickLens-Source": "sina-realtime-batch" },
    });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "实时告警价格获取失败" }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export function GET() {
  return Response.json({ error: "仅支持 POST 请求" }, { status: 405 });
}
