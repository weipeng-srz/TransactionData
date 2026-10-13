import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db/index.ts";
import { accountData } from "../../../db/accountSchema.ts";
import { accountDataMaxBytes, isAccountDataKey, type AccountDataWrite } from "../../lib/accountData.ts";
import { isSameOriginRequest } from "../../lib/authServer.ts";
import { resolveUserKey } from "../../lib/serverIdentity.ts";
import { JOURNAL_STORAGE_KEY, parseJournal } from "../../lib/tradingJournal.ts";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
type Dependencies = { getDatabase: typeof getDb; identifyUser: typeof resolveUserKey; now: () => string };
const defaults: Dependencies = { getDatabase: getDb, identifyUser: resolveUserKey, now: () => new Date().toISOString() };
const error = (message: string, status: number, code: string) => Response.json({ error: message, code }, { status, headers });

export function createAccountDataHandlers(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  async function GET(request: Request) {
    try {
      const userId = await dependencies.identifyUser(request);
      if (!userId) return error("请先登录", 401, "UNAUTHENTICATED");
      const expected = new URL(request.url).searchParams.get("userId");
      if (expected && expected !== userId) return error("登录账号已变化，请重新加载", 401, "ACCOUNT_CHANGED");
      const db = await dependencies.getDatabase();
      const rows = await db.select().from(accountData).where(eq(accountData.userKey, userId));
      return Response.json({ userId, entries: rows.map(({ key, value, revision, mutationId }) => ({ key, value, revision, mutationId })) }, { headers });
    } catch {
      return error("账户数据暂不可用，请稍后重试", 503, "ACCOUNT_DATA_UNAVAILABLE");
    }
  }
  async function PUT(request: Request) {
    if (!isSameOriginRequest(request)) {
      return error("不允许跨站保存账户数据", 403, "INVALID_ORIGIN");
    }
    try {
      const userId = await dependencies.identifyUser(request);
      if (!userId) return error("请先登录", 401, "UNAUTHENTICATED");
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > accountDataMaxBytes + 4096) return error("账户数据超过保存上限", 413, "PAYLOAD_TOO_LARGE");
      let input: AccountDataWrite;
      try { input = JSON.parse(raw); } catch { return error("请求格式无效", 400, "INVALID_ACCOUNT_DATA"); }
      if (!input || input.userId !== userId) return error("登录账号已变化，请重新加载", 401, "ACCOUNT_CHANGED");
      if (!isAccountDataKey(input.key) || (input.value !== null && typeof input.value !== "string") ||
        !Number.isSafeInteger(input.revision) || input.revision < 0 || typeof input.mutationId !== "string" ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(input.mutationId)) return error("账户数据格式无效", 400, "INVALID_ACCOUNT_DATA");
      if (input.value !== null && new TextEncoder().encode(input.value).byteLength > accountDataMaxBytes) return error("账户数据超过保存上限", 413, "PAYLOAD_TOO_LARGE");
      if (input.key === JOURNAL_STORAGE_KEY && input.value !== null) {
        try { parseJournal(input.value); } catch {
          // Keep the existing journal intact and avoid echoing private journal text in errors.
          return error("复盘数据格式无效，原有记录未被修改", 400, "INVALID_JOURNAL_DATA");
        }
      }
      const db = await dependencies.getDatabase();
      const predicate = and(eq(accountData.userKey, userId), eq(accountData.key, input.key));
      const values = { value: input.value, revision: input.revision + 1, mutationId: input.mutationId, updatedAt: dependencies.now() };
      const changed = input.revision === 0
        ? await db.insert(accountData).values({ userKey: userId, key: input.key, ...values }).onConflictDoNothing().returning()
        : await db.update(accountData).set(values).where(and(predicate, eq(accountData.revision, input.revision))).returning();
      let row = changed[0];
      if (!row) {
        [row] = await db.select().from(accountData).where(predicate).limit(1);
        // Retrying a request whose response was lost must not create a false conflict.
        if (!row || row.mutationId !== input.mutationId || row.value !== input.value) {
          return error("这项数据已在其他窗口修改，当前编辑未覆盖数据库。请备份编辑后重新加载并合并。", 409, "ACCOUNT_DATA_CONFLICT");
        }
      }
      return Response.json({ userId, entry: { key: row.key, value: row.value, revision: row.revision, mutationId: row.mutationId } }, { headers });
    } catch {
      return error("账户数据保存失败，请重试", 503, "ACCOUNT_DATA_UNAVAILABLE");
    }
  }
  return { GET, PUT };
}
const handlers = createAccountDataHandlers();
export const GET = handlers.GET;
export const PUT = handlers.PUT;
