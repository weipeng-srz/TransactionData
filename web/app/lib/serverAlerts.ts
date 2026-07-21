import { ensurePriceAlertStorage } from "./priceAlertStorage.ts";
import { fetchRealtimePrices } from "./realtimeMarket.ts";

type ActiveAlertRow = {
  id: string;
  code: string;
  direction: "above" | "below";
  target: number;
};

export async function checkPriceAlertsInBackground(db: D1Database): Promise<{ checked: number; triggered: number }> {
  await ensurePriceAlertStorage(db);
  const result = await db.prepare(
    "SELECT id, code, direction, target FROM price_alerts WHERE triggered_at = '' ORDER BY code LIMIT 1000",
  ).all<ActiveAlertRow>();
  const alerts = result.results ?? [];
  const byCode = new Map<string, ActiveAlertRow[]>();
  alerts.forEach((alert) => byCode.set(alert.code, [...(byCode.get(alert.code) ?? []), alert]));
  const checkedAt = new Date().toISOString();
  let checked = 0;
  let triggered = 0;
  const codes = [...byCode.keys()];
  for (let offset = 0; offset < codes.length; offset += 30) {
    try {
      const quotes = await fetchRealtimePrices(codes.slice(offset, offset + 30));
      const statements = quotes.flatMap(({ code, price }) => (byCode.get(code) ?? []).map((alert) => {
        const matched = alert.direction === "above" ? price >= alert.target : price <= alert.target;
        checked += 1;
        if (matched) triggered += 1;
        return db.prepare(
          matched
            ? "UPDATE price_alerts SET last_price = ?, last_checked_at = ?, triggered_at = ? WHERE id = ? AND triggered_at = ''"
            : "UPDATE price_alerts SET last_price = ?, last_checked_at = ? WHERE id = ? AND triggered_at = ''",
        ).bind(...(matched ? [price, checkedAt, checkedAt, alert.id] : [price, checkedAt, alert.id]));
      }));
      if (statements.length) await db.batch(statements);
    } catch {
      // One provider failure must not prevent later batches from being checked.
    }
  }
  return { checked, triggered };
}
