"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { authRequest, type AuthUser } from "../lib/authClient";
import { requiresAccount } from "../lib/accessPolicy";
import { clearAccountStorage, exportPendingAccountStorage, flushAccountStorage, getAccountStorageStatus, hydrateAccountStorage, retryAccountStorage, subscribeAccountStorage } from "../lib/accountStorage";
import styles from "./Auth.module.css";

type AuthStatus = "loading" | "authenticated" | "guest" | "error";
type SyncStatus = "idle" | "loading" | "ready" | "saving" | "error";
type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
  refresh: (force?: boolean) => Promise<AuthUser | null>;
  logout: () => Promise<void>;
  syncStatus: SyncStatus;
  syncError: string | null;
  retrySync: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export default function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const requestRef = useRef<Promise<AuthUser | null> | null>(null);
  const generationRef = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const logoutRedirectRef = useRef(false);
  const [recoveries, setRecoveries] = useState(new Map<string, string>());
  const needsLogin = status === "guest" && requiresAccount(pathname ?? "/");

  useEffect(() => {
    if (!needsLogin) return;
    const destination = logoutRedirectRef.current ? "/" : `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    logoutRedirectRef.current = false;
    router.replace(destination);
  }, [needsLogin, pathname, router]);

  const preservePending = useCallback(() => {
    const state = getAccountStorageStatus();
    if (state.userId && state.pending > 0) {
      const userId = state.userId;
      const contents = exportPendingAccountStorage();
      setRecoveries((current) => new Map(current).set(userId, contents));
    }
  }, []);

  const refresh = useCallback((force = false): Promise<AuthUser | null> => {
    if (force) {
      generationRef.current += 1;
      requestRef.current = null;
    }
    if (requestRef.current) return requestRef.current;
    const generation = generationRef.current;
    const task = (async () => {
      try {
        const { user: next } = await authRequest<{ user: AuthUser | null }>("/api/auth/me");
        if (generation !== generationRef.current) return userRef.current;
        const changed = userRef.current?.id !== next?.id;
        if (changed || getAccountStorageStatus().userId !== (next?.id ?? null)) {
          const pending = getAccountStorageStatus().pending;
          setStatus("loading");
          setUser(null);
          if (pending > 0) setNotice("账号状态已变化，未同步的更改未能保存。请登录原账号后确认数据。");
          preservePending();
          clearAccountStorage();
          if (next) await hydrateAccountStorage(next.id);
          if (generation !== generationRef.current) return userRef.current;
        }
        userRef.current = next;
        setUser(next);
        setStatus(next ? "authenticated" : "guest");
        setError(null);
        return next;
      } catch (reason) {
        if (generation !== generationRef.current) return userRef.current;
        const message = reason instanceof Error ? reason.message : "暂时无法加载账号，请重试。";
        setError(message);
        if (!userRef.current || getAccountStorageStatus().userId !== userRef.current.id) setStatus("error");
        throw reason;
      }
    })();
    requestRef.current = task;
    const clearRequest = () => { if (requestRef.current === task) requestRef.current = null; };
    void task.then(clearRequest, clearRequest);
    return task;
  }, [preservePending]);

  const logout = useCallback(async () => {
    await flushAccountStorage();
    await authRequest("/api/auth/logout", { method: "POST", body: "{}" });
    generationRef.current += 1;
    requestRef.current = null;
    clearAccountStorage();
    userRef.current = null;
    logoutRedirectRef.current = true;
    setUser(null);
    setStatus("guest");
    setError(null);
    setNotice(null);
    channelRef.current?.postMessage("session-changed");
  }, []);

  const retrySync = useCallback(async () => {
    await retryAccountStorage();
  }, []);

  const downloadBackup = useCallback((contents: string) => {
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `trendsight-unsaved-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const reloadRemote = useCallback(async () => {
    if (!userRef.current || !window.confirm("确定放弃此页面尚未同步的更改，并重新加载数据库中的数据？建议先下载备份。")) return;
    const current = userRef.current;
    generationRef.current += 1;
    requestRef.current = null;
    preservePending();
    setStatus("loading");
    userRef.current = null;
    setUser(null);
    clearAccountStorage();
    try {
      const reloaded = await refresh();
      if (reloaded?.id === current.id) setNotice("已重新加载数据库中的数据。");
    } catch { /* The full-page retry state handles failed reloads. */ }
  }, [preservePending, refresh]);

  useEffect(() => {
    const updateSync = () => {
      const state = getAccountStorageStatus();
      setSyncStatus(state.phase);
      setSyncError(state.error);
    };
    const unsubscribe = subscribeAccountStorage(updateSync);
    updateSync();
    void refresh().catch(() => {});
    const checkSession = () => {
      if (document.visibilityState === "visible") void refresh().catch(() => {});
    };
    const expireSession = () => {
      const pending = getAccountStorageStatus().pending;
      generationRef.current += 1;
      requestRef.current = null;
      preservePending();
      clearAccountStorage();
      userRef.current = null;
      setUser(null);
      setStatus("loading");
      setNotice(pending ? "登录状态已失效，未同步的更改未能保存。请重新登录后确认数据。" : "登录状态已变化，请重新登录以继续使用个人工作台。");
      void refresh().catch(() => {});
    };
    window.addEventListener("focus", checkSession);
    document.addEventListener("visibilitychange", checkSession);
    window.addEventListener("account-session-expired", expireSession);
    const interval = window.setInterval(checkSession, 60_000);
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("trendsight-auth");
      channelRef.current = channel;
      channel.onmessage = checkSession;
    }
    return () => {
      unsubscribe();
      window.removeEventListener("focus", checkSession);
      document.removeEventListener("visibilitychange", checkSession);
      window.removeEventListener("account-session-expired", expireSession);
      window.clearInterval(interval);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [preservePending, refresh]);

  const value = useMemo(() => ({ user, status, error, refresh, logout, syncStatus, syncError, retrySync }), [user, status, error, refresh, logout, syncStatus, syncError, retrySync]);
  return <AuthContext.Provider value={value}>
    {status === "loading" || status === "error" || needsLogin ? <main className={styles.sessionScreen}>
      <div className={styles.sessionCard} role={status === "error" ? "alert" : "status"}>
        <span className={styles.brandMark} aria-hidden="true" />
        <h1>{status === "error" ? "暂时无法加载工作台" : needsLogin ? "正在前往登录页面" : "正在打开你的工作台"}</h1>
        <p>{status === "error" ? error : needsLogin ? "登录后即可继续使用个人工作台。" : "正在确认登录状态并同步账号数据…"}</p>
        {status === "error" && <button className={styles.primaryButton} onClick={() => { setStatus("loading"); void refresh().catch(() => {}); }}>重新加载</button>}
      </div>
    </main> : <Fragment key={user?.id ?? "guest"}>{children}</Fragment>}
    {notice && !(user && (syncStatus === "error" || recoveries.has(user.id))) && <div className={styles.syncNotice} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div>}
    {user && syncStatus === "error" && <div className={styles.syncNotice} role="alert"><span>{syncError || "数据尚未保存到数据库，请重试。"}</span><button type="button" onClick={() => void retrySync().catch(() => {})}>重新同步</button>{getAccountStorageStatus().pending > 0 && <><button type="button" onClick={() => downloadBackup(exportPendingAccountStorage())}>下载未保存备份</button><button type="button" onClick={() => void reloadRemote()}>放弃更改并重新加载</button></>}</div>}
    {user && syncStatus !== "error" && recoveries.has(user.id) && <div className={styles.syncNotice} role="status"><span>此账号有一份未同步更改的临时备份，请在关闭页面前下载。</span><button type="button" onClick={() => downloadBackup(recoveries.get(user.id)!)}>下载备份</button><button type="button" onClick={() => setRecoveries((current) => { const next = new Map(current); next.delete(user.id); return next; })}>关闭</button></div>}
  </AuthContext.Provider>;

}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
