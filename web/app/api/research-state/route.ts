import { eq } from "drizzle-orm";
import { getDb } from "../../../db/index.ts";
import { researchStates } from "../../../db/schema.ts";
import { resolveUserKey } from "../../lib/serverIdentity.ts";

const maxPayloadBytes = 96 * 1024;

export async function GET(request: Request) {
  const userKey = await resolveUserKey(request);
  if (!userKey) return Response.json({ error: "当前访问没有可用的用户身份" }, { status: 401 });
  try {
    const db = await getDb();
    const [row] = await db.select().from(researchStates).where(eq(researchStates.userKey, userKey)).limit(1);
    return Response.json({ state: row ? safeParse(row.payload) : null, updatedAt: row?.updatedAt ?? "" }, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    return Response.json({ error: dbError(reason) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  const userKey = await resolveUserKey(request);
  if (!userKey) return Response.json({ error: "当前访问没有可用的用户身份" }, { status: 401 });
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maxPayloadBytes) throw new Error("研究状态超过保存上限");
    const input = JSON.parse(body) as { state?: unknown };
    const state = sanitizeState(input.state);
    const payload = JSON.stringify(state);
    const updatedAt = new Date().toISOString();
    const db = await getDb();
    await db.insert(researchStates).values({ userKey, payload, updatedAt }).onConflictDoUpdate({ target: researchStates.userKey, set: { payload, updatedAt } });
    return Response.json({ state, updatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "保存研究状态失败" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

function sanitizeState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("研究状态格式无效");
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = { version: 2 };
  if (input.workspace && typeof input.workspace === "object") output.workspace = input.workspace;
  if (Array.isArray(input.annotations)) output.annotations = input.annotations.slice(0, 100);
  if (input.viewMode === "basic" || input.viewMode === "pro") output.viewMode = input.viewMode;
  if (typeof input.benchmarkCode === "string" && /^\d{6}$/.test(input.benchmarkCode)) output.benchmarkCode = input.benchmarkCode;
  return output;
}

function safeParse(value: string): unknown { try { return JSON.parse(value); } catch { return null; } }
function dbError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : "云端研究存储不可用";
  return message.includes("no such table") ? "云端研究存储正在初始化，请稍后重试" : message;
}
