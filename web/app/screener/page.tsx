"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SiteBanner from "../components/SiteBanner";
import { stockRouteKey, stockStorageKey } from "../lib/security";
import type { ScreenerFeed, ScreenerMarket, ScreenerOpportunity, ScreenerRecommendation, ScreenerSecurityType, ScreenerStrategyEvidence } from "../lib/screenerTypes";
import { parseWatchlist, upsertWatchlistStock, type WatchlistStock } from "../lib/watchlist";
import styles from "./screener.module.css";

type Appearance = "light" | "dark";
type SortKey = "score" | "change" | "confidence" | "volume" | "relativeStrength" | "rewardRisk";
type MarketCapFilter = "all" | "small" | "mid" | "large";
type ResearchPoolEntry = Pick<ScreenerOpportunity, "market" | "symbol" | "name" | "sector" | "risk" | "score"> & { addedAt: string };
type FilterSnapshot = {
  minimumScore: number;
  maximumRisk: number;
  minimumAmount: number;
  minimumRewardRisk: number;
  marketCapFilter: MarketCapFilter;
  securityType: "全部" | ScreenerSecurityType;
  qualityGate: boolean;
};
type SavedPreset = FilterSnapshot & { id: string; market: ScreenerMarket; name: string };
type CoverageStage = "universe" | "scan" | "quality" | "prefilter" | "history";

const watchlistStorageKey = "ticklens.watchlist.v1";
const appearanceStorageKey = "ticklens.appearance.v1";
const researchPoolStorageKey = "ticklens.screener-research-pool.v1";
const screenerPresetStorageKey = "ticklens.screener-professional-preset.v1";
const screenerModeStorageKey = "ticklens.screener-mode.v1";
const researchRetentionDays = 30;

const strategyTabs: Record<ScreenerMarket, string[]> = {
  CN: ["今日精选", "昨日涨停", "连板股", "趋势突破", "放量上涨"],
  US: ["今日精选", "强势股", "Gap Up", "突破新高", "放量上涨", "Momentum"],
};

export default function ScreenerPage() {
  const [market, setMarket] = useState<ScreenerMarket>("CN");
  const [strategy, setStrategy] = useState("今日精选");
  const [sort, setSort] = useState<SortKey>("score");
  const [theme, setTheme] = useState("全部题材");
  const [minimumScore, setMinimumScore] = useState(60);
  const [maximumRisk, setMaximumRisk] = useState(100);
  const [minimumAmount, setMinimumAmount] = useState(0);
  const [minimumRewardRisk, setMinimumRewardRisk] = useState(0);
  const [marketCapFilter, setMarketCapFilter] = useState<MarketCapFilter>("all");
  const [securityType, setSecurityType] = useState<"全部" | ScreenerSecurityType>("全部");
  const [qualityGate, setQualityGate] = useState(true);
  const [professionalMode, setProfessionalMode] = useState(true);
  const [showFeatured, setShowFeatured] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [coverageStage, setCoverageStage] = useState<CoverageStage | null>(null);
  const [evidenceMethod, setEvidenceMethod] = useState<ScreenerStrategyEvidence | null>(null);
  const [compareKeys, setCompareKeys] = useState<string[]>([]);
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [marketFilters, setMarketFilters] = useState<Partial<Record<ScreenerMarket, FilterSnapshot>>>({});
  const [researchUndo, setResearchUndo] = useState<{ stock: ScreenerOpportunity; wasObserved: boolean } | null>(null);
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [selected, setSelected] = useState<ScreenerOpportunity | null>(null);
  const [watchlistKeys, setWatchlistKeys] = useState<string[]>([]);
  const [researchPool, setResearchPool] = useState<ResearchPoolEntry[]>([]);
  const [toast, setToast] = useState("");
  const [feeds, setFeeds] = useState<Partial<Record<ScreenerMarket, ScreenerFeed>>>({});
  const [loadingMarket, setLoadingMarket] = useState<ScreenerMarket | null>("CN");
  const [errors, setErrors] = useState<Partial<Record<ScreenerMarket, string>>>({});
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const storedAppearance = localStorage.getItem(appearanceStorageKey) === "dark" ? "dark" : "light";
    document.documentElement.dataset.appearance = storedAppearance;
    document.title = "智能选股 · TrendSight";
    let storedWatchlistKeys: string[] = [];
    let storedResearchPool: ResearchPoolEntry[] = [];
    let storedPresets: SavedPreset[] = [];
    try {
      const parsed = parseWatchlist(JSON.parse(localStorage.getItem(watchlistStorageKey) ?? "[]"));
      storedWatchlistKeys = parsed.map(stockStorageKey);
    } catch {
      localStorage.removeItem(watchlistStorageKey);
    }
    try {
      const value = JSON.parse(localStorage.getItem(researchPoolStorageKey) ?? "[]");
      storedResearchPool = Array.isArray(value) ? value.filter((item): item is ResearchPoolEntry => Boolean(item && typeof item === "object" && "symbol" in item && "market" in item && withinResearchWindow(String(item.addedAt ?? "")))).slice(0, 30) : [];
    } catch {
      localStorage.removeItem(researchPoolStorageKey);
    }
    try {
      const cn = JSON.parse(localStorage.getItem(`${screenerPresetStorageKey}.named.CN`) ?? "[]");
      const us = JSON.parse(localStorage.getItem(`${screenerPresetStorageKey}.named.US`) ?? "[]");
      storedPresets = [...(Array.isArray(cn) ? cn : []), ...(Array.isArray(us) ? us : [])].filter((item): item is SavedPreset => Boolean(item && typeof item === "object" && "id" in item && "name" in item));
    } catch {
      localStorage.removeItem(`${screenerPresetStorageKey}.named.CN`);
      localStorage.removeItem(`${screenerPresetStorageKey}.named.US`);
    }
    const storedProfessionalMode = localStorage.getItem(screenerModeStorageKey) !== "simple";
    let mounted = true;
    Promise.resolve().then(() => {
      if (!mounted) return;
      setAppearance(storedAppearance);
      setWatchlistKeys(storedWatchlistKeys);
      setResearchPool(storedResearchPool);
      setSavedPresets(storedPresets);
      setProfessionalMode(storedProfessionalMode);
      setShowFeatured(!storedProfessionalMode);
    });
    return () => { mounted = false; document.title = "TrendSight · 市场研究工作台"; };
  }, []);

  useEffect(() => {
    if (feeds[market]) return;
    const controller = new AbortController();
    let mounted = true;
    Promise.resolve().then(() => {
      if (!mounted) return;
      setLoadingMarket(market);
      setErrors((current) => ({ ...current, [market]: "" }));
    });
    fetch(`/api/screener?market=${market}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ScreenerFeed | { error?: string };
        if (!response.ok || !("opportunities" in payload)) throw new Error("error" in payload && payload.error ? payload.error : "行情服务暂不可用");
        setFeeds((current) => ({ ...current, [market]: payload }));
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setErrors((current) => ({ ...current, [market]: reason instanceof Error ? reason.message : "行情服务暂不可用" }));
      })
      .finally(() => setLoadingMarket((current) => current === market ? null : current));
    return () => { mounted = false; controller.abort(); };
  }, [feeds, market, reloadNonce]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => { setToast(""); setResearchUndo(null); }, 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const feed = feeds[market];
  const marketStocks = useMemo(() => feed?.opportunities ?? [], [feed]);
  const eligibleStocks = useMemo(() => marketStocks
    .filter((stock) => market !== "US" || !qualityGate || stock.qualityTier === "standard"), [market, marketStocks, qualityGate]);
  const visibleStocks = useMemo(() => eligibleStocks
    .filter((stock) => stock.strategies.includes(strategy))
    .filter((stock) => theme === "全部题材" || stock.themes.includes(theme) || stock.sector === theme)
    .filter((stock) => stock.score >= minimumScore)
    .filter((stock) => stock.risk <= maximumRisk)
    .filter((stock) => stock.amountValue >= minimumAmount)
    .filter((stock) => stock.plan.rewardRisk >= minimumRewardRisk)
    .filter((stock) => securityType === "全部" || stock.securityType === securityType)
    .filter((stock) => matchesMarketCap(stock, marketCapFilter))
    .sort((left, right) => sort === "score" ? right.score - left.score : sort === "change" ? right.change - left.change : sort === "confidence" ? right.confidence - left.confidence : sort === "relativeStrength" ? right.relativeStrength20 - left.relativeStrength20 : sort === "rewardRisk" ? right.plan.rewardRisk - left.plan.rewardRisk : right.volumeRatio - left.volumeRatio),
  [eligibleStocks, marketCapFilter, maximumRisk, minimumAmount, minimumRewardRisk, minimumScore, securityType, sort, strategy, theme]);
  const featured = eligibleStocks.filter((stock) => stock.strategies.includes("今日精选")).slice(0, 3);
  const availableThemes = feed?.themes.map((item) => item.name) ?? [];
  const marketResearchPool = researchPool.filter((item) => item.market === market);
  const compareStocks = compareKeys.flatMap((key) => marketStocks.find((stock) => `${stock.market}:${stock.symbol}` === key) ?? []);
  const securityTypeThemes = market === "US" ? (["股票", "ETF", "信托", "杠杆ETF"] as ScreenerSecurityType[]).map((type) => ({
    name: type,
    count: marketStocks.filter((stock) => stock.securityType === type).length,
  })).filter((item) => item.count > 0) : [];
  const industryThemes = market === "US" ? (feed?.themes.filter((item) => !["股票", "ETF", "信托", "杠杆ETF"].includes(item.name)) ?? []) : (feed?.themes ?? []);
  const isLoading = loadingMarket === market && !feed;
  const error = errors[market];

  const currentFilters = (): FilterSnapshot => ({ minimumScore, maximumRisk, minimumAmount, minimumRewardRisk, marketCapFilter, securityType, qualityGate });

  const applyFilterSnapshot = (snapshot: FilterSnapshot) => {
    setMinimumScore(snapshot.minimumScore);
    setMaximumRisk(snapshot.maximumRisk);
    setMinimumAmount(snapshot.minimumAmount);
    setMinimumRewardRisk(snapshot.minimumRewardRisk);
    setMarketCapFilter(snapshot.marketCapFilter);
    setSecurityType(snapshot.securityType);
    setQualityGate(snapshot.qualityGate);
  };

  const clearFilters = () => {
    setTheme("全部题材");
    setMinimumScore(60);
    setMaximumRisk(100);
    setMinimumAmount(0);
    setMinimumRewardRisk(0);
    setMarketCapFilter("all");
    setSecurityType("全部");
    setQualityGate(true);
    setToast("筛选条件已清空");
  };

  const switchMode = (nextProfessionalMode: boolean) => {
    setProfessionalMode(nextProfessionalMode);
    setShowFeatured(!nextProfessionalMode);
    localStorage.setItem(screenerModeStorageKey, nextProfessionalMode ? "professional" : "simple");
  };

  const switchMarket = (nextMarket: ScreenerMarket) => {
    if (nextMarket === market) return;
    setMarketFilters((current) => ({ ...current, [market]: currentFilters() }));
    setMarket(nextMarket);
    setStrategy("今日精选");
    setTheme("全部题材");
    setSelected(null);
    setCompareKeys([]);
    setCoverageStage(null);
    setEvidenceMethod(null);
    const remembered = marketFilters[nextMarket];
    if (remembered) applyFilterSnapshot(remembered);
    else applyFilterSnapshot({ minimumScore: 60, maximumRisk: 100, minimumAmount: 0, minimumRewardRisk: 0, marketCapFilter: "all", securityType: "全部", qualityGate: true });
  };

  const retry = () => {
    setFeeds((current) => ({ ...current, [market]: undefined }));
    setReloadNonce((value) => value + 1);
    setToast("正在刷新真实行情");
  };

  const toggleAppearance = () => {
    const next = appearance === "light" ? "dark" : "light";
    setAppearance(next);
    document.documentElement.dataset.appearance = next;
    localStorage.setItem(appearanceStorageKey, next);
  };

  const addToWatchlist = (stock: ScreenerOpportunity) => {
    const nextStock: WatchlistStock = { code: stock.symbol, name: stock.name, market: stock.market, currency: stock.currency, addedAt: new Date().toISOString() };
    let current: WatchlistStock[] = [];
    try { current = parseWatchlist(JSON.parse(localStorage.getItem(watchlistStorageKey) ?? "[]")); } catch { /* Start a clean local list. */ }
    const existed = current.some((item) => stockStorageKey(item) === stockStorageKey(nextStock));
    const updated = upsertWatchlistStock(current, nextStock);
    localStorage.setItem(watchlistStorageKey, JSON.stringify(updated));
    setWatchlistKeys(updated.map(stockStorageKey));
    window.dispatchEvent(new CustomEvent("ticklens:watchlist-change", { detail: nextStock }));
    setToast(existed ? `${stock.name} 已在自选中，并已置顶` : `${stock.name} 已加入自选`);
  };

  const isWatched = (stock: ScreenerOpportunity) => watchlistKeys.includes(stockStorageKey({ code: stock.symbol, market: stock.market }));

  const toggleResearchPool = (stock: ScreenerOpportunity) => {
    const key = `${stock.market}:${stock.symbol}`;
    const existed = researchPool.some((item) => `${item.market}:${item.symbol}` === key);
    const next = existed
      ? researchPool.filter((item) => `${item.market}:${item.symbol}` !== key)
      : [{ market: stock.market, symbol: stock.symbol, name: stock.name, sector: stock.sector, risk: stock.risk, score: stock.score, addedAt: new Date().toISOString() }, ...researchPool].slice(0, 30);
    setResearchPool(next);
    localStorage.setItem(researchPoolStorageKey, JSON.stringify(next));
    setResearchUndo({ stock, wasObserved: existed });
    setToast(existed ? `${stock.name} 已移出研究观察池` : `${stock.name} 已加入研究观察池`);
  };

  const undoResearchChange = () => {
    if (!researchUndo) return;
    const { stock, wasObserved } = researchUndo;
    const key = `${stock.market}:${stock.symbol}`;
    const restored = wasObserved
      ? [{ market: stock.market, symbol: stock.symbol, name: stock.name, sector: stock.sector, risk: stock.risk, score: stock.score, addedAt: new Date().toISOString() }, ...researchPool.filter((item) => `${item.market}:${item.symbol}` !== key)].slice(0, 30)
      : researchPool.filter((item) => `${item.market}:${item.symbol}` !== key);
    setResearchPool(restored);
    localStorage.setItem(researchPoolStorageKey, JSON.stringify(restored));
    setResearchUndo(null);
    setToast("已撤销观察池变更");
  };

  const isObserved = (stock: ScreenerOpportunity) => researchPool.some((item) => item.market === stock.market && item.symbol === stock.symbol);

  const toggleCompare = (stock: ScreenerOpportunity) => {
    const key = `${stock.market}:${stock.symbol}`;
    if (compareKeys.includes(key)) return setCompareKeys((current) => current.filter((item) => item !== key));
    if (compareKeys.length >= 3) return setToast("最多同时对比 3 只股票");
    setCompareKeys((current) => [...current, key]);
    setToast(compareKeys.length ? `${stock.name} 已加入对比` : `已选择 ${stock.name}，再选 1–2 只开始对比`);
  };

  const applyProfessionalPreset = () => {
    setMinimumScore(70);
    setMaximumRisk(70);
    setMinimumAmount(market === "CN" ? 100_000_000 : 20_000_000);
    setMinimumRewardRisk(1.5);
    setMarketCapFilter("all");
    setSecurityType(market === "US" ? "股票" : "全部");
    setQualityGate(true);
    setToast("已应用专业风控预设");
  };

  const marketPresets = savedPresets.filter((preset) => preset.market === market);

  const saveNamedPreset = () => {
    const name = presetName.trim() || `我的方案 ${marketPresets.length + 1}`;
    const id = selectedPresetId || `${market}-${Date.now()}`;
    const nextPreset: SavedPreset = { id, market, name, ...currentFilters() };
    const next = [...savedPresets.filter((preset) => preset.id !== id), nextPreset];
    setSavedPresets(next);
    setSelectedPresetId(id);
    setPresetName(name);
    localStorage.setItem(`${screenerPresetStorageKey}.named.${market}`, JSON.stringify(next.filter((preset) => preset.market === market)));
    setToast(selectedPresetId ? `已更新筛选方案“${name}”` : `已保存筛选方案“${name}”`);
  };

  const loadNamedPreset = (id: string) => {
    setSelectedPresetId(id);
    const preset = savedPresets.find((item) => item.id === id);
    if (!preset) return setPresetName("");
    setPresetName(preset.name);
    applyFilterSnapshot(preset);
    setToast(`已应用筛选方案“${preset.name}”`);
  };

  const deleteNamedPreset = () => {
    if (!selectedPresetId) return setToast("请先选择一个已保存方案");
    const preset = savedPresets.find((item) => item.id === selectedPresetId);
    const next = savedPresets.filter((item) => item.id !== selectedPresetId);
    setSavedPresets(next);
    localStorage.setItem(`${screenerPresetStorageKey}.named.${market}`, JSON.stringify(next.filter((item) => item.market === market)));
    setSelectedPresetId("");
    setPresetName("");
    setToast(preset ? `已删除筛选方案“${preset.name}”` : "筛选方案已删除");
  };

  const activeFilterChips = [
    strategy !== "今日精选" ? { key: "strategy", label: `策略：${strategy}`, clear: () => setStrategy("今日精选") } : null,
    theme !== "全部题材" ? { key: "theme", label: `题材：${theme}`, clear: () => setTheme("全部题材") } : null,
    minimumScore !== 60 ? { key: "score", label: `评分 ${minimumScore}+`, clear: () => setMinimumScore(60) } : null,
    maximumRisk !== 100 ? { key: "risk", label: `风险 ≤ ${maximumRisk}`, clear: () => setMaximumRisk(100) } : null,
    minimumAmount > 0 ? { key: "amount", label: `成交额 ≥ ${formatAmountFilter(minimumAmount, market)}`, clear: () => setMinimumAmount(0) } : null,
    marketCapFilter !== "all" ? { key: "cap", label: `市值：${marketCapFilter === "small" ? "中小盘" : marketCapFilter === "mid" ? "中盘" : "大盘"}`, clear: () => setMarketCapFilter("all") } : null,
    minimumRewardRisk > 0 ? { key: "rr", label: `盈亏比 ${minimumRewardRisk.toFixed(1)}R+`, clear: () => setMinimumRewardRisk(0) } : null,
    market === "US" && securityType !== "全部" ? { key: "security", label: `类型：${securityType}`, clear: () => setSecurityType("全部") } : null,
    market === "US" && !qualityGate ? { key: "quality", label: "扩展池：含高风险证券", clear: () => setQualityGate(true) } : null,
  ].filter((item): item is { key: string; label: string; clear: () => void } => Boolean(item));

  return (
    <div className={styles.page}>
      <SiteBanner activePage="screener" appearance={appearance} onToggleAppearance={toggleAppearance} statusText={feed ? `${feed.quoteStatus} · ${feed.diagnostics.delayed ? "公开延时" : "实时"}` : "正在连接公开行情"} />

      <main className={styles.shell}>
        <section className={styles.hero} aria-labelledby="screener-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>SMART OPPORTUNITY RADAR</p>
            <h1 id="screener-title">智能选股</h1>
            <p>从真实市场行情、趋势和量价结构中，筛选值得进一步研究的交易线索。</p>
          </div>
          <div className={styles.heroControls}>
            <div className={styles.viewSwitch} role="group" aria-label="选择选股视图">
              <button className={!professionalMode ? styles.active : ""} aria-pressed={!professionalMode} title="突出前三条线索，减少专业字段" onClick={() => switchMode(false)} type="button">简洁模式</button>
              <button className={professionalMode ? styles.active : ""} aria-pressed={professionalMode} title="显示完整筛选、风险、计划与审计字段" onClick={() => switchMode(true)} type="button">专业模式</button>
            </div>
            <div className={styles.marketSwitch} role="group" aria-label="选择股票市场">
              <button className={market === "CN" ? styles.active : ""} aria-pressed={market === "CN"} onClick={() => switchMarket("CN")} type="button">A股</button>
              <button className={market === "US" ? styles.active : ""} aria-pressed={market === "US"} onClick={() => switchMarket("US")} type="button">美股</button>
            </div>
            <div className={styles.tradeDate}><span>交易日</span><strong>{feed?.tradeDate ?? "—"}</strong><small>{feed ? `${relativeFreshness(feed.fetchedAt)} · ${feed.quoteStatus}` : "加载中"}</small><button type="button" onClick={retry} disabled={isLoading}>↻ 刷新</button></div>
            <a className={styles.researchShortcut} href="#research-pool" aria-label={`研究观察池 ${marketResearchPool.length} 只`}>研究池 <strong>{marketResearchPool.length}</strong></a>
          </div>
        </section>

        {isLoading ? <LoadingState market={market} /> : null}
        {!isLoading && error && !feed ? <ErrorState message={error} onRetry={retry} /> : null}

        {feed ? <>
          <section className={styles.marketStrip} aria-label={`${market === "CN" ? "A股" : "美股"}市场概览`}>
            <article className={styles.sentimentMetric}><span>市场情绪</span><strong><i />{feed.snapshot.mood}</strong><div className={styles.sentimentBar}><i style={{ width: `${feed.snapshot.moodScore}%` }} /></div></article>
            <article><span>核心指数</span><strong>{feed.snapshot.primary}</strong><small>{feed.snapshot.secondary}</small></article>
            <article><span>{feed.snapshot.breadthLabel}</span><strong>{feed.snapshot.breadthValue}</strong><small>{feed.snapshot.breadthCaption}</small></article>
            <article><span>强势信号</span><strong>{feed.snapshot.event}</strong><small>{feed.snapshot.liquidity}</small></article>
            <article className={styles.riskBudget}><span>模型风险预算</span><strong>{feed.snapshot.riskBudget}</strong><small>{feed.snapshot.riskNote}</small></article>
          </section>

          <section className={styles.decisionDeck} aria-labelledby="decision-deck-title">
            <header><div><span>NEXT RESEARCH ACTION</span><h2 id="decision-deck-title">先看候选，再看证据</h2></div><p>{professionalMode ? "专业模式 · 风险与计划优先" : "简洁模式 · 聚焦前三条线索"}</p></header>
            <div className={styles.decisionDeckGrid}>
              {featured.map((stock, index) => <CompactCandidateCard key={`${stock.market}-${stock.symbol}`} stock={stock} rank={index + 1} watched={isWatched(stock)} observed={isObserved(stock)} compared={compareKeys.includes(`${stock.market}:${stock.symbol}`)} onOpen={() => setSelected(stock)} onWatch={() => addToWatchlist(stock)} onObserve={() => toggleResearchPool(stock)} onCompare={() => toggleCompare(stock)} />)}
            </div>
            <a className={styles.jumpToPool} href="#stock-pool-title">进入完整策略池 ↓</a>
          </section>

          <section className={styles.coveragePanel} aria-label="数据覆盖与模型审计">
            <div className={styles.coverageIntro}>
              <span>DATA COVERAGE</span>
              <strong>{market === "CN" ? "全市场覆盖链路" : "涨幅榜采样链路"}</strong>
              <small>{market === "CN" ? "全市场行情扫描后，再用流动性和日K完整度筛选候选。" : "不是美股全市场广度：先从完整证券总数中采集涨幅榜，再执行质量门槛。"}</small>
            </div>
            <div className={styles.coverageFunnel} aria-label="可解释筛选链路">
              <button type="button" className={coverageStage === "universe" ? styles.coverageStageActive : ""} aria-pressed={coverageStage === "universe"} onClick={() => setCoverageStage((value) => value === "universe" ? null : "universe")}><small>证券总数</small><strong>{feed.diagnostics.universeCount.toLocaleString("zh-CN")}</strong></button>
              <i>→</i>
              <button type="button" className={coverageStage === "scan" ? styles.coverageStageActive : ""} aria-pressed={coverageStage === "scan"} onClick={() => setCoverageStage((value) => value === "scan" ? null : "scan")}><small>{market === "CN" ? "全量扫描" : "涨幅榜采样"}</small><strong>{feed.diagnostics.scannedCount.toLocaleString("zh-CN")}</strong></button>
              <i>→</i>
              <button type="button" className={coverageStage === "quality" ? styles.coverageStageActive : ""} aria-pressed={coverageStage === "quality"} onClick={() => setCoverageStage((value) => value === "quality" ? null : "quality")}><small>{market === "CN" ? "标准质量" : "扩展质量"}</small><strong>{(market === "CN" ? feed.diagnostics.qualityCount : feed.diagnostics.expandedQualityCount).toLocaleString("zh-CN")}</strong></button>
              <i>→</i>
              <button type="button" className={coverageStage === "prefilter" ? styles.coverageStageActive : ""} aria-pressed={coverageStage === "prefilter"} onClick={() => setCoverageStage((value) => value === "prefilter" ? null : "prefilter")}><small>规则预筛</small><strong>{feed.diagnostics.prefilterCount.toLocaleString("zh-CN")}</strong></button>
              <i>→</i>
              <button type="button" className={coverageStage === "history" ? styles.coverageStageActive : ""} aria-pressed={coverageStage === "history"} onClick={() => setCoverageStage((value) => value === "history" ? null : "history")}><small>完成日K分析</small><strong>{feed.diagnostics.analyzedCount.toLocaleString("zh-CN")}</strong></button>
            </div>
            <div className={styles.auditStamp}>
              <span>规则版本 {feed.diagnostics.modelVersion}</span>
              <strong>{formatFetchedAt(feed.fetchedAt)}</strong>
              <small>{market === "US" ? `其中 ${feed.diagnostics.qualityCount} 只通过标准质量门槛` : feed.diagnostics.failedHistoryCount ? `${feed.diagnostics.failedHistoryCount} 只历史数据不完整，已排除` : "候选历史数据均已通过完整性检查"}</small>
            </div>
            {coverageStage ? <div className={styles.coverageExplanation} role="status"><strong>{coverageStageLabel(coverageStage)}</strong><span>{coverageStageDescription(coverageStage, market, feed)}</span></div> : null}
          </section>

          <section className={styles.strategyBrief} aria-label="今日选股建议">
            <div className={styles.briefMark} aria-hidden="true"><span /><i /></div>
            <div className={styles.briefLead}><span>规则模型策略</span><strong>{feed.brief.priority}</strong></div>
            <p>{feed.brief.summary}</p>
            <div className={styles.briefTags}><span>{feed.brief.positiveTag}</span><span>{feed.brief.warningTag}</span></div>
          </section>

          <section className={`${styles.evidenceSection} ${!showEvidence ? styles.evidenceCollapsed : ""}`} aria-labelledby="evidence-title">
            <header>
              <div><span>ROLLING SIGNAL EVIDENCE</span><h2 id="evidence-title">策略历史表现</h2></div>
              <div className={styles.evidenceHeaderAction}><p>事件次数并非独立证券数 · 未扣佣金与滑点</p><button type="button" aria-expanded={showEvidence} onClick={() => setShowEvidence((value) => !value)}>{showEvidence ? "收起证据" : "展开证据"}</button></div>
            </header>
            {showEvidence ? <div className={styles.evidenceGrid}>
              {feed.strategyEvidence.map((item) => <article key={item.strategy}>
                <div><strong>{item.strategy}</strong><span>{item.sampleSize} 次样本</span></div>
                <dl>
                  <div><dt>次日上涨</dt><dd>{item.winRate1D.toFixed(1)}%</dd></div>
                  <div><dt>次日中位</dt><dd className={changeClass(item.medianReturn1D, styles)}>{signedPercent(item.medianReturn1D)}</dd></div>
                  <div><dt>3日平均</dt><dd className={changeClass(item.averageReturn3D, styles)}>{signedPercent(item.averageReturn3D)}</dd></div>
                  <div><dt>3日MFE / MAE</dt><dd>{signedPercent(item.averageMfe3D)} / {signedPercent(item.averageMae3D)}</dd></div>
                </dl>
                <button className={styles.methodButton} type="button" onClick={() => setEvidenceMethod(item)}>{item.window} · 查看方法</button>
              </article>)}
              {!feed.strategyEvidence.length ? <div className={styles.evidenceEmpty}>当前候选日K中没有足够的历史信号样本，系统不会生成模拟胜率。</div> : null}
            </div> : <p className={styles.evidenceSummary}>当前有 {feed.strategyEvidence.length} 类真实日K滚动信号证据；专业模式默认收起，避免历史指标遮挡今日候选。</p>}
          </section>

          <div className={styles.workspace}>
            <div className={styles.primaryColumn}>
              <section className={`${styles.featuredSection} ${professionalMode && !showFeatured ? styles.collapsedFeatured : ""}`} aria-labelledby="featured-title">
                <header className={styles.sectionHeader}>
                  <div><span>DAILY SHORTLIST</span><h2 id="featured-title">今日模型精选</h2></div>
                  <div className={styles.featuredHeaderActions}><p>已分析 <strong>{feed.diagnostics.analyzedCount}</strong> 只候选 · 评分由真实日K因子计算</p><button type="button" onClick={() => setShowFeatured((value) => !value)}>{showFeatured ? "收起精选" : "展开精选"}</button></div>
                </header>
                <div className={styles.featuredGrid}>
                  {featured.map((stock, index) => (
                    <article className={`${styles.featuredCard} ${index === 0 ? styles.leadingCard : ""}`} key={`${stock.market}-${stock.symbol}`}>
                      <div className={styles.cardTopline}><span>{stock.signal}</span><em>{stock.sector}</em><small>#{index + 1}</small></div>
                      <div className={styles.stockHeadline}>
                        <div><strong>{stock.name}</strong><span>{stock.symbol} · {stock.exchange}</span></div>
                        <div><b>{currencySymbol(stock)}{stock.price.toFixed(2)}</b><em className={changeClass(stock.change, styles)}>{signedPercent(stock.change)}</em></div>
                      </div>
                      <div className={styles.scoreLine}>
                        <div className={styles.scoreOrb}><strong>{stock.score}</strong><span>机会评分</span></div>
                        <div><strong>{recommendationIcon(stock.recommendation)} {stock.recommendation}</strong><span>信号一致性 {stock.confidence}%</span></div>
                      </div>
                      <div className={styles.cardMetrics}>
                        <span><small>量能</small><strong>{stock.volumeRatio.toFixed(2)}x</strong></span>
                        <span><small>价格位置</small><strong>{stock.closePosition.toFixed(1)}%</strong></span>
                        <span><small>风险</small><strong className={riskClass(stock.risk, styles)}>{stock.risk}</strong></span>
                      </div>
                      <p className={styles.cardReason}>{stock.reasons[0]}</p>
                      <div className={styles.cardActions}>
                        <button type="button" onClick={() => addToWatchlist(stock)}>{isWatched(stock) ? "★ 已自选" : "☆ 加入自选"}</button>
                        <button type="button" onClick={() => toggleResearchPool(stock)}>{isObserved(stock) ? "✓ 已观察" : "+ 观察池"}</button>
                        <button type="button" onClick={() => setSelected(stock)}>查看机会计划 <span>→</span></button>
                      </div>
                    </article>
                  ))}
                  {!featured.length ? <div className={styles.emptyState}><strong>当前没有达到精选阈值的标的</strong><span>可在策略股票池中降低评分门槛继续查看。</span></div> : null}
                </div>
              </section>

              <section className={styles.stockPool} aria-labelledby="stock-pool-title">
                <header className={styles.poolHeader}>
                  <div><span>STRATEGY POOL</span><h2 id="stock-pool-title">策略股票池</h2></div>
                  <p>默认按机会评分排序 · 点击股票查看因子、风险与模型区间</p>
                </header>

                <div className={styles.strategyTabs} role="tablist" aria-label="选股策略">
                  {strategyTabs[market].map((tab) => {
                    const count = eligibleStocks.filter((stock) => stock.strategies.includes(tab)).length;
                    return <button key={tab} className={strategy === tab ? styles.activeTab : ""} type="button" role="tab" aria-selected={strategy === tab} onClick={() => setStrategy(tab)}>{tab}<small>{count}</small></button>;
                  })}
                </div>

                <div className={styles.filters}>
                  <label><span>板块/题材</span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option>全部题材</option>{availableThemes.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label><span>最低评分</span><select value={minimumScore} onChange={(event) => setMinimumScore(Number(event.target.value))}><option value={60}>60+</option><option value={70}>70+</option><option value={80}>80+</option><option value={90}>90+</option></select></label>
                  <label><span>最高风险</span><select value={maximumRisk} onChange={(event) => setMaximumRisk(Number(event.target.value))}><option value={100}>不限</option><option value={70}>≤ 70</option><option value={55}>≤ 55</option><option value={40}>≤ 40</option></select></label>
                  <label><span>最低成交额</span><select value={minimumAmount} onChange={(event) => setMinimumAmount(Number(event.target.value))}><option value={0}>不限</option><option value={market === "CN" ? 50_000_000 : 10_000_000}>{market === "CN" ? "0.5亿+" : "$10M+"}</option><option value={market === "CN" ? 100_000_000 : 50_000_000}>{market === "CN" ? "1亿+" : "$50M+"}</option><option value={market === "CN" ? 500_000_000 : 200_000_000}>{market === "CN" ? "5亿+" : "$200M+"}</option></select></label>
                  <label><span>市值范围</span><select value={marketCapFilter} onChange={(event) => setMarketCapFilter(event.target.value as MarketCapFilter)}><option value="all">全部市值</option><option value="small">中小盘</option><option value="mid">中盘</option><option value="large">大盘</option></select></label>
                  <label><span>最低盈亏比</span><select value={minimumRewardRisk} onChange={(event) => setMinimumRewardRisk(Number(event.target.value))}><option value={0}>不限</option><option value={1.2}>1.2R+</option><option value={1.5}>1.5R+</option><option value={2}>2.0R+</option></select></label>
                  {market === "US" ? <label><span>证券类型</span><select value={securityType} onChange={(event) => setSecurityType(event.target.value as "全部" | ScreenerSecurityType)}><option>全部</option><option>股票</option><option>ETF</option><option>信托</option><option>杠杆ETF</option></select></label> : null}
                  <label><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="score">机会评分</option><option value="confidence">信号一致性</option><option value="relativeStrength">相对强弱</option><option value="rewardRisk">计划盈亏比</option><option value="change">涨幅</option><option value="volume">量能</option></select></label>
                  {market === "US" ? <button className={`${styles.qualityToggle} ${qualityGate ? styles.qualityToggleActive : styles.qualityToggleRisk}`} type="button" onClick={() => setQualityGate((value) => !value)} aria-pressed={qualityGate}><i />{qualityGate ? "标准质量门槛" : "扩展池 · 含高风险证券"}</button> : null}
                  <div className={styles.filterActions}><button type="button" onClick={applyProfessionalPreset}>专业预设</button><button type="button" onClick={clearFilters}>清空条件</button></div>
                  <span className={styles.resultCount}>{visibleStocks.length} 只符合条件</span>
                </div>

                <div className={styles.filterStateBar} aria-label="当前筛选条件">
                  <div className={styles.activeFilters}><strong>当前条件 {activeFilterChips.length ? `(${activeFilterChips.length})` : ""}</strong>{activeFilterChips.length ? activeFilterChips.map((item) => <button key={item.key} type="button" onClick={item.clear}>{item.label}<span aria-hidden="true">×</span></button>) : <span>使用默认门槛</span>}</div>
                  <div className={styles.presetManager}>
                    <select aria-label="已保存筛选方案" value={selectedPresetId} onChange={(event) => loadNamedPreset(event.target.value)}><option value="">选择保存方案</option>{marketPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select>
                    <input aria-label="筛选方案名称" value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="方案名称" />
                    <button type="button" onClick={saveNamedPreset}>{selectedPresetId ? "更新/重命名" : "保存方案"}</button>
                    <button type="button" onClick={deleteNamedPreset} disabled={!selectedPresetId}>删除</button>
                  </div>
                </div>

                {market === "US" && !qualityGate ? <div className={styles.expandedPoolWarning} role="status"><strong>扩展池已开启</strong><span>结果可能包含低流动性、小市值、信托或杠杆ETF；每只扩展证券都会标记风险层级。</span><button type="button" onClick={() => setQualityGate(true)}>恢复标准门槛</button></div> : null}

                {compareStocks.length ? <ComparePanel stocks={compareStocks} onRemove={toggleCompare} onOpen={setSelected} /> : null}

                <div className={styles.tableWrap}>
                  <table aria-label="策略股票池桌面表格">
                    <thead><tr><th className={styles.stockSticky}>股票</th><th>核心信号</th><th>价格 / 涨幅</th><th>量能 / 市值</th><th>20日相对强弱</th><th>机会评分</th><th className={styles.decisionSticky}>风险 · 计划 · 操作</th></tr></thead>
                    <tbody>{visibleStocks.map((stock) => (
                      <tr key={`${stock.market}-${stock.symbol}`} className={stock.qualityTier === "expanded" ? styles.expandedRow : ""}>
                        <td className={styles.stockSticky}><div className={styles.stockCell}><span>{stock.name.slice(0, 1)}</span><div><strong title={stock.name}>{shortStockName(stock)}</strong><small>{stock.symbol} · {stock.exchange} · {stock.securityType}</small>{stock.qualityTier === "expanded" ? <em>扩展池</em> : null}</div></div></td>
                        <td><strong className={styles.signalLabel}>{stock.signal}</strong><small className={styles.sectorLabel}>{stock.sector}</small>{stock.limitDetail ? <small className={styles.limitMeta}>封 {stock.limitDetail.first} · 炸 {stock.limitDetail.burstCount} · {stock.limitDetail.shape}</small> : null}</td>
                        <td><strong>{currencySymbol(stock)}{stock.price.toFixed(2)}</strong><small className={changeClass(stock.change, styles)}>{signedPercent(stock.change)}</small></td>
                        <td><strong>{stock.volumeRatio.toFixed(2)}x · 换手 {stock.turnover.toFixed(1)}%</strong><small>{stock.amount} · {formatMarketCap(stock.marketCap, stock.market)}</small></td>
                        <td><strong className={changeClass(stock.relativeStrength20, styles)}>{signedPercent(stock.relativeStrength20)}</strong><small>个股 {signedPercent(stock.return20)} / 基准 {signedPercent(stock.benchmarkReturn20)}</small></td>
                        <td><div className={styles.tableScore}><strong>{stock.score}</strong><span><i style={{ width: `${stock.score}%` }} /></span></div></td>
                        <td className={styles.decisionSticky}><div className={styles.decisionCell}><div><strong className={riskClass(stock.risk, styles)}>风险 {stock.risk}</strong><span>{stock.plan.rewardRisk.toFixed(2)}R · 仓位≤{stock.plan.suggestedPositionPercent.toFixed(1)}%</span></div><strong>{recommendationIcon(stock.recommendation)} {stock.recommendation}<small>{stock.confidence}% 一致性</small></strong><div className={styles.rowTools}><button type="button" onClick={() => setSelected(stock)} aria-label={`查看${stock.name}机会详情`}>详情</button><button type="button" aria-pressed={compareKeys.includes(`${stock.market}:${stock.symbol}`)} onClick={() => toggleCompare(stock)}>对比</button><button type="button" onClick={() => addToWatchlist(stock)} aria-label={`${isWatched(stock) ? "置顶" : "加入"}${stock.name}自选`}>{isWatched(stock) ? "★" : "☆"}</button></div></div></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className={styles.mobileOpportunityList} aria-label="策略股票池移动端卡片">
                  {visibleStocks.map((stock) => <MobileOpportunityCard key={`${stock.market}-${stock.symbol}`} stock={stock} watched={isWatched(stock)} observed={isObserved(stock)} compared={compareKeys.includes(`${stock.market}:${stock.symbol}`)} onOpen={() => setSelected(stock)} onWatch={() => addToWatchlist(stock)} onObserve={() => toggleResearchPool(stock)} onCompare={() => toggleCompare(stock)} />)}
                </div>
                {!visibleStocks.length ? <div className={styles.emptyState}><strong>当前条件下没有真实行情候选</strong><span>可一键恢复默认门槛，或保留当前条件切换策略。</span><button type="button" onClick={clearFilters}>一键放宽条件</button></div> : null}
              </section>
            </div>

            <aside className={styles.insightRail} aria-label="市场结构与热门板块">
              <section className={styles.ladderCard}>
                <header><div><span>{market === "CN" ? "LIMIT-UP LADDER" : "US QUALITY GATE"}</span><h2>{feed.structure.title}</h2></div><strong>{feed.structure.badge}</strong></header>
                {market === "CN" ? <div className={styles.ladder}>{feed.structure.rows.map((row) => <div key={row.level}><strong>{row.level}</strong><span>{row.names.map((name) => <button type="button" key={name}>{name}</button>)}</span></div>)}</div>
                  : <div className={styles.qualityRules}>{feed.structure.rows.map((row) => <span key={row.level}><i />{row.level} {row.names.join(" · ")}</span>)}</div>}
                <dl className={styles.ladderStats}>{feed.structure.stats.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
                <p>{feed.structure.note}</p>
              </section>

              <section className={styles.themeCard}>
                <header><div><span>MARKET THEMES</span><h2>{market === "CN" ? "涨停板块热度" : "行业热度"}</h2></div><small>真实样本聚合</small></header>
                {market === "US" ? <div className={styles.securityTypeHeat}><strong>证券类型热度</strong><div>{securityTypeThemes.map((item) => <button type="button" key={item.name} onClick={() => setSecurityType(item.name)}><span>{item.name}</span><b>{item.count}</b></button>)}</div></div> : null}
                <ol>{industryThemes.map((item, index) => <li key={item.name}><button type="button" onClick={() => setTheme(item.name)}><b>{index + 1}</b><span><strong>{item.name}</strong><small>{"●".repeat(item.heat)}<i>{"●".repeat(5 - item.heat)}</i></small></span><em className={changeClass(item.change, styles)}>{signedPercent(item.change)}<small>{item.count} 个样本</small></em></button></li>)}</ol>
              </section>

              <section className={styles.scaleCard}>
                <span>SCORE GUIDE</span><h2>机会评分说明</h2>
                <div><i className={styles.scoreStrong}>86</i><span><strong>强烈关注</strong><small>趋势、量价与风险共同达标</small></span></div>
                <div><i className={styles.scoreGood}>76</i><span><strong>值得关注</strong><small>等待价格与量能确认</small></span></div>
                <div><i className={styles.scoreWatch}>65</i><span><strong>观察</strong><small>信号尚未完全闭环</small></span></div>
                <p>机会评分衡量价格结构质量；信号一致性衡量因子闭环程度；最终建议还会被风险、乖离和流动性降级，因此高评分不必然等于“强烈关注”。两者都不是上涨概率，也不代表公司长期价值。</p>
              </section>

              <section className={styles.researchPoolCard} id="research-pool">
                <header><div><span>RESEARCH POOL</span><h2>研究观察池</h2></div><strong>{marketResearchPool.length}</strong></header>
                <div className={styles.researchPoolList}>
                  {marketResearchPool.slice(0, 8).map((item) => <button key={`${item.market}-${item.symbol}`} type="button" onClick={() => {
                    const stock = marketStocks.find((candidate) => candidate.symbol === item.symbol);
                    if (stock) setSelected(stock);
                  }}><span><strong>{item.name}</strong><small>{item.symbol} · {item.sector} · {researchDateLabel(item.addedAt)}</small></span><em>{item.score}<small>风险 {item.risk}</small></em></button>)}
                  {!marketResearchPool.length ? <p>从候选卡片或机会详情加入。线索保留 30 天，过期后自动归档，不与持仓自选混用。</p> : null}
                </div>
                {marketResearchPool.length ? <dl><div><dt>平均风险</dt><dd>{Math.round(averageNumber(marketResearchPool.map((item) => item.risk)))}</dd></div><div><dt>集中方向</dt><dd>{dominantSector(marketResearchPool)}</dd></div></dl> : null}
              </section>
            </aside>
          </div>

          <footer className={styles.disclaimer}>
            <strong>数据说明</strong>
            <span>行情来自{feed.source}，采集时间 {formatFetchedAt(feed.fetchedAt)}；公开免费行情可能延时、缺失或在休市时停留于最近交易日。评分、信号一致性、历史滚动样本与机会区间由规则模型基于真实行情计算，不是上涨概率或交易指令；仓位按单笔账户风险 {defaultRiskPerTradeLabel()} 估算，不构成投资建议。 {feed.sourceLinks.map((link, index) => <span key={link.url}>{index ? " · " : ""}<a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></span>)}</span>
          </footer>
        </> : null}
      </main>

      {selected ? <OpportunityDrawer stock={selected} watched={isWatched(selected)} observed={isObserved(selected)} onClose={() => setSelected(null)} onAdd={() => addToWatchlist(selected)} onObserve={() => toggleResearchPool(selected)} /> : null}
      {evidenceMethod ? <EvidenceMethodDialog item={evidenceMethod} market={market} onClose={() => setEvidenceMethod(null)} /> : null}
      {toast ? <div className={styles.toast} role="status"><i />{toast}{researchUndo ? <button type="button" onClick={undoResearchChange}>撤销</button> : null}</div> : null}
    </div>
  );
}

function CompactCandidateCard({ stock, rank, watched, observed, compared, onOpen, onWatch, onObserve, onCompare }: { stock: ScreenerOpportunity; rank: number; watched: boolean; observed: boolean; compared: boolean; onOpen: () => void; onWatch: () => void; onObserve: () => void; onCompare: () => void }) {
  return <article className={styles.compactCandidate}>
    <div className={styles.compactCandidateLead}><span>#{rank}</span><div><strong title={stock.name}>{stock.symbol} · {shortStockName(stock)}</strong><small>{stock.signal} · {stock.sector}</small></div><em className={changeClass(stock.change, styles)}>{signedPercent(stock.change)}</em></div>
    <div className={styles.compactDecisionMetrics}>
      <span><small>机会评分</small><strong>{stock.score}</strong></span>
      <span><small>风险</small><strong className={riskClass(stock.risk, styles)}>{stock.risk}</strong></span>
      <span><small>20日超额</small><strong className={changeClass(stock.relativeStrength20, styles)}>{signedPercent(stock.relativeStrength20)}</strong></span>
      <span><small>计划盈亏比</small><strong>{stock.plan.rewardRisk.toFixed(2)}R</strong></span>
    </div>
    <p>{recommendationIcon(stock.recommendation)} {stock.recommendation} · {stock.confidence}% 一致性；{recommendationReason(stock)}</p>
    <div className={styles.compactCandidateActions}><button type="button" onClick={onOpen}>查看计划</button><button type="button" aria-pressed={compared} onClick={onCompare}>{compared ? "已对比" : "+ 对比"}</button><button type="button" onClick={onObserve}>{observed ? "✓ 已观察" : "+ 观察"}</button><button type="button" onClick={onWatch} aria-label={`${watched ? "置顶" : "加入"}${stock.name}自选`}>{watched ? "★" : "☆"}</button></div>
  </article>;
}

function MobileOpportunityCard({ stock, watched, observed, compared, onOpen, onWatch, onObserve, onCompare }: { stock: ScreenerOpportunity; watched: boolean; observed: boolean; compared: boolean; onOpen: () => void; onWatch: () => void; onObserve: () => void; onCompare: () => void }) {
  return <article className={`${styles.mobileOpportunityCard} ${stock.qualityTier === "expanded" ? styles.expandedRow : ""}`}>
    <header><div><strong title={stock.name}>{stock.symbol}</strong><span title={stock.name}>{shortStockName(stock)}</span></div><div><strong>{currencySymbol(stock)}{stock.price.toFixed(2)}</strong><em className={changeClass(stock.change, styles)}>{signedPercent(stock.change)}</em></div></header>
    <div className={styles.mobileBadges}><span>{stock.signal}</span><span>{stock.securityType}</span>{stock.qualityTier === "expanded" ? <span className={styles.expandedBadge}>扩展池</span> : null}<span>{stock.sector}</span></div>
    <dl><div><dt>机会评分</dt><dd>{stock.score}</dd></div><div><dt>风险</dt><dd className={riskClass(stock.risk, styles)}>{stock.risk}</dd></div><div><dt>相对强弱</dt><dd className={changeClass(stock.relativeStrength20, styles)}>{signedPercent(stock.relativeStrength20)}</dd></div><div><dt>盈亏比</dt><dd>{stock.plan.rewardRisk.toFixed(2)}R</dd></div><div><dt>成交/量能</dt><dd>{stock.amount} · {stock.volumeRatio.toFixed(2)}x</dd></div><div><dt>建议仓位</dt><dd>≤ {stock.plan.suggestedPositionPercent.toFixed(1)}%</dd></div></dl>
    <p><strong>{recommendationIcon(stock.recommendation)} {stock.recommendation}</strong><span>{stock.confidence}% 一致性 · {recommendationReason(stock)}</span></p>
    <footer><button type="button" onClick={onOpen}>查看详情</button><button type="button" aria-pressed={compared} onClick={onCompare}>{compared ? "移出对比" : "+ 对比"}</button><button type="button" onClick={onObserve}>{observed ? "✓ 已观察" : "+ 观察"}</button><button type="button" onClick={onWatch}>{watched ? "★ 已自选" : "☆ 自选"}</button></footer>
  </article>;
}

function ComparePanel({ stocks, onRemove, onOpen }: { stocks: ScreenerOpportunity[]; onRemove: (stock: ScreenerOpportunity) => void; onOpen: (stock: ScreenerOpportunity) => void }) {
  return <section className={styles.comparePanel} aria-labelledby="compare-title">
    <header><div><span>COMPARE</span><h3 id="compare-title">候选横向比较 <small>{stocks.length}/3</small></h3></div><p>{stocks.length < 2 ? "再选择 1–2 只股票开始有效对比" : "统一比较风险、强弱、流动性和计划质量"}</p></header>
    <div className={styles.compareGrid}>{stocks.map((stock) => <article key={`${stock.market}-${stock.symbol}`}>
      <div><strong>{stock.symbol}</strong><button type="button" onClick={() => onRemove(stock)} aria-label={`移出${stock.name}对比`}>×</button></div>
      <span title={stock.name}>{shortStockName(stock)}</span>
      <dl><div><dt>评分 / 风险</dt><dd>{stock.score} / <b className={riskClass(stock.risk, styles)}>{stock.risk}</b></dd></div><div><dt>20日超额</dt><dd className={changeClass(stock.relativeStrength20, styles)}>{signedPercent(stock.relativeStrength20)}</dd></div><div><dt>盈亏比 / 仓位</dt><dd>{stock.plan.rewardRisk.toFixed(2)}R / ≤{stock.plan.suggestedPositionPercent.toFixed(1)}%</dd></div><div><dt>成交 / 量能</dt><dd>{stock.amount} / {stock.volumeRatio.toFixed(2)}x</dd></div></dl>
      <button type="button" onClick={() => onOpen(stock)}>查看完整计划</button>
    </article>)}</div>
  </section>;
}

function EvidenceMethodDialog({ item, market, onClose }: { item: ScreenerStrategyEvidence; market: ScreenerMarket; onClose: () => void }) {
  return <div className={styles.methodBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.methodDialog} role="dialog" aria-modal="true" aria-labelledby="method-title">
      <header><div><span>METHOD DISCLOSURE</span><h2 id="method-title">{item.strategy} · 证据口径</h2></div><button type="button" onClick={onClose} aria-label="关闭证据口径">×</button></header>
      <p>{item.methodology}</p>
      <dl><div><dt>观察窗口</dt><dd>{item.window}</dd></div><div><dt>事件样本</dt><dd>{item.sampleSize} 次信号触发</dd></div><div><dt>市场基准</dt><dd>{market === "CN" ? "沪深300" : "SPY"}（用于个股相对强弱，不参与本卡收益计算）</dd></div><div><dt>交易成本</dt><dd>未扣佣金、税费、滑点与冲击成本</dd></div></dl>
      <div className={styles.methodCautions}><strong>解读限制</strong><ul><li>事件次数不是独立证券数；同一证券可在多个交易日重复触发。</li><li>相邻信号可能重叠，统计结果不能直接视为可复制的独立交易。</li><li>这是当前候选池的滚动验证，不是全市场、跨周期回测，也不构成收益承诺。</li></ul></div>
      <button type="button" onClick={onClose}>我已了解</button>
    </section>
  </div>;
}

function LoadingState({ market }: { market: ScreenerMarket }) {
  return <section className={styles.dataState} aria-live="polite"><div className={styles.spinner} /><strong>正在扫描{market === "CN" ? "沪深京全市场" : "美股涨幅榜与日K"}</strong><span>公开行情接口返回速度会随市场时段变化，首次加载通常需要数秒。</span></section>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <section className={`${styles.dataState} ${styles.errorState}`} role="alert"><strong>真实行情暂时没有返回</strong><span>{message}</span><button type="button" onClick={onRetry}>重新获取</button></section>;
}

function OpportunityDrawer({ stock, watched, observed, onClose, onAdd, onObserve }: { stock: ScreenerOpportunity; watched: boolean; observed: boolean; onClose: () => void; onAdd: () => void; onObserve: () => void }) {
  const [activeSection, setActiveSection] = useState<"structure" | "evidence" | "plan">("structure");
  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className={styles.drawerHeader}>
          <div><span>{stock.exchange} · {stock.signal}</span><h2 id="drawer-title">{stock.name} <small>{stock.symbol}</small></h2></div>
          <button type="button" onClick={onClose} aria-label="关闭机会详情">×</button>
        </header>
        <div className={styles.drawerQuote}>
          <div><span>最近公开价格</span><strong>{currencySymbol(stock)}{stock.price.toFixed(2)}</strong><em className={changeClass(stock.change, styles)}>{signedPercent(stock.change)}</em></div>
          <div className={styles.drawerScore}><span>模型机会评分</span><strong>{stock.score}</strong><small>{recommendationIcon(stock.recommendation)} {stock.recommendation}</small></div>
        </div>

        <nav className={styles.drawerTabs} aria-label="机会详情分区"><button type="button" aria-pressed={activeSection === "structure"} onClick={() => setActiveSection("structure")}>结构</button><button type="button" aria-pressed={activeSection === "evidence"} onClick={() => setActiveSection("evidence")}>证据与风险</button><button type="button" aria-pressed={activeSection === "plan"} onClick={() => setActiveSection("plan")}>交易计划</button></nav>

        {activeSection === "structure" ? <>
          <MiniOpportunityChart stock={stock} />
          {stock.risk >= 60 ? <div className={styles.chaseWarning}><strong>⚠ 强势，但不建议当前位置追高</strong><span>风险评分 {stock.risk}，等待价格回落或突破确认后再评估风险收益比。</span></div> : null}
          <section className={styles.drawerSection}><header><h3>因子拆解</h3><span>信号一致性 <strong>{stock.confidence}%</strong> · 风险 <strong className={riskClass(stock.risk, styles)}>{stock.risk}</strong></span></header><div className={styles.factorGrid}>{stock.factorScores.map((factor) => <div key={factor.label}><span>{factor.label}<strong>{factor.value}</strong></span><i><b style={{ width: `${factor.value}%` }} /></i></div>)}</div><p className={styles.recommendationExplanation}>{recommendationReason(stock)}</p></section>
          <section className={styles.drawerSection}><header><h3>相对强弱与交易参数</h3><span>基准：{stock.market === "CN" ? "沪深300" : "SPY"}</span></header><dl className={styles.professionalMetrics}><div><dt>20日个股</dt><dd className={changeClass(stock.return20, styles)}>{signedPercent(stock.return20)}</dd></div><div><dt>20日基准</dt><dd className={changeClass(stock.benchmarkReturn20, styles)}>{signedPercent(stock.benchmarkReturn20)}</dd></div><div><dt>相对强弱</dt><dd className={changeClass(stock.relativeStrength20, styles)}>{signedPercent(stock.relativeStrength20)}</dd></div><div><dt>ATR / 波幅</dt><dd>{currencySymbol(stock)}{stock.plan.atr.toFixed(2)} / {stock.plan.atrPercent.toFixed(2)}%</dd></div></dl></section>
        </> : null}

        {activeSection === "evidence" ? <>
          {stock.limitDetail ? <section className={styles.drawerSection}><header><h3>涨停质量</h3><span>东方财富涨停池字段</span></header><dl className={styles.professionalMetrics}><div><dt>板型</dt><dd>{stock.limitDetail.shape}</dd></div><div><dt>首次 / 最终封板</dt><dd>{stock.limitDetail.first} / {stock.limitDetail.last}</dd></div><div><dt>炸板次数</dt><dd>{stock.limitDetail.burstCount}</dd></div><div><dt>封单 / 流通市值</dt><dd>{stock.limitDetail.sealFund} / {stock.limitDetail.sealFundRatio.toFixed(2)}%</dd></div><div><dt>封板强度</dt><dd>{stock.limitDetail.strength} / 100</dd></div></dl></section> : null}
          <section className={styles.drawerSection}><header><h3>为什么进入候选池</h3><span>{stock.themes.join(" · ")}</span></header><ul className={styles.reasonList}>{stock.reasons.map((reason) => <li key={reason}><i>✓</i>{reason}</li>)}</ul></section>
          <section className={styles.drawerSection}><header><h3>主要风险</h3><span>先看风险，再看空间</span></header><ul className={styles.riskList}>{stock.risks.map((risk) => <li key={risk}><i>!</i>{risk}</li>)}</ul></section>
        </> : null}

        {activeSection === "plan" ? <>
          <section className={`${styles.drawerSection} ${styles.tradePlan}`}><header><h3>机会计划</h3><span>规则模型区间 · 非交易指令</span></header><dl><div><dt>建议关注</dt><dd>{stock.plan.watch}</dd></div><div><dt>突破确认</dt><dd>{stock.plan.breakout}</dd></div><div><dt>风险失效</dt><dd>{stock.plan.stop}</dd></div><div><dt>观察目标</dt><dd>{stock.plan.targets}</dd></div></dl><div className={styles.positionPlan}><span><small>计划止损距离</small><strong>{stock.plan.stopDistancePercent.toFixed(2)}%</strong></span><span><small>目标1盈亏比</small><strong>{stock.plan.rewardRisk.toFixed(2)}R</strong></span><span><small>单笔账户风险</small><strong>{stock.plan.riskPerTradePercent.toFixed(1)}%</strong></span><span><small>建议仓位上限</small><strong>≤ {stock.plan.suggestedPositionPercent.toFixed(1)}%</strong></span></div></section>
          <div className={styles.drawerAudit}>日K截止 {stock.audit.lastBarDate} · {stock.audit.barCount} 条样本 · 完整度 {stock.audit.completeness}% · 规则版本 {stock.audit.modelVersion}</div>
        </> : null}

        <div className={styles.drawerActions}>
          <button type="button" onClick={onAdd}>{watched ? "★ 已在自选 · 置顶" : "☆ 加入自选"}</button>
          <button type="button" onClick={onObserve}>{observed ? "✓ 移出研究观察池" : "+ 加入研究观察池"}</button>
          <Link href={`/?stock=${encodeURIComponent(stockRouteKey({ code: stock.symbol, market: stock.market }))}`}>查看完整个股分析 <span>→</span></Link>
        </div>
      </aside>
    </div>
  );
}

function MiniOpportunityChart({ stock }: { stock: ScreenerOpportunity }) {
  const width = 440;
  const height = 154;
  const top = 12;
  const priceBottom = 116;
  const prices = stock.chart.prices;
  const domain = [...prices, stock.plan.stopPrice, stock.plan.breakoutPrice, ...stock.plan.targetPrices];
  const minimum = Math.min(...domain);
  const maximum = Math.max(...domain);
  const span = Math.max(maximum - minimum, maximum * .01, 1);
  const x = (index: number) => prices.length <= 1 ? 0 : index / (prices.length - 1) * width;
  const y = (value: number) => top + (maximum - value) / span * (priceBottom - top);
  const points = prices.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const maxVolume = Math.max(...stock.chart.volumes, 1);
  return <section className={styles.miniChart} aria-label={`${stock.name}最近${prices.length}个交易日日K收盘趋势`}>
    <header><div><h3>价格结构</h3><span>最近 {prices.length} 个交易日 · 收盘价</span></div><div className={styles.chartLegend}><span><i className={styles.breakoutLine} />突破</span><span><i className={styles.stopLine} />失效</span></div></header>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${stock.name}价格、成交量与交易计划示意`}>
      {[.25, .5, .75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={top + (priceBottom - top) * ratio} y2={top + (priceBottom - top) * ratio} className={styles.chartGridLine} />)}
      <line x1="0" x2={width} y1={y(stock.plan.breakoutPrice)} y2={y(stock.plan.breakoutPrice)} className={styles.breakoutGuide} />
      <line x1="0" x2={width} y1={y(stock.plan.stopPrice)} y2={y(stock.plan.stopPrice)} className={styles.stopGuide} />
      {stock.chart.volumes.map((value, index) => <rect key={`${stock.chart.dates[index]}-${index}`} x={Math.max(0, x(index) - 2)} y={height - value / maxVolume * 25} width="4" height={value / maxVolume * 25} className={styles.volumeBar} />)}
      <polyline points={points} className={styles.priceLine} />
      {prices.length ? <circle cx={x(prices.length - 1)} cy={y(prices.at(-1)!)} r="3.5" className={styles.priceDot} /> : null}
    </svg>
    <div className={styles.chartLevels}><span>失效 {formatChartPrice(stock.plan.stopPrice, stock)}</span><span>当前 {formatChartPrice(stock.price, stock)}</span><span>突破 {formatChartPrice(stock.plan.breakoutPrice, stock)}</span></div>
  </section>;
}

function recommendationIcon(recommendation: ScreenerRecommendation) {
  if (recommendation === "强烈关注") return "◆";
  if (recommendation === "值得关注") return "★";
  if (recommendation === "观察") return "◉";
  return "△";
}

function riskClass(risk: number, classNames: Record<string, string>) {
  if (risk >= 60) return classNames.riskHigh;
  if (risk >= 40) return classNames.riskMedium;
  return classNames.riskLow;
}

function changeClass(change: number, classNames: Record<string, string>) {
  return change < 0 ? classNames.downText : classNames.upText;
}

function signedPercent(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
function currencySymbol(stock: ScreenerOpportunity) { return stock.currency === "CNY" ? "¥" : "$"; }
function formatChartPrice(value: number, stock: ScreenerOpportunity) { return `${currencySymbol(stock)}${value.toFixed(2)}`; }
function defaultRiskPerTradeLabel() { return "0.5%"; }
function averageNumber(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function dominantSector(items: ResearchPoolEntry[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.sector, (counts.get(item.sector) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "—";
}
function matchesMarketCap(stock: ScreenerOpportunity, filter: MarketCapFilter) {
  if (filter === "all" || stock.marketCap <= 0) return true;
  const middle = stock.market === "CN" ? 10_000_000_000 : 2_000_000_000;
  const large = stock.market === "CN" ? 50_000_000_000 : 10_000_000_000;
  if (filter === "small") return stock.marketCap < middle;
  if (filter === "mid") return stock.marketCap >= middle && stock.marketCap < large;
  return stock.marketCap >= large;
}
function formatMarketCap(value: number, market: ScreenerMarket) {
  if (!Number.isFinite(value) || value <= 0) return "市值—";
  if (market === "CN") return `市值 ${(value / 100_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}亿`;
  return value >= 1_000_000_000 ? `市值 $${(value / 1_000_000_000).toFixed(1)}B` : `市值 $${(value / 1_000_000).toFixed(0)}M`;
}
function formatFetchedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", hour12: false }).format(date);
}

function relativeFreshness(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "刚刚更新";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟前更新`;
  return `${Math.floor(minutes / 60)} 小时前更新`;
}

function formatAmountFilter(value: number, market: ScreenerMarket) {
  if (market === "CN") return `${(value / 100_000_000).toFixed(value % 100_000_000 ? 1 : 0)}亿`;
  return `$${Math.round(value / 1_000_000)}M`;
}

function shortStockName(stock: ScreenerOpportunity) {
  const maximum = stock.market === "US" ? 25 : 10;
  return stock.name.length > maximum ? `${stock.name.slice(0, maximum)}…` : stock.name;
}

function recommendationReason(stock: ScreenerOpportunity) {
  if (stock.risk >= 70) return "评分较高，但风险或乖离触发降级";
  if (stock.confidence < 68) return "部分因子尚未形成闭环";
  if (stock.plan.rewardRisk < 1.5) return "计划盈亏比不足，等待更好位置";
  return "趋势、量价与风险收益比共同支持当前建议";
}

function coverageStageLabel(stage: CoverageStage) {
  return stage === "universe" ? "证券总数" : stage === "scan" ? "行情扫描" : stage === "quality" ? "质量门槛" : stage === "prefilter" ? "规则预筛" : "日K完整分析";
}

function coverageStageDescription(stage: CoverageStage, market: ScreenerMarket, feed: ScreenerFeed) {
  if (stage === "universe") return market === "CN" ? "沪深京公开证券清单总量，是本轮全市场扫描的起点。" : "公开美股证券总数，仅作为总体参照；当前数据源不是美股全市场逐只扫描。";
  if (stage === "scan") return market === "CN" ? `本轮已读取 ${feed.diagnostics.scannedCount.toLocaleString("zh-CN")} 只实时/延时行情。` : `当前先采集涨幅榜 ${feed.diagnostics.scannedCount.toLocaleString("zh-CN")} 只，因此不能把结果解读为全市场广度。`;
  if (stage === "quality") return market === "CN" ? "剔除缺价、成交不足及异常证券，保留满足基础流动性的标准质量池。" : `扩展质量池 ${feed.diagnostics.expandedQualityCount} 只，其中 ${feed.diagnostics.qualityCount} 只满足标准市值、价格与成交额门槛。`;
  if (stage === "prefilter") return `综合涨幅榜、涨停/昨日涨停、趋势和量能进行规则预筛，控制日K请求规模；本轮选中 ${feed.diagnostics.prefilterCount} 只。`;
  return `完成 ${feed.diagnostics.analyzedCount} 只日K评分，${feed.diagnostics.failedHistoryCount} 只因历史数据不足或请求失败被排除。`;
}

function withinResearchWindow(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= researchRetentionDays * 24 * 60 * 60 * 1000;
}

function researchDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期未知";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "今日观察";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}
