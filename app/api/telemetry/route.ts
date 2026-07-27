import { sql } from "drizzle-orm";
import { getDb } from "../../../db/index.ts";
import { telemetryDaily } from "../../../db/schema.ts";

const allowedEvents = new Set(["app_loaded", "market_success", "market_error", "news_success", "news_error", "financial_success", "financial_error", "workspace_saved", "report_exported"]);

export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (body.length > 2048) throw new Error("invalid");
    const input = JSON.parse(body) as { event?: unknown; durationMs?: unknown };
    const event = String(input.event ?? "");
    if (!allowedEvents.has(event)) throw new Error("invalid");
    const durationMs = Math.max(0, Math.min(120_000, Math.round(Number(input.durationMs) || 0)));
    const date = new Date().toISOString().slice(0, 10);
    const key = `${date}:${event}`;
    const db = await getDb();
    await db.insert(telemetryDaily).values({ key, date, event, count: 1, totalMs: durationMs }).onConflictDoUpdate({ target: telemetryDaily.key, set: { count: sql`${telemetryDaily.count} + 1`, totalMs: sql`${telemetryDaily.totalMs} + ${durationMs}` } });
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
}
