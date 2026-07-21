"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { parsePriceAlerts, parseWatchlist, type PriceAlert, type WatchlistItem } from "../lib/research";

const alertsStorageKey = "ticklens.price-alerts.v1";
const watchlistStorageKey = "ticklens.watchlist.v1";

type SyncStatus = "loading" | "synced" | "local" | "saving" | "error";
type PriceQuote = { code: string; name: string; price: number; date: string; time: string; marketStatus: string };

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [target, setTarget] = useState("");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const alertsRef = useRef<PriceAlert[]>([]);
  const checkingRef = useRef(false);

  useEffect(() => { alertsRef.current = alerts; }, [alerts]);

  useEffect(() => {
    let localAlerts: PriceAlert[] = [];
    let localWatchlist: WatchlistItem[] = [];
    try { localAlerts = parsePriceAlerts(JSON.parse(localStorage.getItem(alertsStorageKey) ?? "[]")); } catch { localStorage.removeItem(alertsStorageKey); }
    try { localWatchlist = parseWatchlist(JSON.parse(localStorage.getItem(watchlistStorageKey) ?? "[]")); } catch { localStorage.removeItem(watchlistStorageKey); }
    const frame = window.requestAnimationFrame(() => { setAlerts(localAlerts); setWatchlist(localWatchlist); });
    const controller = new AbortController();
    const loadCloud = async () => {
      try {
        const [alertResponse, stateResponse] = await Promise.all([
          fetch("/api/alerts", { cache: "no-store", signal: controller.signal }),
          fetch("/api/research-state", { cache: "no-store", signal: controller.signal }),
        ]);
        if (alertResponse.status === 401) { setSyncStatus("local"); return; }
        if (!alertResponse.ok) throw new Error("云端预警暂不可用");
        const alertBody = await alertResponse.json() as { alerts?: unknown };
        const cloudAlerts = parsePriceAlerts(alertBody.alerts);
        const resolvedAlerts = cloudAlerts.length || !localAlerts.length ? cloudAlerts : localAlerts;
        setAlerts(resolvedAlerts);
        if (!cloudAlerts.length && localAlerts.length) {
          const backfill = await fetch("/api/alerts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alerts: localAlerts }), signal: controller.signal });
          if (!backfill.ok) throw new Error("本机预警同步失败");
        }
        if (stateResponse.ok) {
          const stateBody = await stateResponse.json() as { state?: unknown };
          const state = stateBody.state && typeof stateBody.state === "object" ? stateBody.state as Record<string, unknown> : null;
          if (state) setWatchlist(parseWatchlist(state.watchlist));
        }
        setSyncStatus("synced");
      } catch (reason) {
        if ((reason as { name?: string })?.name !== "AbortError") setSyncStatus("local");
      }
    };
    void loadCloud();
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, []);

  const persistAlerts = useCallback(async (next: PriceAlert[]) => {
    setAlerts(next);
    try { localStorage.setItem(alertsStorageKey, JSON.stringify(next)); } catch { /* in-memory mode remains available */ }
    setSyncStatus("saving");
    try {
      const response = await fetch("/api/alerts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alerts: next }) });
      if (response.status === 401) { setSyncStatus("local"); return; }
      if (!response.ok) throw new Error("保存失败");
      setSyncStatus("synced");
    } catch { setSyncStatus("local"); }
  }, []);

  const checkList = useCallback(async (source: PriceAlert[], options?: { silent?: boolean }) => {
    const active = source.filter((item) => !item.triggeredAt);
    if (!active.length) { if (!options?.silent) setMessage("还没有需要检查的生效预警。"); return; }
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    if (!options?.silent) setMessage("");
    try {
      const codes = [...new Set(active.map((item) => item.code))];
      const response = await fetch("/api/alert-prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codes }), cache: "no-store" });
      const body = await response.json() as { quotes?: PriceQuote[]; error?: string };
      if (!response.ok) throw new Error(body.error || "实时行情暂不可用");
      const quotes = new Map((body.quotes ?? []).filter((quote) => Number.isFinite(quote.price)).map((quote) => [quote.code, quote]));
      if (!quotes.size) throw new Error("实时行情暂未返回有效价格");
      const checkedAt = new Date().toISOString();
      const newlyTriggered: PriceAlert[] = [];
      const next = source.map((alert) => {
        const quote = quotes.get(alert.code);
        if (!quote) return alert;
        const matched = !alert.triggeredAt && (alert.direction === "above" ? quote.price >= alert.target : quote.price <= alert.target);
        const updated = { ...alert, name: alert.name === alert.code && quote.name ? quote.name : alert.name, lastPrice: quote.price, lastCheckedAt: checkedAt, triggeredAt: matched ? checkedAt : alert.triggeredAt };
        if (matched) newlyTriggered.push(updated);
        return updated;
      });
      await persistAlerts(next);
      const unavailable = Math.max(0, codes.length - quotes.size);
      if (!options?.silent || newlyTriggered.length) {
        setMessage(`已用实时行情更新 ${quotes.size} 只股票${unavailable ? `，${unavailable} 只暂未返回价格` : ""}${newlyTriggered.length ? `，新触发 ${newlyTriggered.length} 条预警` : "，暂未触发新预警"}。`);
      }
      if (newlyTriggered.length && "Notification" in window && Notification.permission === "granted") {
        new Notification("TickLens 行情预警", { body: newlyTriggered.map((item) => `${item.name} ${item.direction === "above" ? "突破" : "跌破"} ${item.target.toFixed(3)}`).join("；") });
      }
    } catch (reason) {
      if (!options?.silent) setMessage(reason instanceof Error ? reason.message : "实时行情检查失败，请稍后重试。");
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [persistAlerts]);

  const addAlert = async () => {
    const normalizedCode = code.trim().replace(/^(?:sh|sz)/i, "").replace(/\.(?:sh|sz)$/i, "");
    const priceTarget = Number(target);
    if (!/^\d{6}$/.test(normalizedCode)) { setMessage("请输入有效的 6 位沪深 A 股代码。"); return; }
    if (!Number.isFinite(priceTarget) || priceTarget <= 0) { setMessage("请输入有效的目标价格。"); return; }
    if (alerts.length >= 30) { setMessage("最多保留 30 条预警，请先删除不再需要的记录。"); return; }
    const resolvedName = name.trim() || normalizedCode;
    const next: PriceAlert[] = [{
      id: crypto.randomUUID?.() ?? `${normalizedCode}-${Date.now()}`,
      code: normalizedCode,
      name: resolvedName,
      direction,
      target: priceTarget,
      createdAt: new Date().toISOString(),
      triggeredAt: "",
      lastPrice: null,
      lastCheckedAt: "",
    }, ...alerts];
    setCode(""); setName(""); setTarget("");
    await persistAlerts(next);
    await checkList(next);
  };

  const activeAlerts = useMemo(() => alerts.filter((item) => !item.triggeredAt), [alerts]);
  const triggeredAlerts = useMemo(() => alerts.filter((item) => item.triggeredAt), [alerts]);
  const monitoredStocks = useMemo(() => new Set(alerts.map((item) => item.code)).size, [alerts]);
  const activeAlertKey = useMemo(() => activeAlerts.map((item) => `${item.id}:${item.direction}:${item.target}`).join("|"), [activeAlerts]);

  useEffect(() => {
    if (!activeAlertKey) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkList(alertsRef.current, { silent: true });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [activeAlertKey, checkList]);

  const enableNotifications = async () => {
    if (!("Notification" in window)) { setMessage("当前浏览器不支持系统通知。"); return; }
    const permission = await Notification.requestPermission();
    setMessage(permission === "granted" ? "浏览器通知已开启。" : "未获得通知权限，预警仍会保留在页面中。");
  };

  return (
    <main className="monitor-page-shell">
      <header className="monitor-topbar">
        <div className="monitor-brand"><span>TL</span><div><p className="eyebrow">MARKET MONITOR</p><h1>行情监控</h1></div></div>
        <nav><Link href="/">返回当前股票研究</Link><button type="button" onClick={() => void enableNotifications()}>开启浏览器通知</button><button type="button" className="monitor-primary-action" disabled={checking || !activeAlerts.length} onClick={() => void checkList(alerts)}>{checking ? "检查中…" : "立即检查全部"}</button></nav>
      </header>

      <section className="monitor-intro">
        <div><p className="eyebrow">SEPARATE WORKSPACE</p><h2>跨股票预警集中管理</h2><p>当前股票研究与行情提醒已经分离。这里专门维护价格突破、跌破和触发记录。</p></div>
        <span className={`monitor-sync is-${syncStatus}`}>{syncLabel(syncStatus)}</span>
      </section>

      <section className="monitor-summary-grid" aria-label="行情监控摘要">
        <MonitorMetric label="监控股票" value={String(monitoredStocks)} note="按股票代码去重" />
        <MonitorMetric label="生效预警" value={String(activeAlerts.length)} note="等待价格条件触发" />
        <MonitorMetric label="已触发" value={String(triggeredAlerts.length)} note="保留历史触发时间" />
        <MonitorMetric label="最近检查" value={latestCheck(alerts)} note="实时价格 · 每 10 秒自动检查" />
      </section>

      {message ? <p className="monitor-message" role="status">{message}</p> : null}

      <section className="monitor-workspace">
        <aside className="monitor-create-card">
          <header><div><p className="eyebrow">NEW ALERT</p><h3>创建价格预警</h3></div><span>{alerts.length}/30</span></header>
          {watchlist.length ? <div className="monitor-shortcuts"><span>从监控列表选择</span><div>{watchlist.slice(0, 12).map((item) => <button key={item.code} type="button" onClick={() => { setCode(item.code); setName(item.name); setTarget(item.price?.toFixed(3) ?? ""); }}>{item.name}<small>{item.code}</small></button>)}</div></div> : null}
          <div className="monitor-form">
            <label>股票代码<input value={code} inputMode="numeric" maxLength={8} placeholder="例如 000001" onChange={(event) => setCode(event.target.value)} /></label>
            <label>股票名称（可选）<input value={name} maxLength={40} placeholder="自动识别" onChange={(event) => setName(event.target.value)} /></label>
            <label>触发条件<select value={direction} onChange={(event) => setDirection(event.target.value as "above" | "below")}><option value="above">价格突破</option><option value="below">价格跌破</option></select></label>
            <label>目标价格<input value={target} inputMode="decimal" placeholder="0.000" onChange={(event) => setTarget(event.target.value)} /></label>
            <button type="button" className="monitor-primary-action" disabled={checking} onClick={() => void addAlert()}>添加并立即检查</button>
          </div>
          <p>价格以实时行情核验，页面保持打开时每 10 秒自动检查。数据仅供研究参考，不构成交易指令。</p>
        </aside>

        <section className="monitor-table-card">
          <header><div><p className="eyebrow">ALERT QUEUE</p><h3>预警队列</h3></div><div className="monitor-table-filters"><span>{activeAlerts.length} 生效</span><span>{triggeredAlerts.length} 已触发</span></div></header>
          <div className="monitor-table-wrap">
            <table className="monitor-alert-table">
              <colgroup><col className="col-stock"/><col className="col-condition"/><col className="col-price"/><col className="col-status"/><col className="col-time"/><col className="col-action"/></colgroup>
              <thead><tr><th>股票</th><th>条件</th><th>最新价格</th><th>状态</th><th>最近检查</th><th>操作</th></tr></thead>
              <tbody>{alerts.map((alert) => <tr key={alert.id}>
                <td><Link href={`/?stock=${alert.code}`}><strong>{alert.name}</strong><small>{alert.code}</small></Link></td>
                <td><span>{alert.direction === "above" ? "突破" : "跌破"}</span><strong>{alert.target.toFixed(3)}</strong></td>
                <td>{formatPrice(alert.lastPrice)}</td>
                <td><span className={`alert-status ${alert.triggeredAt ? "is-triggered" : "is-active"}`}>{alert.triggeredAt ? "已触发" : "监控中"}</span></td>
                <td>{formatTime(alert.triggeredAt || alert.lastCheckedAt || alert.createdAt)}</td>
                <td><button type="button" onClick={() => { setMessage("预警已删除。"); void persistAlerts(alerts.filter((item) => item.id !== alert.id)); }}>删除</button></td>
              </tr>)}</tbody>
            </table>
            {!alerts.length ? <div className="monitor-empty"><strong>还没有价格预警</strong><p>从左侧输入股票与目标价格，预警会整齐显示在这里。</p></div> : null}
          </div>
        </section>
      </section>
    </main>
  );
}

function MonitorMetric({ label, value, note }: { label: string; value: string; note: string }) { return <article><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function syncLabel(status: SyncStatus) { return status === "synced" ? "云端已同步" : status === "saving" ? "正在保存" : status === "loading" ? "正在连接" : status === "local" ? "本机模式" : "同步异常"; }
function formatPrice(value: number | null | undefined) { return value == null || !Number.isFinite(value) ? "—" : value.toFixed(3); }
function formatTime(value: string | undefined) { if (!value) return "尚未检查"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false }); }
function latestCheck(alerts: PriceAlert[]) { const latest = alerts.map((item) => item.lastCheckedAt || item.triggeredAt).filter(Boolean).sort().at(-1); if (!latest) return "—"; const date = new Date(latest); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }); }
