import { fetchScreenerFeed, normalizeScreenerMarket } from "../../lib/screenerData.ts";

export async function GET(request: Request) {
  const market = normalizeScreenerMarket(new URL(request.url).searchParams.get("market"));
  try {
    const feed = await fetchScreenerFeed(market);
    return Response.json(feed, {
      headers: {
        "Cache-Control": "public, max-age=15, s-maxage=60, stale-while-revalidate=300",
        "X-TrendSight-Source": market === "CN" ? "sina-eastmoney-public-market" : "sina-cboe-public-market",
      },
    });
  } catch (reason) {
    return Response.json(
      { error: reason instanceof Error ? reason.message : "智能选股行情暂不可用" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
