import { lookupStock, normalizeStockLookupRequest } from "../../lib/stockLookup.ts";

const maxBodyBytes = 4096;

export async function POST(request: Request) {
  let query: string;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maxBodyBytes) throw new Error("请求内容过大");
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      throw new Error("请求内容不是有效的 JSON");
    }
    ({ query } = normalizeStockLookupRequest(input));
  } catch (reason) {
    return Response.json({
      error: reason instanceof Error ? reason.message : "股票检索请求无效",
    }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    return Response.json(await lookupStock(query), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "股票检索服务不可用";
    return Response.json({
      error: message,
    }, {
      status: message.includes("没有找到") ? 404 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export function GET() {
  return Response.json({ error: "仅支持 POST 请求" }, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  });
}
