/** The account database is the only persistent store for personal workspace data. */
export const accountDataMaxBytes = 2 * 1024 * 1024;
const keys = new Set([
  "ticklens.watchlist.v1", "ticklens.holdings.v1", "ticklens.fx-preference.v1",
  "ticklens.portfolio-earnings.v1", "ticklens.recent-stocks.v1", "ticklens.saved-workspace.v1",
  "ticklens.annotations.v1", "ticklens.view-mode.v1", "ticklens.benchmark-code.v1",
  "ticklens.screener-research-pool.v1", "ticklens.screener-mode.v1",
  "ticklens.screener-professional-preset.v1.named.CN", "ticklens.screener-professional-preset.v1.named.US",
  "trendsight.trading-journal.v1", "trendsight.review-draft.v1", "ticklens.risk-profile.v1", "ticklens.appearance.v1",
]);
export function isAccountDataKey(key: unknown): key is string {
  return typeof key === "string" && (keys.has(key) || /^ticklens\.investment-memo\.v1:[A-Za-z0-9.^:_-]{1,32}$/.test(key));
}
export type AccountDataEntry = { key: string; value: string | null; revision: number; mutationId: string };
export type AccountDataWrite = { userId: string; key: string; value: string | null; revision: number; mutationId: string };
