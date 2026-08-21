"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { parseWatchlist, upsertWatchlistStock, type WatchlistStock } from "../lib/watchlist";
import { isUSStockSymbol, marketLabel, marketOf, normalizeUSSymbol, stockRouteKey, stockStorageKey, type StockIdentity, type StockMarket } from "../lib/security";
import { publicStockLookupError } from "../lib/stockLookupError";
import styles from "./SiteBanner.module.css";

type BannerPage = "portfolio" | "stock" | "global" | "screener";
type Appearance = "light" | "dark";
type SearchPhase = "idle" | "opening" | "adding";

const watchlistStorageKey = "ticklens.watchlist.v1";

export default function SiteBanner({
  activePage,
  currentStockCode = "",
  currentStockMarket = "CN",
  statusText = "统一入口 · 快速研究",
  appearance,
  onToggleAppearance,
  onOpenStock,
  onAddStock,
  onOpenPortfolio,
}: {
  activePage: BannerPage;
  currentStockCode?: string;
  currentStockMarket?: StockMarket;
  statusText?: string;
  appearance: Appearance;
  onToggleAppearance: () => void;
  onOpenStock?: (code: string) => void;
  onAddStock?: (stock: WatchlistStock, existed: boolean) => void;
  onOpenPortfolio?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestion, setSuggestion] = useState<WatchlistStock | null>(null);
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [message, setMessage] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus({ preventScroll: true });
      }
      if (event.key === "Escape") {
        setSuggestion(null);
        setMessage("");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    const input = query.trim();
    if (input.length < 2 || phase !== "idle") {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const stock = await lookupStock(input, controller.signal);
        setSuggestion({ ...stock, addedAt: new Date().toISOString() });
      } catch {
        setSuggestion(null);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [phase, query]);

  const resolveStock = async (value = query) => {
    const input = value.trim();
    if (!input) throw new Error("请输入股票名称或代码");
    if (suggestion && (suggestion.code === normalizeUSSymbol(input) || suggestion.code === input || suggestion.name === input)) return suggestion;
    const stock = await lookupStock(input);
    return { ...stock, addedAt: new Date().toISOString() };
  };

  const openStock = async (value = query) => {
    setPhase("opening");
    setMessage("");
    try {
      const stock = await resolveStock(value);
      setQuery(`${stock.name} / ${stock.code}`);
      setSuggestion(null);
      const routeKey = stockRouteKey(stock);
      if (onOpenStock) onOpenStock(routeKey);
      else window.location.assign(`/?stock=${encodeURIComponent(routeKey)}`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "没有找到匹配的 A 股或美股");
    } finally {
      setPhase("idle");
    }
  };

  const addStock = async (value = query) => {
    setPhase("adding");
    setMessage("");
    try {
      const stock = await resolveStock(value);
      let current: WatchlistStock[] = [];
      try {
        current = parseWatchlist(JSON.parse(localStorage.getItem(watchlistStorageKey) ?? "[]"));
      } catch {
        localStorage.removeItem(watchlistStorageKey);
      }
      const existed = current.some((item) => stockStorageKey(item) === stockStorageKey(stock));
      localStorage.setItem(watchlistStorageKey, JSON.stringify(upsertWatchlistStock(current, stock)));
      window.dispatchEvent(new CustomEvent("ticklens:watchlist-change", { detail: stock }));
      onAddStock?.(stock, existed);
      setQuery("");
      setSuggestion(null);
      setMessage(existed ? `${stock.name} 已在自选中，并已置顶。` : `${stock.name} 已加入自选。`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "没有找到匹配的 A 股或美股");
    } finally {
      setPhase("idle");
    }
  };

  const globalHref = currentStockCode ? `/global-markets?stock=${encodeURIComponent(stockRouteKey({ code: currentStockCode, market: currentStockMarket }))}` : "/global-markets";
  const busy = phase !== "idle";
  const openPortfolioClick = activePage === "stock" && onOpenPortfolio ? (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onOpenPortfolio();
  } : undefined;

  return (
    <>
    <header className={styles.banner} data-site-banner>
      <Link className={styles.brand} href="/" aria-label="TrendSight 自选股首页" onClick={openPortfolioClick}>
        <span className={styles.brandMark} aria-hidden="true" />
        <span><strong>TrendSight</strong><small>市场研究工作台</small></span>
      </Link>

      <nav className={styles.navigation} aria-label="全站页面导航">
        <Link
          className={activePage === "portfolio" ? styles.activeNav : ""}
          href="/"
          aria-current={activePage === "portfolio" ? "page" : undefined}
          onClick={openPortfolioClick}
        >自选</Link>
        <Link className={activePage === "screener" ? styles.activeNav : ""} href="/screener" aria-current={activePage === "screener" ? "page" : undefined}>选股</Link>
        <Link className={activePage === "global" ? styles.activeNav : ""} href={globalHref} aria-current={activePage === "global" ? "page" : undefined}>全球</Link>
      </nav>

      <form className={styles.search} aria-label="快速搜索股票" onSubmit={(event) => { event.preventDefault(); void openStock(); }}>
        <div className={styles.searchField}>
          <span className={styles.searchIcon} aria-hidden="true">⌕</span>
          <label className={styles.srOnly} htmlFor={`site-stock-search-${activePage}`}>输入股票名称或代码</label>
          <input
            ref={searchRef}
            id={`site-stock-search-${activePage}`}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSuggestion(null); setMessage(""); }}
            placeholder="搜索名称 / 代码"
            autoComplete="off"
            maxLength={40}
            disabled={busy}
          />
          <kbd>⌘ K</kbd>
          <button className={styles.addButton} type="button" disabled={busy} onClick={() => void addStock()} aria-label="添加自选股">{phase === "adding" ? "添加中…" : "添加自选"}</button>
          <button type="submit" disabled={busy}>
            <span className={styles.desktopButtonLabel}>{phase === "opening" ? "切换中…" : "切换个股"}</span>
            <span className={styles.mobileButtonLabel}>{phase === "opening" ? "加载" : "查看"}</span>
          </button>
          {suggestion ? (
            <div className={styles.suggestion} role="group" aria-label="股票搜索结果与操作">
              <button className={styles.suggestionIdentity} type="button" onClick={() => void openStock(stockRouteKey(suggestion))}>
                <span className={styles.stockAvatar}>{suggestion.name.slice(0, 1)}</span>
                <span><strong>{suggestion.name}</strong><small>{suggestion.code} · {marketLabel(marketOf(suggestion))}</small></span>
              </button>
              <div className={styles.suggestionActions}>
                <button type="button" onClick={() => void openStock(stockRouteKey(suggestion))}>切换个股</button>
                <button type="button" onClick={() => void addStock(stockRouteKey(suggestion))}>＋ 添加自选</button>
              </div>
            </div>
          ) : null}
        </div>
        {message ? <p className={styles.searchMessage} role="status">{message}</p> : null}
      </form>

      <div className={styles.bannerActions}>
        <span className={styles.dataState}><i />{statusText}</span>
        <button className={styles.iconButton} type="button" onClick={onToggleAppearance} aria-label={`切换到${appearance === "light" ? "深色" : "浅色"}外观`} title={`切换到${appearance === "light" ? "深色" : "浅色"}外观`}>
          <span aria-hidden="true">{appearance === "light" ? "◐" : "☀"}</span>
        </button>
      </div>
    </header>
    <div className={styles.mobileSpacer} aria-hidden="true" />
    </>
  );
}

async function lookupStock(query: string, signal?: AbortSignal): Promise<StockIdentity> {
  const normalized = query.trim();
  const queryLooksUS = /^US:/i.test(normalized) || /^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(normalized);
  const request = async (endpoint: string): Promise<StockIdentity> => {
    const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: normalized.replace(/^US:/i, "") }),
    signal,
    });
    const body = await response.json() as { code?: unknown; name?: unknown; market?: unknown; error?: unknown };
    if (!response.ok) throw new Error(String(body.error || "股票查询失败"));
    const market = body.market === "US" || endpoint.includes("us-stock") ? "US" : "CN";
    const code = market === "US" ? normalizeUSSymbol(body.code) : String(body.code ?? "");
    const name = String(body.name ?? "");
    if (!(market === "US" ? isUSStockSymbol(code) : /^\d{6}$/.test(code)) || !name) throw new Error("股票查询返回了无效结果");
    return { code, name, market, currency: market === "US" ? "USD" : "CNY" };
  };
  if (queryLooksUS) {
    try { return await request("/api/us-stock-lookup"); } catch (reason) { throw publicStockLookupError([reason]); }
  }
  try {
    return await request("/api/local-stock-lookup");
  } catch (cnReason) {
    try { return await request("/api/us-stock-lookup"); } catch (usReason) { throw publicStockLookupError([cnReason, usReason]); }
  }
}
