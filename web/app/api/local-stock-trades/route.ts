import { fetchDailyTradesCsv, normalizeDailyTradesRequest, type DailyTradesRequest } from "../../lib/dailyTrades.ts";

export async function POST(request: Request) {
  let payload: DailyTradesRequest;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 2048) throw new Error("请求内容过大");
    payload = normalizeDailyTradesRequest(JSON.parse(body));
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "逐笔成交下载请求无效" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const csv = await fetchDailyTradesCsv(payload);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${payload.code}-${payload.date}-level1-trades.csv"`,
        "Cache-Control": "no-store",
        "X-TrendSight-Source": "level1-trades-auto-fallback",
      },
    });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "逐笔成交下载失败" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET() { return Response.json({ error: "仅支持 POST 请求" }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }); }
