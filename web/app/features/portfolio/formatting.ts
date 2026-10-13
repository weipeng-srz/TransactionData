import { formatNumber } from "../../lib/market.ts";
import type { StockCurrency } from "../../lib/security.ts";

export function formatCurrency(value: number, currency: StockCurrency = "CNY"): string {
  if (!Number.isFinite(value)) return "—";
  return `${currency === "USD" ? "$" : "¥"}${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function signedCurrency(value: number, currency: StockCurrency = "CNY"): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${currency === "USD" ? "$" : "¥"}${Math.abs(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function signedPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

export function probabilityPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${formatNumber(value * 100, 0)}%`;
}

export function formatShares(value: number): string {
  if (value >= 100_000_000) return `${formatNumber(value / 100_000_000, 2)} 亿股`;
  if (value >= 10_000) return `${formatNumber(value / 10_000, 2)} 万股`;
  return `${value.toLocaleString("zh-CN")} 股`;
}

export function currencyName(currency: StockCurrency): string {
  return currency === "USD" ? "美元" : "人民币";
}
