import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUser } from "./app/lib/authServer";
import { loginRedirect, requiresAccount } from "./app/lib/accessPolicy";

export async function middleware(request: NextRequest) {
  const url = new URL(request.url);
  if (!requiresAccount(url.pathname)) return NextResponse.next();
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== url.origin)) {
      return Response.json({ error: "不允许跨站修改账户数据", code: "INVALID_ORIGIN" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }
  try {
    const user = await getAuthenticatedUser(request);
    if (user) {
      const response = NextResponse.next();
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "请先登录", code: "AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return NextResponse.redirect(loginRedirect(url));
  } catch {
    return Response.json({ error: "账户服务暂不可用，请稍后重试", code: "AUTH_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const config = { matcher: ["/api/:path*", "/account/:path*", "/screener/:path*", "/global-markets/:path*", "/review/:path*"] };
