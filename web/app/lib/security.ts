export type StockMarket = "CN" | "US";
export type StockCurrency = "CNY" | "USD";

export type StockIdentity = {
  code: string;
  name: string;
  market: StockMarket;
  currency: StockCurrency;
};

export const cnStockCodePattern = /^\d{6}$/;
export const usStockSymbolPattern = /^[A-Z][A-Z0-9.-]{0,9}$/;

export function normalizeUSSymbol(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^US:/i, "")
    .toUpperCase();
}

export function isUSStockSymbol(value: unknown): boolean {
  return usStockSymbolPattern.test(normalizeUSSymbol(value));
}

export function marketOf(value: { market?: StockMarket } | null | undefined): StockMarket {
  return value?.market === "US" ? "US" : "CN";
}

export function currencyOf(value: { currency?: StockCurrency; market?: StockMarket } | null | undefined): StockCurrency {
  return value?.currency === "USD" || marketOf(value) === "US" ? "USD" : "CNY";
}

export function stockStorageKey(value: { code: string; market?: StockMarket }): string {
  const market = marketOf(value);
  return market === "US" ? `US:${normalizeUSSymbol(value.code)}` : value.code;
}

export function stockRouteKey(value: { code: string; market?: StockMarket }): string {
  return stockStorageKey(value);
}

export function parseStockRoute(value: unknown): Omit<StockIdentity, "name"> | null {
  const raw = String(value ?? "").trim();
  if (cnStockCodePattern.test(raw)) return { code: raw, market: "CN", currency: "CNY" };
  const symbol = normalizeUSSymbol(raw);
  if (raw.toUpperCase().startsWith("US:") && usStockSymbolPattern.test(symbol)) {
    return { code: symbol, market: "US", currency: "USD" };
  }
  return null;
}

export function marketLabel(market: StockMarket): string {
  return market === "US" ? "美股" : "沪深 A 股";
}

export function currencySymbol(currency: StockCurrency): string {
  return currency === "USD" ? "$" : "¥";
}
