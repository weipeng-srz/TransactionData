import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db/index.ts";
import { priceAlerts } from "../../../db/schema.ts";
import { resolveUserKey } from "../../lib/serverIdentity.ts";

export async function GET(request: Request) {
  const userKey = await resolveUserKey(request);
  if (!userKey) return Response.json({ error: "当前访问没有可用的用户身份" }, { status: 401 });
  try {
    const db = await getDb();
    const alerts = await db.select().from(priceAlerts).where(eq(priceAlerts.userKey, userKey)).orderBy(asc(priceAlerts.createdAt)).limit(30);
    return Response.json({ alerts }, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    return Response.json({ error: dbError(reason) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  const userKey = await resolveUserKey(request);
  if (!userKey) return Response.json({ error: "当前访问没有可用的用户身份" }, { status: 401 });
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 64 * 1024) throw new Error("价格提醒数量过多");
    const input = JSON.parse(body) as { alerts?: unknown };
    const alerts = sanitizeAlerts(input.alerts);
    const db = await getDb();
    await db.delete(priceAlerts).where(eq(priceAlerts.userKey, userKey));
    if (alerts.length) await db.insert(priceAlerts).values(alerts.map((alert) => ({ ...alert, userKey })));
    return Response.json({ alerts }, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "保存价格提醒失败" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

function sanitizeAlerts(value: unknown) {
  if (!Array.isArray(value)) throw new Error("价格提醒格式无效");
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const alert = item as Record<string, unknown>;
    const id = String(alert.id ?? "").slice(0, 80);
    const code = String(alert.code ?? "");
    const direction = alert.direction;
    const target = Number(alert.target);
    if (!id || seen.has(id) || !/^\d{6}$/.test(code) || (direction !== "above" && direction !== "below") || !Number.isFinite(target) || target <= 0) return [];
    seen.add(id);
    return [{
      id, code, name: String(alert.name ?? code).slice(0, 40), direction, target,
      createdAt: validDate(alert.createdAt) || new Date().toISOString(), triggeredAt: validDate(alert.triggeredAt),
      lastPrice: finiteOrNull(alert.lastPrice), lastCheckedAt: validDate(alert.lastCheckedAt),
    } as const];
  }).slice(0, 30);
}

function validDate(value: unknown): string { const text = String(value ?? ""); return text && Number.isFinite(Date.parse(text)) ? text : ""; }
function finiteOrNull(value: unknown): number | null { const number = Number(value); return value != null && Number.isFinite(number) ? number : null; }
function dbError(reason: unknown): string { const message = reason instanceof Error ? reason.message : "云端价格提醒不可用"; return message.includes("no such table") ? "云端价格提醒正在初始化，请稍后重试" : message; }
