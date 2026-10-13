"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { accountStorage } from "../lib/accountStorage";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseWatchlist, upsertWatchlistStock, type WatchlistStock } from "../lib/watchlist";
import { isUSStockSymbol, marketLabel, marketOf, normalizeUSSymbol, stockRouteKey, stockStorageKey, type StockIdentity, type StockMarket } from "../lib/security";
import { publicStockLookupError } from "../lib/stockLookupError";
import styles from "./SiteBanner.module.css";

type BannerPage = "portfolio" | "stock" | "global" | "screener" | "review" | "account";
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
  const { user, syncStatus } = useAuth();
  const [query, setQuery] = useState("");
  const [suggestion, setSuggestion] = useState<WatchlistStock | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const resultButtonRef = useRef<HTMLButtonElement | null>(null);
  const suggestionControllerRef = useRef<AbortController | null>(null);
  const operationRef = useRef<AbortController | null>(null);
  const composingRef = useRef(false);

  const dismissSuggestions = useCallback(() => {
    suggestionControllerRef.current?.abort();
    setSuggestionsOpen(false);
    setSuggestion(null);
    setIsSearching(false);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        const modalOpen = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'))
          .some((dialog) => dialog.getClientRects().length > 0);
        if (event.isComposing || composingRef.current) return;
        event.preventDefault();
        if (modalOpen) return;
        searchRef.current?.focus({ preventScroll: true });
      }
      if (event.key === "Escape" && !event.isComposing && !composingRef.current && formRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        searchRef.current?.focus({ preventScroll: true });
        dismissSuggestions();
        setMessage("");
      }
    };
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !formRef.current?.contains(event.target)) {
        dismissSuggestions();
        setMessage("");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      document.removeEventListener("pointerdown", handleOutsidePointer);
      operationRef.current?.abort();
    };
  }, [dismissSuggestions]);

  useEffect(() => {
    const input = query.trim();
    if ((input.length < 2 && !isUSStockSymbol(input)) || phase !== "idle" || !suggestionsOpen) return;
    const controller = new AbortController();
    suggestionControllerRef.current = controller;
    const timer = window.setTimeout(async () => {
      if (controller.signal.aborted) return;
      setIsSearching(true);
      try {
        const stock = await lookupStock(input, controller.signal);
        if (controller.signal.aborted) return;
        setSuggestion({ ...stock, addedAt: new Date().toISOString() });
        setMessage("");
      } catch (reason) {
        if (controller.signal.aborted) return;
        setSuggestion(null);
        setMessage(reason instanceof Error ? reason.message : "没有找到匹配的 A 股或美股");
        setMessageIsError(true);
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [phase, query, suggestionsOpen]);

  const resolveStock = async (value = query, signal?: AbortSignal) => {
    const input = value.trim();
    if (!input) throw new Error("请输入股票名称或代码");
    if (suggestion && (stockRouteKey(suggestion) === input || suggestion.code === normalizeUSSymbol(input) || suggestion.code === input || suggestion.name === input)) return suggestion;
    const stock = await lookupStock(input, signal);
    return { ...stock, addedAt: new Date().toISOString() };
  };

  const openStock = async (value = query) => {
    if (!value.trim() || operationRef.current) return;
    const controller = new AbortController();
    operationRef.current = controller;
    searchRef.current?.focus({ preventScroll: true });
    dismissSuggestions();
    setPhase("opening");
    setMessage("");
    setMessageIsError(false);
    try {
      const stock = await resolveStock(value, controller.signal);
      if (controller.signal.aborted) return;
      setQuery("");
      const routeKey = stockRouteKey(stock);
      if (onOpenStock) onOpenStock(routeKey);
      else window.location.assign(`/?stock=${encodeURIComponent(routeKey)}`);
      setMessage(`已打开 ${stock.name}。`);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setMessage(reason instanceof Error ? reason.message : "没有找到匹配的 A 股或美股");
      setMessageIsError(true);
    } finally {
      if (!controller.signal.aborted) {
        operationRef.current = null;
        setPhase("idle");
      }
    }
  };

  const addStock = async (value = query) => {
    if (!user) { window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
    if (!value.trim() || operationRef.current) return;
    const controller = new AbortController();
    operationRef.current = controller;
    searchRef.current?.focus({ preventScroll: true });
    dismissSuggestions();
    setPhase("adding");
    setMessage("");
    setMessageIsError(false);
    try {
      const stock = await resolveStock(value, controller.signal);
      if (controller.signal.aborted) return;
      let current: WatchlistStock[] = [];
      try {
        current = parseWatchlist(JSON.parse(accountStorage.getItem(watchlistStorageKey) ?? "[]"));
      } catch {
        accountStorage.removeItem(watchlistStorageKey);
      }
      const existed = current.some((item) => stockStorageKey(item) === stockStorageKey(stock));
      accountStorage.setItem(watchlistStorageKey, JSON.stringify(upsertWatchlistStock(current, stock)));
      window.dispatchEvent(new CustomEvent("ticklens:watchlist-change", { detail: stock }));
      onAddStock?.(stock, existed);
      setQuery("");
      setMessage(existed ? `${stock.name} 已在自选中，并已置顶。` : `${stock.name} 已加入自选。`);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setMessage(reason instanceof Error ? reason.message : "没有找到匹配的 A 股或美股");
      setMessageIsError(true);
    } finally {
      if (!controller.signal.aborted) {
        operationRef.current = null;
        setPhase("idle");
      }
    }
  };

  const globalHref = currentStockCode ? `/global-markets?stock=${encodeURIComponent(stockRouteKey({ code: currentStockCode, market: currentStockMarket }))}` : "/global-markets";
  const busy = phase !== "idle";
  const showSuggestion = suggestionsOpen && Boolean(suggestion) && !busy;
  const resultsId = `site-stock-results-${activePage}`;
  const statusId = `site-stock-status-${activePage}`;
  const feedback = phase === "opening" ? "正在查找并打开股票…" : phase === "adding" ? "正在添加自选…" : isSearching ? "正在搜索…" : message;
  const openPortfolioClick = activePage === "stock" && onOpenPortfolio ? (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onOpenPortfolio();
  } : undefined;

  return (
    <>
    <header className={styles.banner} data-site-banner>
      <Link className={styles.brand} href="/" aria-label="TrendSight 工作台首页" onClick={openPortfolioClick}>
        <span className={styles.brandMark} aria-hidden="true" />
        <span><strong>TrendSight</strong><small>市场研究工作台</small></span>
      </Link>

      <nav className={styles.navigation} aria-label="全站页面导航">
        <Link
          className={activePage === "portfolio" ? styles.activeNav : ""}
          href="/"
          aria-current={activePage === "portfolio" ? "page" : undefined}
          onClick={openPortfolioClick}
        >{user ? "工作台" : "股票查询"}</Link>
        {user && <>
        <Link className={activePage === "screener" ? styles.activeNav : ""} href="/screener" aria-current={activePage === "screener" ? "page" : undefined}>选股</Link>
        <Link className={activePage === "global" ? styles.activeNav : ""} href={globalHref} aria-current={activePage === "global" ? "page" : undefined}>全球</Link>
        <Link className={activePage === "review" ? styles.activeNav : ""} href="/review" aria-current={activePage === "review" ? "page" : undefined}>复盘</Link>
        </>}
      </nav>

      <form
        ref={formRef}
        className={styles.search}
        aria-label="快速搜索股票"
        aria-busy={busy}
        onSubmit={(event) => { event.preventDefault(); if (!composingRef.current) void openStock(); }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            dismissSuggestions();
            setMessage("");
          }
        }}
      >
        <div className={styles.searchField}>
          <span className={styles.searchIcon} aria-hidden="true">⌕</span>
          <label className={styles.srOnly} htmlFor={`site-stock-search-${activePage}`}>输入股票名称或代码</label>
          <input
            ref={searchRef}
            id={`site-stock-search-${activePage}`}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="dialog"
            aria-expanded={showSuggestion}
            aria-controls={showSuggestion ? resultsId : undefined}
            aria-describedby={feedback ? statusId : undefined}
            value={query}
            onFocus={() => setSuggestionsOpen(true)}
            onChange={(event) => {
              suggestionControllerRef.current?.abort();
              setQuery(event.target.value);
              setSuggestionsOpen(true);
              setSuggestion(null);
              setIsSearching(false);
              setMessage("");
              setMessageIsError(false);
            }}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
                event.preventDefault();
              }
              if (event.key === "ArrowDown" && showSuggestion && !event.nativeEvent.isComposing) {
                event.preventDefault();
                resultButtonRef.current?.focus();
              }
            }}
            placeholder="搜索名称 / 代码"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            readOnly={busy}
          />
          {showSuggestion && suggestion ? (
            <div id={resultsId} className={styles.suggestion} role="dialog" aria-label="股票搜索结果与操作">
              <div className={styles.suggestionIdentity}>
                <span className={styles.stockAvatar} aria-hidden="true">{suggestion.name.slice(0, 1)}</span>
                <span><strong>{suggestion.name}</strong><small>{suggestion.code} · {marketLabel(marketOf(suggestion))}</small></span>
              </div>
              <div className={styles.suggestionActions}>
                <button ref={resultButtonRef} type="button" disabled={busy} onClick={() => void openStock(stockRouteKey(suggestion))}>查看个股</button>
                {user && <button type="button" disabled={busy} onClick={() => void addStock(stockRouteKey(suggestion))}>＋ 添加自选</button>}
              </div>
            </div>
          ) : null}
          <kbd aria-hidden="true">⌘ K</kbd>
          {user && <button className={styles.addButton} type="button" disabled={busy || !query.trim()} onClick={() => void addStock()} aria-label="添加自选股">{phase === "adding" ? "添加中…" : "添加自选"}</button>}
          <button type="submit" disabled={busy || !query.trim()}>
            <span className={styles.desktopButtonLabel}>{phase === "opening" ? "打开中…" : "切换个股"}</span>
            <span className={styles.mobileButtonLabel}>{phase === "opening" ? "加载" : "查看"}</span>
          </button>
        </div>
        <p
          id={statusId}
          className={feedback ? `${styles.searchMessage} ${messageIsError && !busy && !isSearching ? styles.searchError : ""}` : styles.srOnly}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >{feedback}</p>
      </form>

      <div className={styles.bannerActions}>
        <span className={styles.dataState} title={statusText} aria-live="polite"><i />{user ? syncStatus === "saving" ? "保存中…" : syncStatus === "error" ? "保存失败，请重试" : "账户数据已同步" : statusText}</span>
        <Link className={styles.accountLink} href={user ? "/account" : "/login"}>{user ? "个人中心" : "登录"}</Link>
        {!user && <Link className={styles.registerLink} href="/register">注册</Link>}
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
    try { return await request("/api/us-stock-lookup"); } catch (reason) {
      if (signal?.aborted) throw reason;
      throw publicStockLookupError([reason]);
    }
  }
  try {
    return await request("/api/local-stock-lookup");
  } catch (cnReason) {
    if (signal?.aborted) throw cnReason;
    try { return await request("/api/us-stock-lookup"); } catch (usReason) {
      if (signal?.aborted) throw usReason;
      throw publicStockLookupError([cnReason, usReason]);
    }
  }
}
