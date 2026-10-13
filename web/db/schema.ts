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

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  bio: text("bio").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  sessionVersion: integer("session_version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionVersion: integer("session_version").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("auth_sessions_user_idx").on(table.userId), index("auth_sessions_expiry_idx").on(table.expiresAt)]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("auth_rate_limits_expiry_idx").on(table.expiresAt)]);
