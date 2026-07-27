export type StockHolding = {
  code: string;
  shares: number;
  cost: number;
  updatedAt: string;
};

export type StockHoldings = Record<string, StockHolding>;

export type HoldingMetrics = {
  costValue: number;
  marketValue: number;
  profit: number;
  profitPct: number;
};

const maxHoldings = 200;
const maxShares = 1_000_000_000_000;
const maxCost = 1_000_000_000;

export function parseHoldings(value: unknown): StockHoldings {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];
  const holdings: StockHoldings = {};

  for (const candidate of candidates.slice(0, maxHoldings)) {
    const holding = normalizeHolding(candidate);
    if (holding) holdings[holding.code] = holding;
  }
  return holdings;
}

export function normalizeHolding(value: unknown): StockHolding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StockHolding>;
  const code = String(candidate.code ?? "").trim();
  const shares = Number(candidate.shares);
  const cost = Number(candidate.cost);
  const updatedAt = String(candidate.updatedAt ?? "");
  if (
    !/^\d{6}$/.test(code)
    || !Number.isInteger(shares)
    || shares <= 0
    || shares > maxShares
    || !Number.isFinite(cost)
    || cost <= 0
    || cost > maxCost
    || Number.isNaN(Date.parse(updatedAt))
  ) return null;
  return { code, shares, cost, updatedAt };
}

export function calculateHoldingMetrics(
  shares: number,
  cost: number,
  currentPrice: number | null | undefined,
): HoldingMetrics | null {
  if (
    !Number.isInteger(shares)
    || shares <= 0
    || !Number.isFinite(cost)
    || cost <= 0
    || currentPrice == null
    || !Number.isFinite(currentPrice)
    || currentPrice < 0
  ) return null;
  const costValue = shares * cost;
  const marketValue = shares * currentPrice;
  const profit = marketValue - costValue;
  return {
    costValue,
    marketValue,
    profit,
    profitPct: costValue === 0 ? 0 : (profit / costValue) * 100,
  };
}
