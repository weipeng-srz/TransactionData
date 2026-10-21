import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { authRateLimits, authSessions, users } from "../../db/schema.ts";

type AuthDatabase = Awaited<ReturnType<typeof getDb>>;
type UserRow = typeof users.$inferSelect;
export type AuthUser = Pick<UserRow, "id" | "email" | "displayName" | "bio" | "createdAt" | "updatedAt">;
type AuthDependencies = {
  getDatabase: () => Promise<AuthDatabase>;
  now: () => number;
  logServiceError: (reason: unknown) => void;
};
const defaults: AuthDependencies = {
  getDatabase: getDb,
  now: Date.now,
  logServiceError: (reason) => console.error(`[auth] service failed (${reason instanceof Error ? reason.name : typeof reason})`),
};
const cookieName = "ts_session";
const sessionSeconds = 30 * 24 * 60 * 60;
const noStoreHeaders = { "Cache-Control": "no-store", Vary: "Cookie" };
const scryptOptions = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };

class AuthError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "INVALID_INPUT") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function publicUser(user: UserRow): AuthUser {
  return { id: user.id, email: user.email, displayName: user.displayName, bio: user.bio, createdAt: user.createdAt, updatedAt: user.updatedAt };
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(bytes).toString("hex");
}

function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, scryptOptions, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await derivePassword(password, salt);
  return `scrypt$16384$8$5$${salt}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts.slice(0, 4).join("$") !== "scrypt$16384$8$5" || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const expected = Buffer.from(parts[5], "hex");
  return timingSafeEqual(await derivePassword(password, parts[4]), expected);
}

function sessionToken(request: Request): string | null {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

async function readAuthenticatedUser(request: Request, db: AuthDatabase, now: number): Promise<UserRow | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const [row] = await db.select({ user: users }).from(authSessions).innerJoin(users, and(
    eq(users.id, authSessions.userId), eq(users.sessionVersion, authSessions.sessionVersion),
  )).where(and(eq(authSessions.tokenHash, await digest(token)), gt(authSessions.expiresAt, now))).limit(1);
  return row?.user ?? null;
}

export async function getAuthenticatedUser(request: Request): Promise<AuthUser | null> {
  if (!sessionToken(request)) return null;
  const user = await readAuthenticatedUser(request, await getDb(), Date.now());
  return user ? publicUser(user) : null;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "cross-site";
  } catch { return false; }
}

function cookie(request: Request, token: string, seconds = sessionSeconds): string {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

function json(value: unknown, status = 200, sessionCookie?: string): Response {
  return Response.json(value, { status, headers: { ...noStoreHeaders, ...(sessionCookie ? { "Set-Cookie": sessionCookie } : {}) } });
}

async function inputBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new AuthError("请求体必须为 JSON", 415);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 8192) throw new AuthError("请求内容过长", 413);
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new AuthError("请求体必须为有效的 JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AuthError("请求内容无效");
  return parsed as Record<string, unknown>;
}

function emailInput(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("请输入有效的邮箱地址");
  return email;
}

function passwordInput(value: unknown, strong = true): string {
  if (typeof value !== "string" || value.length > 128 || value.length < (strong ? 8 : 1)) throw new AuthError(strong ? "密码须为 8–128 个字符，并包含字母和数字" : "请输入当前密码");
  if (strong && (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value))) throw new AuthError("密码须包含字母和数字");
  return value;
}

function nameInput(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 40) throw new AuthError("昵称须为 1–40 个字符");
  return name;
}

function bioInput(value: unknown): string {
  if (typeof value !== "string" || value.trim().length > 500) throw new AuthError("个人简介不能超过 500 个字符");
  return value.trim();
}

async function consumeRateLimit(db: AuthDatabase, action: string, subject: string, limit: number, now: number, windowMs = 15 * 60 * 1000) {
  const bucket = Math.floor(now / windowMs);
  const key = await digest(`${action}:${subject}:${bucket}`);
  const [row] = await db.insert(authRateLimits).values({ key, count: 1, expiresAt: (bucket + 1) * windowMs })
    .onConflictDoUpdate({ target: authRateLimits.key, set: { count: sql`${authRateLimits.count} + 1` } }).returning({ count: authRateLimits.count });
  if (row.count > limit) throw new AuthError("操作过于频繁，请稍后重试", 429, "RATE_LIMITED");
}

async function createSession(db: AuthDatabase, user: UserRow, now: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(authSessions).values({ tokenHash: await digest(token), userId: user.id, sessionVersion: user.sessionVersion, createdAt: new Date(now).toISOString(), expiresAt: now + sessionSeconds * 1000 });
  return token;
}

export function createAuthHandlers(overrides: Partial<AuthDependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };

  function protect(handler: (request: Request, db: AuthDatabase, now: number) => Promise<Response>, mutation = true) {
    return async (request: Request): Promise<Response> => {
      try {
        if (mutation && !isSameOriginRequest(request)) throw new AuthError("请求来源无效，请刷新页面后重试", 403, "INVALID_ORIGIN");
        return await handler(request, await dependencies.getDatabase(), dependencies.now());
      } catch (reason) {
        if (reason instanceof AuthError) return json({ error: reason.message, code: reason.code }, reason.status);
        dependencies.logServiceError(reason);
        return json({ error: "账户服务暂不可用，请稍后重试", code: "AUTH_UNAVAILABLE" }, 503);
      }
    };
  }

  async function requireUser(request: Request, db: AuthDatabase, now: number): Promise<UserRow> {
    const user = await readAuthenticatedUser(request, db, now);
    if (!user) throw new AuthError("请先登录", 401, "UNAUTHENTICATED");
    return user;
  }

  const register = protect(async (request, db, now) => {
    const input = await inputBody(request);
    const email = emailInput(input.email);
    const displayName = nameInput(input.displayName);
    const password = passwordInput(input.password);
    await consumeRateLimit(db, "register", request.headers.get("cf-connecting-ip") ?? "unknown", 10, now, 60 * 60 * 1000);
    const timestamp = new Date(now).toISOString();
    const [user] = await db.insert(users).values({ id: crypto.randomUUID(), email, displayName, passwordHash: await hashPassword(password), createdAt: timestamp, updatedAt: timestamp })
      .onConflictDoNothing({ target: users.email }).returning();
    if (!user) throw new AuthError("该邮箱已注册，请直接登录", 409, "EMAIL_IN_USE");
    const token = await createSession(db, user, now);
    return json({ user: publicUser(user) }, 201, cookie(request, token));
  });

  const login = protect(async (request, db, now) => {
    const input = await inputBody(request);
    const email = emailInput(input.email);
    const password = passwordInput(input.password, false);
    await consumeRateLimit(db, "login-ip", request.headers.get("cf-connecting-ip") ?? "unknown", 60, now);
    await consumeRateLimit(db, "login-email", email, 10, now);
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    // Unknown accounts incur the same KDF cost as invalid passwords.
    let valid = false;
    if (user) valid = await verifyPassword(password, user.passwordHash);
    else await derivePassword(password, "00000000000000000000000000000000");
    if (!user || !valid) throw new AuthError("邮箱或密码不正确", 401, "INVALID_CREDENTIALS");
    await db.delete(authSessions).where(lt(authSessions.expiresAt, now));
    await db.delete(authRateLimits).where(lt(authRateLimits.expiresAt, now));
    const token = await createSession(db, user, now);
    return json({ user: publicUser(user) }, 200, cookie(request, token));
  });

  const authenticatedMe = protect(async (request, db, now) => {
    const user = await readAuthenticatedUser(request, db, now);
    return json({ user: user ? publicUser(user) : null });
  }, false);

  async function me(request: Request): Promise<Response> {
    if (!sessionToken(request)) return json({ user: null });
    return authenticatedMe(request);
  }

  const logout = protect(async (request, db) => {
    const token = sessionToken(request);
    if (token) await db.delete(authSessions).where(eq(authSessions.tokenHash, await digest(token)));
    return json({ ok: true }, 200, cookie(request, "", 0));
  });

  const profile = protect(async (request, db, now) => {
    const user = await requireUser(request, db, now);
    const input = await inputBody(request);
    if (input.userId !== user.id) throw new AuthError("登录账号已变化，请重新加载", 401, "ACCOUNT_CHANGED");
    const email = input.email === undefined ? user.email : emailInput(input.email);
    const displayName = input.displayName === undefined ? user.displayName : nameInput(input.displayName);
    const bio = input.bio === undefined ? user.bio : bioInput(input.bio);
    if (email !== user.email) {
      await consumeRateLimit(db, "profile-password", user.id, 10, now);
      if (!await verifyPassword(passwordInput(input.currentPassword, false), user.passwordHash)) throw new AuthError("当前密码不正确", 400, "INVALID_PASSWORD");
    }
    let updated: UserRow | undefined;
    try {
      [updated] = await db.update(users).set({ email, displayName, bio, updatedAt: new Date(now).toISOString() }).where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash))).returning();
    } catch (reason) {
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing && existing.id !== user.id) throw new AuthError("该邮箱已被使用", 409, "EMAIL_IN_USE");
      throw reason;
    }
    if (!updated) throw new AuthError("账户已更新，请重新登录", 401, "UNAUTHENTICATED");
    return json({ user: publicUser(updated) });
  });

  const password = protect(async (request, db, now) => {
    const user = await requireUser(request, db, now);
    const input = await inputBody(request);
    if (input.userId !== user.id) throw new AuthError("登录账号已变化，请重新加载", 401, "ACCOUNT_CHANGED");
    const currentPassword = passwordInput(input.currentPassword, false);
    const newPassword = passwordInput(input.newPassword);
    await consumeRateLimit(db, "change-password", user.id, 10, now);
    if (!await verifyPassword(currentPassword, user.passwordHash)) throw new AuthError("当前密码不正确", 400, "INVALID_PASSWORD");
    if (currentPassword === newPassword) throw new AuthError("新密码不能与当前密码相同");
    const [updated] = await db.update(users).set({ passwordHash: await hashPassword(newPassword), sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date(now).toISOString() })
      .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash))).returning();
    if (!updated) throw new AuthError("密码已更新，请重新登录", 401, "UNAUTHENTICATED");
    await db.delete(authSessions).where(and(eq(authSessions.userId, user.id), lt(authSessions.sessionVersion, updated.sessionVersion)));
    const token = await createSession(db, updated, now);
    return json({ user: publicUser(updated) }, 200, cookie(request, token));
  });

  return { register, login, logout, me, profile, password };
}

export const authHandlers = createAuthHandlers();
