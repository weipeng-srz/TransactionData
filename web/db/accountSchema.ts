import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accountData = sqliteTable("account_data", {
  userKey: text("user_key").notNull(),
  key: text("key").notNull(),
  value: text("value"),
  revision: integer("revision").notNull().default(1),
  mutationId: text("mutation_id").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userKey, table.key] })]);
