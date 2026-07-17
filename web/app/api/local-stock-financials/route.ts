import { fetchFinancials, normalizeFinancialRequest } from "../../lib/financials.ts";

const maxBodyBytes = 4096;

export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maxBodyBytes) throw new Error("请求内容过大");
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      throw new Error("请求内容不是有效的 JSON");
    }
    const { code } = normalizeFinancialRequest(input);
    return Response.json(await fetchFinancials(code), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (reason) {
    return Response.json({
      error: reason instanceof Error ? reason.message : "获取财报数据失败",
    }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export function GET() {
  return Response.json({ error: "仅支持 POST 请求" }, {
    status: 405,
    headers: { "Cache-Control": "no-store" },
  });
}
