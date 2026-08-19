import { eq } from "drizzle-orm";
import { getDb } from "../../../db/index.ts";
import { researchStates } from "../../../db/schema.ts";
import { cnStockCodePattern, isUSStockSymbol, normalizeUSSymbol } from "../../lib/security.ts";
import { resolveUserKey } from "../../lib/serverIdentity.ts";

const maxPayloadBytes = 96 * 1024;
const noStoreHeaders = { "Cache-Control": "no-store" };

type ResearchStateDatabase = Awaited<ReturnType<typeof getDb>>;
type ResearchStateOperation = "read" | "write";
type ResearchStateDependencies = {
  getDatabase: () => Promise<ResearchStateDatabase>;
  identifyUser: (request: Request) => Promise<string | null>;
  now: () => string;
  logServiceError: (operation: ResearchStateOperation, reason: unknown) => void;
};

const defaultDependencies: ResearchStateDependencies = {
  getDatabase: getDb,
  identifyUser: resolveUserKey,
  now: () => new Date().toISOString(),
  logServiceError: (operation, reason) => {
    const category = reason instanceof Error ? reason.name : typeof reason;
    console.error(`[research-state] ${operation} failed (${category})`);
  },
};

export function createResearchStateHandlers(overrides: Partial<ResearchStateDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };

  async function get(request: Request) {
    let userKey: string | null;
    try {
      userKey = await dependencies.identifyUser(request);
    } catch (reason) {
      return dbError("read", reason, dependencies.logServiceError);
    }
    if (!userKey) return Response.json({ error: "当前访问没有可用的用户身份" }, { status: 401, headers: noStoreHeaders });

    try {
      const db = await dependencies.getDatabase();
      const [row] = await db.select().from(researchStates).where(eq(researchStates.userKey, userKey)).limit(1);
      const storedState = row ? safeParse(row.payload) : null;
      const state = sanitizeStoredState(storedState);
      if (row && hasStoredHoldings(storedState)) {
        await db.update(researchStates).set({ payload: JSON.stringify(state) }).where(eq(researchStates.userKey, userKey));
      }
      return Response.json({ state, updatedAt: row?.updatedAt ?? "" }, { headers: noStoreHeaders });
    } catch (reason) {
      return dbError("read", reason, dependencies.logServiceError);
    }
  }

  async function put(request: Request) {
    let userKey: string | null;
    try {
      userKey = await dependencies.identifyUser(request);
    } catch (reason) {
      return dbError("write", reason, dependencies.logServiceError);
    }
    if (!userKey) return Response.json({ error: "当前访问没有可用的用户身份" }, { status: 401, headers: noStoreHeaders });

    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maxPayloadBytes) {
      return requestError("研究状态超过保存上限", 413);
    }

    let input: { state?: unknown };
    try {
      input = JSON.parse(body) as { state?: unknown };
    } catch {
      return requestError("请求体必须是有效的 JSON", 400);
    }

    let state: ReturnType<typeof sanitizeState>;
    try {
      state = sanitizeState(input.state);
    } catch {
      return requestError("研究状态格式无效", 400);
    }

    const payload = JSON.stringify(state);
    const updatedAt = dependencies.now();
    try {
      const db = await dependencies.getDatabase();
      await db.insert(researchStates).values({ userKey, payload, updatedAt }).onConflictDoUpdate({ target: researchStates.userKey, set: { payload, updatedAt } });
      return Response.json({ state, updatedAt }, { headers: noStoreHeaders });
    } catch (reason) {
      return dbError("write", reason, dependencies.logServiceError);
    }
  }

  return { GET: get, PUT: put };
}

const handlers = createResearchStateHandlers();

export async function GET(request: Request) {
  return handlers.GET(request);
}

export async function PUT(request: Request) {
  return handlers.PUT(request);
}

function sanitizeState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("研究状态格式无效");
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = { version: 4 };
  if (input.workspace && typeof input.workspace === "object") output.workspace = input.workspace;
  if (Array.isArray(input.annotations)) output.annotations = input.annotations.slice(0, 100);
  if (input.viewMode === "basic" || input.viewMode === "pro") output.viewMode = input.viewMode;
  if (typeof input.benchmarkCode === "string") {
    const benchmarkCode = input.benchmarkCode.trim();
    if (cnStockCodePattern.test(benchmarkCode)) output.benchmarkCode = benchmarkCode;
    else if (isUSStockSymbol(benchmarkCode)) output.benchmarkCode = normalizeUSSymbol(benchmarkCode);
  }
  return output;
}

function sanitizeStoredState(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const state = { ...(value as Record<string, unknown>) };
  delete state.holdings;
  return { ...state, version: 4 };
}

function hasStoredHoldings(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "holdings" in value);
}

function safeParse(value: string): unknown { try { return JSON.parse(value); } catch { return null; } }
function requestError(message: string, status: number): Response {
  return Response.json({ error: message, code: "INVALID_RESEARCH_STATE" }, { status, headers: noStoreHeaders });
}

function dbError(
  operation: ResearchStateOperation,
  reason: unknown,
  logServiceError: ResearchStateDependencies["logServiceError"],
): Response {
  logServiceError(operation, reason);
  return Response.json(
    { error: "研究状态服务暂不可用，请稍后重试", code: "RESEARCH_STATE_UNAVAILABLE" },
    { status: 503, headers: noStoreHeaders },
  );
}
