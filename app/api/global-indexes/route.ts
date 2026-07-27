import { fetchGlobalIndexFeed } from "../../lib/globalIndexes.ts";

export async function GET() {
  try {
    const feed = await fetchGlobalIndexFeed();
    return Response.json(feed, { headers: { "Cache-Control": "no-store", "X-TickLens-Source": "sina-global-indexes-https" } });
  } catch (reason) {
    return Response.json(
      { error: reason instanceof Error ? reason.message : "获取全球指数失败" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
