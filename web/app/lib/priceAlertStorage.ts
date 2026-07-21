let schemaReady: Promise<void> | null = null;

export function ensurePriceAlertStorage(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS price_alerts (
        id TEXT PRIMARY KEY NOT NULL,
        user_key TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        direction TEXT NOT NULL,
        target REAL NOT NULL,
        created_at TEXT NOT NULL,
        triggered_at TEXT NOT NULL DEFAULT '',
        last_price REAL,
        last_checked_at TEXT NOT NULL DEFAULT ''
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS price_alerts_user_idx ON price_alerts (user_key)"),
      db.prepare("CREATE INDEX IF NOT EXISTS price_alerts_active_idx ON price_alerts (triggered_at, code)"),
    ]).then(() => undefined).catch((reason) => {
      schemaReady = null;
      throw reason;
    });
  }
  return schemaReady;
}
