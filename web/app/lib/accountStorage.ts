import { accountDataMaxBytes, isAccountDataKey, type AccountDataEntry, type AccountDataWrite } from "./accountData.ts";

export type AccountStorageStatus = {
  userId: string | null;
  phase: "idle" | "loading" | "ready" | "saving" | "error";
  pending: number;
  error: string | null;
};
type Pending = { value: string | null; mutationId: string };
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Explicit in-memory facade. Never reads or writes shared browser storage. */
export function createAccountStorageClient(fetcher: Fetcher = (input, init) => fetch(input, init)) {
  let status: AccountStorageStatus = { userId: null, phase: "idle", pending: 0, error: null };
  let generation = 0;
  let entries = new Map<string, AccountDataEntry>();
  let pending = new Map<string, Pending>();
  let active: Promise<void> | null = null;
  let scheduled = false;
  let unresolved: { key: string; change: Pending; input: AccountDataWrite } | null = null;
  const listeners = new Set<() => void>();
  const changeListeners = new Set<(key: string) => void>();
  function publish(phase: AccountStorageStatus["phase"], error: string | null = null) {
    status = { ...status, phase, pending: pending.size, error };
    for (const listener of listeners) listener();
  }
  function clear() {
    generation += 1;
    entries = new Map(); pending = new Map(); active = null; scheduled = false; unresolved = null;
    status = { userId: null, phase: "idle", pending: 0, error: null };
    for (const listener of listeners) listener();
  }
  async function responseBody(response: Response, epoch: number) {
    const body = await response.json() as { userId?: string; entries?: AccountDataEntry[]; entry?: AccountDataEntry; error?: string };
    if (!response.ok) {
      if (epoch === generation && response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("account-session-expired"));
      throw new Error(body.error || "账户数据保存失败，请重试");
    }
    return body;
  }
  async function hydrate(userId: string) {
    clear();
    const epoch = generation;
    status = { ...status, userId };
    publish("loading");
    try {
      const body = await responseBody(await fetcher(`/api/account-data?userId=${encodeURIComponent(userId)}`, { credentials: "same-origin", cache: "no-store" }), epoch);
      if (epoch !== generation) return;
      if (body.userId !== userId || !Array.isArray(body.entries)) throw new Error("账户数据身份不匹配，请重新登录");
      for (const entry of body.entries) {
        if (!isAccountDataKey(entry.key) || (entry.value !== null && typeof entry.value !== "string") || !Number.isSafeInteger(entry.revision) || entry.revision < 1) throw new Error("账户数据格式异常，请重试");
        entries.set(entry.key, entry);
      }
      publish("ready");
    } catch (reason) {
      if (epoch !== generation) return;
      entries.clear();
      publish("error", reason instanceof Error ? reason.message : "账户数据加载失败，请重试");
      throw reason;
    }
  }
  function write(key: string, value: string | null) {
    // Guests can query stocks, but never create personal persistent data.
    if (!status.userId) return;
    if (status.phase === "loading") throw new Error("账户数据正在加载");
    if (!isAccountDataKey(key)) throw new Error("不支持的账户数据类型");
    if (value !== null && new TextEncoder().encode(value).byteLength > accountDataMaxBytes) throw new Error("账户数据超过保存上限");
    const current = pending.has(key) ? pending.get(key)!.value : entries.get(key)?.value ?? null;
    if (current === value) return;
    pending.set(key, { value, mutationId: crypto.randomUUID() });
    publish("saving");
    for (const listener of changeListeners) listener(key);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => { scheduled = false; void flush().catch(() => {}); });
    }
  }
  function flush(): Promise<void> {
    if (active) return active;
    if (!status.userId || !pending.size) return Promise.resolve();
    const epoch = generation;
    const userId = status.userId;
    publish("saving");
    const task = (async () => {
      try {
        while (pending.size && epoch === generation) {
          if (!unresolved) {
            const [key, change] = pending.entries().next().value!;
            unresolved = { key, change, input: { userId, key, ...change, revision: entries.get(key)?.revision ?? 0 } };
          }
          const { key, change, input } = unresolved;
          const body = await responseBody(await fetcher("/api/account-data", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }), epoch);
          if (epoch !== generation) return;
          if (body.userId !== userId || !body.entry || body.entry.key !== key || body.entry.mutationId !== change.mutationId || body.entry.value !== change.value || !Number.isSafeInteger(body.entry.revision) || body.entry.revision <= input.revision) throw new Error("账户保存结果无效，请重试");
          unresolved = null;
          entries.set(key, body.entry);
          if (pending.get(key) === change) pending.delete(key);
          publish(pending.size ? "saving" : "ready");
        }
      } catch (reason) {
        if (epoch !== generation) return;
        publish("error", reason instanceof Error ? reason.message : "账户数据保存失败，请重试");
        throw reason;
      }
    })();
    active = task;
    const release = () => { if (epoch === generation && active === task) active = null; };
    void task.then(release, release);
    return task;
  }
  return {
    storage: {
      getItem(key: string): string | null { return pending.has(key) ? pending.get(key)!.value : entries.get(key)?.value ?? null; },
      setItem(key: string, value: string) { write(key, value); },
      removeItem(key: string) { write(key, null); },
    },
    hydrate, clear, flush,
    getStatus: () => status,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeChanges(listener: (key: string) => void) { changeListeners.add(listener); return () => { changeListeners.delete(listener); }; },
    exportPending: () => JSON.stringify({ userId: status.userId, entries: [...pending].map(([key, change]) => ({ key, value: change.value })) }, null, 2),
  };
}

const client = createAccountStorageClient();
export const accountStorage = client.storage;
export const hydrateAccountStorage = client.hydrate;
export const clearAccountStorage = client.clear;
export const flushAccountStorage = client.flush;
export const retryAccountStorage = client.flush;
export const subscribeAccountStorage = client.subscribe;
export const subscribeAccountStorageChanges = client.subscribeChanges;
export const getAccountStorageStatus = client.getStatus;
export const exportPendingAccountStorage = client.exportPending;

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (!getAccountStorageStatus().pending) return;
    event.preventDefault(); event.returnValue = "";
  });
  window.addEventListener("online", () => { void flushAccountStorage().catch(() => {}); });
}
