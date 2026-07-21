import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";

export async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("云端研究存储暂不可用");
  return env.DB;
}

export async function getDb(database?: D1Database) {
  return drizzle(database ?? await getD1(), { schema });
}
