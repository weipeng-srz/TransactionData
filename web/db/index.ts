import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";

export async function getDb() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("云端研究存储暂不可用");
  return drizzle(env.DB, { schema });
}
