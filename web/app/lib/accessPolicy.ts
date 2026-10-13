const publicStockApis = new Set([
  "/api/local-stock-lookup", "/api/us-stock-lookup", "/api/local-stock-data", "/api/us-stock-data",
  "/api/local-stock-financials", "/api/us-stock-financials", "/api/local-stock-news", "/api/us-stock-news",
  "/api/realtime-market", "/api/us-stock-realtime", "/api/local-stock-trades",
]);

/** The same policy protects page navigation, RSC requests, and direct API calls. */
export function requiresAccount(pathname: string): boolean {
  const path = decodeURIComponent(pathname).replace(/\/+$/, "") || "/";
  if (path === "/api/auth" || path.startsWith("/api/auth/")) return false;
  if (path.startsWith("/api/")) return !publicStockApis.has(path);
  return ["/account", "/screener", "/global-markets", "/review"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function loginRedirect(url: URL): URL {
  const target = new URL("/login", url.origin);
  target.searchParams.set("next", `${url.pathname}${url.search}`);
  return target;
}
