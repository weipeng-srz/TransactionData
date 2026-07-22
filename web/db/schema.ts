import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const researchStates = sqliteTable("research_states", {
  userKey: text("user_key").primaryKey(),
  payload: text("payload").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const telemetryDaily = sqliteTable("telemetry_daily", {
  key: text("key").primaryKey(),
  date: text("date").notNull(),
  event: text("event").notNull(),
  count: integer("count").notNull().default(0),
  totalMs: integer("total_ms").notNull().default(0),
}, (table) => [index("telemetry_daily_date_idx").on(table.date)]);
