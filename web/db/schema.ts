import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const researchStates = sqliteTable("research_states", {
  userKey: text("user_key").primaryKey(),
  payload: text("payload").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const priceAlerts = sqliteTable("price_alerts", {
  id: text("id").primaryKey(),
  userKey: text("user_key").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  direction: text("direction", { enum: ["above", "below"] }).notNull(),
  target: real("target").notNull(),
  createdAt: text("created_at").notNull(),
  triggeredAt: text("triggered_at").notNull().default(""),
  lastPrice: real("last_price"),
  lastCheckedAt: text("last_checked_at").notNull().default(""),
}, (table) => [
  index("price_alerts_user_idx").on(table.userKey),
  index("price_alerts_active_idx").on(table.triggeredAt, table.code),
]);

export const telemetryDaily = sqliteTable("telemetry_daily", {
  key: text("key").primaryKey(),
  date: text("date").notNull(),
  event: text("event").notNull(),
  count: integer("count").notNull().default(0),
  totalMs: integer("total_ms").notNull().default(0),
}, (table) => [index("telemetry_daily_date_idx").on(table.date)]);
