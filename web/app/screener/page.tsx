"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SiteBanner from "../components/SiteBanner";
import { parseWatchlist, upsertWatchlistStock, type WatchlistStock } from "../lib/watchlist";
import { stockRouteKey, stockStorageKey } from "../lib/security";
import styles from "./screener.module.css";

type Market = "CN" | "US";
type Appearance = "light" | "dark";
type SortKey = "score" | "change" | "probability" | "volume";
type Recommendation = "强烈关注" | "值得关注" | "观察" | "谨慎";

type Opportunity = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  currency: "CNY" | "USD";
  change: number;
  score: number;
  risk: number;
  probability: number;
  recommendation: Recommendation;
  signal: string;
  strategies: string[];
  sector: string;
  themes: string[];
  streak: number;
  volumeRatio: number;
  turnover: number;
  amount: string;
  closePosition: number;
  firstLimit?: string;
  sealStrength?: number;
  reasons: string[];
  risks: string[];
  factorScores: { label: string; value: number }[];
  plan: { watch: string; breakout: string; stop: string; targets: string };
};

const watchlistStorageKey = "ticklens.watchlist.v1";
const appearanceStorageKey = "ticklens.appearance.v1";

const strategyTabs: Record<Market, string[]> = {
  CN: ["今日精选", "昨日涨停", "连板股", "趋势突破", "放量上涨"],
  US: ["今日精选", "强势股", "Gap Up", "突破新高", "Momentum"],
};

const opportunities: Opportunity[] = [
  {
    market: "CN", symbol: "603629", name: "利通电子", exchange: "沪市", price: 126.8, currency: "CNY", change: 9.98,
    score: 92, risk: 36, probability: 68, recommendation: "强烈关注", signal: "首板", strategies: ["今日精选", "昨日涨停", "趋势突破", "放量上涨"],
    sector: "算力硬件", themes: ["AI算力", "数据中心", "液冷"], streak: 1, volumeRatio: 1.86, turnover: 8.3, amount: "18.5亿", closePosition: 99.7, firstLimit: "10:13", sealStrength: 88,
    reasons: ["首板封板较早，收盘距离日内最高点仅 0.3%", "成交量温和放大至 5 日均量的 1.86 倍", "突破 20 日平台，短中期均线呈多头排列", "算力硬件位于样本题材强度前三"],
    risks: ["价格距离 MA5 偏离约 8.1%", "近 5 日累计涨幅较大，存在获利兑现压力"],
    factorScores: [{ label: "趋势", value: 94 }, { label: "量价", value: 88 }, { label: "板块", value: 92 }, { label: "动量", value: 95 }],
    plan: { watch: "123.00 – 127.00", breakout: "129.00", stop: "119.50", targets: "135.00 / 142.00" },
  },
  {
    market: "CN", symbol: "300308", name: "中际旭创", exchange: "创业板", price: 168.42, currency: "CNY", change: 6.38,
    score: 88, risk: 31, probability: 64, recommendation: "值得关注", signal: "20日新高", strategies: ["今日精选", "趋势突破", "放量上涨"],
    sector: "光模块", themes: ["AI算力", "光通信"], streak: 0, volumeRatio: 1.62, turnover: 4.8, amount: "42.7亿", closePosition: 91.2,
    reasons: ["放量突破 20 日整理区间", "MA5、MA10、MA20 形成多头排列", "收盘位于日内价格区间上沿", "光通信主题热度保持前列"],
    risks: ["前高附近仍可能出现抛压", "盘中波动率高于近 20 日均值"],
    factorScores: [{ label: "趋势", value: 93 }, { label: "量价", value: 84 }, { label: "板块", value: 90 }, { label: "动量", value: 86 }],
    plan: { watch: "163.50 – 168.00", breakout: "171.20", stop: "157.80", targets: "178.00 / 185.00" },
  },
  {
    market: "CN", symbol: "002050", name: "三花智控", exchange: "深市", price: 32.61, currency: "CNY", change: 5.21,
    score: 84, risk: 28, probability: 61, recommendation: "值得关注", signal: "温和放量", strategies: ["今日精选", "放量上涨"],
    sector: "机器人", themes: ["机器人", "汽车零部件"], streak: 0, volumeRatio: 1.54, turnover: 3.7, amount: "21.4亿", closePosition: 84.5,
    reasons: ["量能首次回到 20 日均量上方", "短期趋势由横盘转为上行", "收盘位置保持在日内上半区", "机器人主题样本广度改善"],
    risks: ["尚未形成有效平台突破", "量能延续性仍需下一交易日确认"],
    factorScores: [{ label: "趋势", value: 82 }, { label: "量价", value: 85 }, { label: "板块", value: 88 }, { label: "动量", value: 80 }],
    plan: { watch: "31.70 – 32.50", breakout: "33.20", stop: "30.60", targets: "35.00 / 37.20" },
  },
  {
    market: "CN", symbol: "002230", name: "科大讯飞", exchange: "深市", price: 58.73, currency: "CNY", change: 4.17,
    score: 79, risk: 41, probability: 56, recommendation: "观察", signal: "趋势转强", strategies: ["今日精选", "趋势突破"],
    sector: "AI应用", themes: ["人工智能", "大模型"], streak: 0, volumeRatio: 1.34, turnover: 5.1, amount: "26.8亿", closePosition: 76.4,
    reasons: ["价格重新站上 MA20", "近期低点持续抬高", "AI 应用方向样本成交额回升"],
    risks: ["突破量能尚未达到强确认标准", "上方密集成交区可能限制空间"],
    factorScores: [{ label: "趋势", value: 80 }, { label: "量价", value: 73 }, { label: "板块", value: 84 }, { label: "动量", value: 76 }],
    plan: { watch: "56.80 – 58.50", breakout: "60.20", stop: "54.90", targets: "63.50 / 66.00" },
  },
  {
    market: "CN", symbol: "000977", name: "浪潮信息", exchange: "深市", price: 51.26, currency: "CNY", change: 10.02,
    score: 76, risk: 62, probability: 53, recommendation: "观察", signal: "二连板", strategies: ["昨日涨停", "连板股"],
    sector: "服务器", themes: ["AI算力", "数据中心"], streak: 2, volumeRatio: 2.43, turnover: 14.8, amount: "38.1亿", closePosition: 100, firstLimit: "09:47", sealStrength: 81,
    reasons: ["二连板且最终封板完整", "板块内涨停样本数量靠前", "成交活跃度显著提升"],
    risks: ["换手率明显升高", "连续上涨后价格偏离 MA5 超过 10%", "高位追涨的盈亏比已下降"],
    factorScores: [{ label: "趋势", value: 91 }, { label: "量价", value: 83 }, { label: "板块", value: 89 }, { label: "动量", value: 94 }],
    plan: { watch: "等待回踩 48.50 – 49.80", breakout: "52.80", stop: "46.90", targets: "56.00 / 59.50" },
  },
  {
    market: "CN", symbol: "601360", name: "三六零", exchange: "沪市", price: 12.44, currency: "CNY", change: 9.99,
    score: 68, risk: 71, probability: 47, recommendation: "谨慎", signal: "三连板", strategies: ["昨日涨停", "连板股"],
    sector: "AI安全", themes: ["人工智能", "网络安全"], streak: 3, volumeRatio: 3.12, turnover: 19.6, amount: "31.2亿", closePosition: 96.8, firstLimit: "14:21", sealStrength: 63,
    reasons: ["三连板维持短线辨识度", "题材热度仍处样本前列"],
    risks: ["尾盘封板且封板质量一般", "高换手叠加天量，分歧明显扩大", "处于连板梯队高位，不建议当前位置追高"],
    factorScores: [{ label: "趋势", value: 88 }, { label: "量价", value: 61 }, { label: "板块", value: 80 }, { label: "动量", value: 90 }],
    plan: { watch: "等待分歧回踩", breakout: "不建议追高", stop: "11.20", targets: "13.20 / 14.00" },
  },
  {
    market: "US", symbol: "NVDA", name: "NVIDIA", exchange: "NASDAQ", price: 182.34, currency: "USD", change: 4.82,
    score: 91, risk: 34, probability: 67, recommendation: "强烈关注", signal: "52周新高", strategies: ["今日精选", "强势股", "突破新高", "Momentum"],
    sector: "Semiconductors", themes: ["AI Compute", "Data Center"], streak: 0, volumeRatio: 1.73, turnover: 0.9, amount: "$32.4B", closePosition: 94.2,
    reasons: ["价格位于 52 周高点附近", "成交量高于 20 日均量", "5 日与 20 日动量同步为正", "大型 AI 算力样本维持板块领先"],
    risks: ["短期 RSI 处于偏热区域", "大型权重股受指数波动影响较大"],
    factorScores: [{ label: "趋势", value: 95 }, { label: "量价", value: 86 }, { label: "板块", value: 94 }, { label: "动量", value: 92 }],
    plan: { watch: "$177.00 – $182.00", breakout: "$184.60", stop: "$169.80", targets: "$194.00 / $205.00" },
  },
  {
    market: "US", symbol: "PLTR", name: "Palantir", exchange: "NASDAQ", price: 142.16, currency: "USD", change: 7.36,
    score: 87, risk: 48, probability: 63, recommendation: "值得关注", signal: "Momentum", strategies: ["今日精选", "强势股", "Momentum"],
    sector: "Software", themes: ["AI Software", "Defense Tech"], streak: 0, volumeRatio: 2.08, turnover: 1.4, amount: "$8.7B", closePosition: 89.7,
    reasons: ["5 日与 20 日动量同步增强", "放量收于日内高位", "软件板块样本相对强度上升"],
    risks: ["估值敏感度较高", "价格相对 MA20 扩张较快"],
    factorScores: [{ label: "趋势", value: 91 }, { label: "量价", value: 90 }, { label: "板块", value: 86 }, { label: "动量", value: 94 }],
    plan: { watch: "$136.00 – $141.00", breakout: "$144.20", stop: "$128.50", targets: "$153.00 / $162.00" },
  },
  {
    market: "US", symbol: "AVGO", name: "Broadcom", exchange: "NASDAQ", price: 338.72, currency: "USD", change: 3.44,
    score: 83, risk: 29, probability: 60, recommendation: "值得关注", signal: "趋势突破", strategies: ["今日精选", "突破新高", "Momentum"],
    sector: "Semiconductors", themes: ["AI Compute", "Networking"], streak: 0, volumeRatio: 1.42, turnover: 0.6, amount: "$12.1B", closePosition: 87.1,
    reasons: ["突破整理区间后保持量价配合", "价格稳定运行于 MA20 上方", "网络芯片样本相对强度改善"],
    risks: ["临近前高需观察增量资金", "隔夜波动可能放大止损滑点"],
    factorScores: [{ label: "趋势", value: 89 }, { label: "量价", value: 80 }, { label: "板块", value: 88 }, { label: "动量", value: 82 }],
    plan: { watch: "$329.00 – $336.00", breakout: "$341.50", stop: "$316.00", targets: "$358.00 / $374.00" },
  },
  {
    market: "US", symbol: "CRWD", name: "CrowdStrike", exchange: "NASDAQ", price: 487.05, currency: "USD", change: 5.92,
    score: 78, risk: 45, probability: 55, recommendation: "观察", signal: "Gap Up", strategies: ["今日精选", "Gap Up", "强势股"],
    sector: "Cybersecurity", themes: ["Cybersecurity", "AI Software"], streak: 0, volumeRatio: 1.91, turnover: 1.1, amount: "$4.2B", closePosition: 72.8,
    reasons: ["跳空后仍守住开盘价", "成交量显著高于 20 日均量", "安全软件样本整体走强"],
    risks: ["上影线显示高位分歧", "若回补缺口，短线形态将明显转弱"],
    factorScores: [{ label: "趋势", value: 85 }, { label: "量价", value: 78 }, { label: "板块", value: 83 }, { label: "动量", value: 79 }],
    plan: { watch: "$472.00 – $482.00", breakout: "$495.00", stop: "$451.00", targets: "$518.00 / $540.00" },
  },
  {
    market: "US", symbol: "SOUN", name: "SoundHound AI", exchange: "NASDAQ", price: 17.82, currency: "USD", change: 11.42,
    score: 66, risk: 78, probability: 46, recommendation: "谨慎", signal: "Gap Up", strategies: ["强势股", "Gap Up"],
    sector: "Software", themes: ["AI Software", "Small Cap"], streak: 0, volumeRatio: 4.21, turnover: 12.7, amount: "$1.1B", closePosition: 64.3,
    reasons: ["跳空幅度与成交活跃度显著", "短线动量快速上升"],
    risks: ["高波动小市值样本", "放量长上影，追高风险显著", "价格偏离 MA20 较远"],
    factorScores: [{ label: "趋势", value: 78 }, { label: "量价", value: 69 }, { label: "板块", value: 72 }, { label: "动量", value: 91 }],
    plan: { watch: "等待回踩 $16.20 – $16.80", breakout: "$18.60", stop: "$15.40", targets: "$20.20 / $22.00" },
  },
];

const themesByMarket: Record<Market, Array<{ name: string; heat: number; change: string; count: number }>> = {
  CN: [
    { name: "AI算力", heat: 5, change: "+3.82%", count: 12 },
    { name: "机器人", heat: 4, change: "+2.91%", count: 8 },
    { name: "半导体", heat: 4, change: "+2.34%", count: 6 },
    { name: "商业航天", heat: 3, change: "+1.87%", count: 4 },
    { name: "创新药", heat: 2, change: "+1.12%", count: 3 },
  ],
  US: [
    { name: "AI Compute", heat: 5, change: "+3.61%", count: 18 },
    { name: "AI Software", heat: 4, change: "+2.94%", count: 14 },
    { name: "Cybersecurity", heat: 4, change: "+2.16%", count: 9 },
    { name: "Defense Tech", heat: 3, change: "+1.74%", count: 7 },
    { name: "Biotech", heat: 2, change: "+0.86%", count: 11 },
  ],
};

const marketSnapshot = {
  CN: { mood: "偏强", moodScore: 72, primary: "上证 +0.82%", secondary: "创业板 +1.21%", up: "3,451", down: "1,712", event: "涨停 61", liquidity: "成交额 1.90万亿" },
  US: { mood: "偏强", moodScore: 68, primary: "S&P 500 +0.64%", secondary: "NASDAQ +1.08%", up: "3,892", down: "2,146", event: "新高 143", liquidity: "成交额 $612B" },
};

export default function ScreenerPage() {
  const [market, setMarket] = useState<Market>("CN");
  const [strategy, setStrategy] = useState("今日精选");
  const [sort, setSort] = useState<SortKey>("score");
  const [theme, setTheme] = useState("全部题材");
  const [minimumScore, setMinimumScore] = useState(60);
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [watchlistKeys, setWatchlistKeys] = useState<string[]>([]);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const storedAppearance = localStorage.getItem(appearanceStorageKey) === "dark" ? "dark" : "light";
    setAppearance(storedAppearance);
    document.documentElement.dataset.appearance = storedAppearance;
    document.title = "智能选股 · TrendSight";
    try {
      const parsed = parseWatchlist(JSON.parse(localStorage.getItem(watchlistStorageKey) ?? "[]"));
      setWatchlistKeys(parsed.map(stockStorageKey));
    } catch {
      localStorage.removeItem(watchlistStorageKey);
    }
    return () => { document.title = "TrendSight · 市场研究工作台"; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const marketStocks = useMemo(() => opportunities.filter((stock) => stock.market === market), [market]);
  const visibleStocks = useMemo(() => {
    return marketStocks
      .filter((stock) => strategy === "今日精选" ? stock.strategies.includes("今日精选") : stock.strategies.includes(strategy))
      .filter((stock) => theme === "全部题材" || stock.themes.includes(theme))
      .filter((stock) => stock.score >= minimumScore)
      .sort((a, b) => sort === "score" ? b.score - a.score : sort === "change" ? b.change - a.change : sort === "probability" ? b.probability - a.probability : b.volumeRatio - a.volumeRatio);
  }, [marketStocks, minimumScore, sort, strategy, theme]);

  const featured = marketStocks.filter((stock) => stock.strategies.includes("今日精选")).slice(0, 3);
  const currentSnapshot = marketSnapshot[market];
  const availableThemes = themesByMarket[market].map((item) => item.name);

  const switchMarket = (nextMarket: Market) => {
    setMarket(nextMarket);
    setStrategy("今日精选");
    setTheme("全部题材");
    setSelected(null);
  };

  const toggleAppearance = () => {
    const next = appearance === "light" ? "dark" : "light";
    setAppearance(next);
    document.documentElement.dataset.appearance = next;
    localStorage.setItem(appearanceStorageKey, next);
  };

  const addToWatchlist = (stock: Opportunity) => {
    const nextStock: WatchlistStock = {
      code: stock.symbol,
      name: stock.name,
      market: stock.market,
      currency: stock.currency,
      addedAt: new Date().toISOString(),
    };
    let current: WatchlistStock[] = [];
    try { current = parseWatchlist(JSON.parse(localStorage.getItem(watchlistStorageKey) ?? "[]")); } catch { /* Start a clean local list. */ }
    const existed = current.some((item) => stockStorageKey(item) === stockStorageKey(nextStock));
    const updated = upsertWatchlistStock(current, nextStock);
    localStorage.setItem(watchlistStorageKey, JSON.stringify(updated));
    setWatchlistKeys(updated.map(stockStorageKey));
    window.dispatchEvent(new CustomEvent("ticklens:watchlist-change", { detail: nextStock }));
    setToast(existed ? `${stock.name} 已在自选中，并已置顶` : `${stock.name} 已加入自选`);
  };

  const isWatched = (stock: Opportunity) => watchlistKeys.includes(stockStorageKey({ code: stock.symbol, market: stock.market }));

  return (
    <div className={styles.page}>
      <SiteBanner activePage="screener" appearance={appearance} onToggleAppearance={toggleAppearance} statusText="策略样本 · 非实时行情" />

      <main className={styles.shell}>
        <section className={styles.hero} aria-labelledby="screener-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>SMART OPPORTUNITY RADAR</p>
            <h1 id="screener-title">智能选股</h1>
            <p>从市场、题材到个股，把值得进一步研究的交易线索压缩到一张工作台。</p>
          </div>
          <div className={styles.heroControls}>
            <div className={styles.marketSwitch} role="group" aria-label="选择股票市场">
              <button className={market === "CN" ? styles.active : ""} onClick={() => switchMarket("CN")} type="button">A股</button>
              <button className={market === "US" ? styles.active : ""} onClick={() => switchMarket("US")} type="button">美股</button>
            </div>
            <div className={styles.tradeDate}><span>交易日</span><strong>2026-08-21</strong><small>产品演示样本</small></div>
          </div>
        </section>

        <section className={styles.marketStrip} aria-label={`${market === "CN" ? "A股" : "美股"}市场概览`}>
          <article className={styles.sentimentMetric}>
            <span>市场情绪</span>
            <strong><i />{currentSnapshot.mood}</strong>
            <div className={styles.sentimentBar}><i style={{ width: `${currentSnapshot.moodScore}%` }} /></div>
          </article>
          <article><span>核心指数</span><strong>{currentSnapshot.primary}</strong><small>{currentSnapshot.secondary}</small></article>
          <article><span>市场广度</span><strong><em>{currentSnapshot.up}</em><b>/</b>{currentSnapshot.down}</strong><small>上涨 / 下跌</small></article>
          <article><span>强势信号</span><strong>{currentSnapshot.event}</strong><small>{currentSnapshot.liquidity}</small></article>
          <article className={styles.riskBudget}><span>今日风险预算</span><strong>中高</strong><small>可参与 · 避免高位追涨</small></article>
        </section>

        <section className={styles.strategyBrief} aria-label="今日选股建议">
          <div className={styles.briefMark} aria-hidden="true"><span /><i /></div>
          <div className={styles.briefLead}>
            <span>今日 AI 策略</span>
            <strong>{market === "CN" ? "趋势突破  >  首板  >  高位连板" : "Momentum  >  新高突破  >  高波动 Gap"}</strong>
          </div>
          <p>{market === "CN" ? "样本市场赚钱效应偏强，首板与趋势突破的风险收益比优于高位连板。优先选择温和放量、收盘靠近日内高点且板块排名靠前的标的。" : "样本动量环境偏强，优先保留流动性充足、位于 MA20 上方且成交量得到确认的标的；小市值跳空股降低仓位。"}</p>
          <div className={styles.briefTags}><span>优先 · 趋势确认</span><span>回避 · 长上影</span></div>
        </section>

        <div className={styles.workspace}>
          <div className={styles.primaryColumn}>
            <section className={styles.featuredSection} aria-labelledby="featured-title">
              <header className={styles.sectionHeader}>
                <div><span>DAILY SHORTLIST</span><h2 id="featured-title">今日 AI 精选</h2></div>
                <p>发现 <strong>{featured.length}</strong> 个优先研究机会 · 评分衡量交易机会质量</p>
              </header>
              <div className={styles.featuredGrid}>
                {featured.map((stock, index) => (
                  <article className={`${styles.featuredCard} ${index === 0 ? styles.leadingCard : ""}`} key={`${stock.market}-${stock.symbol}`}>
                    <div className={styles.cardTopline}><span>{stock.signal}</span><em>{stock.sector}</em><small>#{index + 1}</small></div>
                    <div className={styles.stockHeadline}>
                      <div><strong>{stock.name}</strong><span>{stock.symbol} · {stock.exchange}</span></div>
                      <div><b>{stock.currency === "CNY" ? "¥" : "$"}{stock.price.toFixed(2)}</b><em>+{stock.change.toFixed(2)}%</em></div>
                    </div>
                    <div className={styles.scoreLine}>
                      <div className={styles.scoreOrb}><strong>{stock.score}</strong><span>AI评分</span></div>
                      <div><strong>{recommendationIcon(stock.recommendation)} {stock.recommendation}</strong><span>上涨样本概率 {stock.probability}%</span></div>
                    </div>
                    <div className={styles.cardMetrics}>
                      <span><small>量能</small><strong>{stock.volumeRatio.toFixed(2)}x</strong></span>
                      <span><small>收盘位置</small><strong>{stock.closePosition.toFixed(1)}%</strong></span>
                      <span><small>风险</small><strong className={riskClass(stock.risk, styles)}>{stock.risk}</strong></span>
                    </div>
                    <p className={styles.cardReason}>{stock.reasons[0]}</p>
                    <div className={styles.cardActions}>
                      <button type="button" onClick={() => addToWatchlist(stock)}>{isWatched(stock) ? "★ 已自选" : "☆ 加入自选"}</button>
                      <button type="button" onClick={() => setSelected(stock)}>查看机会计划 <span>→</span></button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.stockPool} aria-labelledby="stock-pool-title">
              <header className={styles.poolHeader}>
                <div><span>STRATEGY POOL</span><h2 id="stock-pool-title">策略股票池</h2></div>
                <p>默认按 AI 评分排序 · 点击股票展开结构化分析</p>
              </header>

              <div className={styles.strategyTabs} role="tablist" aria-label="选股策略">
                {strategyTabs[market].map((tab) => <button key={tab} className={strategy === tab ? styles.activeTab : ""} type="button" role="tab" aria-selected={strategy === tab} onClick={() => setStrategy(tab)}>{tab}{tab === "昨日涨停" && market === "CN" ? <small>61</small> : null}</button>)}
              </div>

              <div className={styles.filters}>
                <label><span>题材</span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option>全部题材</option>{availableThemes.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label><span>最低评分</span><select value={minimumScore} onChange={(event) => setMinimumScore(Number(event.target.value))}><option value={60}>60+</option><option value={70}>70+</option><option value={80}>80+</option><option value={90}>90+</option></select></label>
                <label><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="score">AI评分</option><option value="probability">上涨概率</option><option value="change">涨幅</option><option value="volume">量能</option></select></label>
                <span className={styles.resultCount}>{visibleStocks.length} 只符合条件</span>
              </div>

              <div className={styles.tableWrap}>
                <table>
                  <thead><tr><th>股票</th><th>核心信号</th><th>价格 / 涨幅</th><th>量能</th><th>换手率</th><th>机会评分</th><th>风险</th><th>建议</th><th aria-label="操作" /></tr></thead>
                  <tbody>
                    {visibleStocks.map((stock) => (
                      <tr key={`${stock.market}-${stock.symbol}`} onClick={() => setSelected(stock)}>
                        <td><div className={styles.stockCell}><span>{stock.name.slice(0, 1)}</span><div><strong>{stock.name}</strong><small>{stock.symbol} · {stock.exchange}</small></div></div></td>
                        <td><strong className={styles.signalLabel}>{stock.signal}</strong><small className={styles.sectorLabel}>{stock.sector}</small></td>
                        <td><strong>{stock.currency === "CNY" ? "¥" : "$"}{stock.price.toFixed(2)}</strong><small className={styles.upText}>+{stock.change.toFixed(2)}%</small></td>
                        <td><strong>{stock.volumeRatio.toFixed(2)}x</strong><small>{stock.amount}</small></td>
                        <td><strong>{stock.turnover.toFixed(1)}%</strong><small>收盘 {stock.closePosition.toFixed(0)}%</small></td>
                        <td><div className={styles.tableScore}><strong>{stock.score}</strong><span><i style={{ width: `${stock.score}%` }} /></span></div></td>
                        <td><strong className={riskClass(stock.risk, styles)}>{stock.risk}</strong><small>{stock.risk >= 60 ? "偏高" : stock.risk >= 40 ? "中等" : "可控"}</small></td>
                        <td><strong>{recommendationIcon(stock.recommendation)} {stock.recommendation}</strong><small>{stock.probability}% 样本概率</small></td>
                        <td><button className={styles.rowAction} type="button" onClick={(event) => { event.stopPropagation(); addToWatchlist(stock); }} aria-label={`${isWatched(stock) ? "置顶" : "加入"}${stock.name}自选`}>{isWatched(stock) ? "★" : "☆"}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visibleStocks.length ? <div className={styles.emptyState}><strong>当前条件下没有样本</strong><span>降低最低评分或切换题材后再试。</span></div> : null}
              </div>
            </section>
          </div>

          <aside className={styles.insightRail} aria-label="市场结构与热门题材">
            {market === "CN" ? (
              <section className={styles.ladderCard}>
                <header><div><span>LIMIT-UP LADDER</span><h2>连板梯队</h2></div><strong>最高 6板</strong></header>
                <div className={styles.ladder}>
                  {[{ level: "6板", names: ["航天动力"] }, { level: "5板", names: ["华明装备"] }, { level: "4板", names: ["东芯股份", "北方长龙"] }, { level: "3板", names: ["三六零", "中马传动"] }, { level: "2板", names: ["浪潮信息", "中大力德", "云天励飞"] }].map((row) => <div key={row.level}><strong>{row.level}</strong><span>{row.names.map((name) => <button type="button" key={name}>{name}</button>)}</span></div>)}
                </div>
                <dl className={styles.ladderStats}><div><dt>晋级率</dt><dd>26%</dd></div><div><dt>炸板率</dt><dd>19%</dd></div><div><dt>首板</dt><dd>42</dd></div></dl>
                <p>高位股炸板率开始抬升，空间板只观察情绪，不作为默认追涨标的。</p>
              </section>
            ) : (
              <section className={styles.ladderCard}>
                <header><div><span>US QUALITY GATE</span><h2>默认质量过滤</h2></div><strong>已开启</strong></header>
                <div className={styles.qualityRules}><span><i />市值 &gt; $500M</span><span><i />股价 &gt; $5</span><span><i />日均成交额 &gt; $10M</span><span><i />剔除异常低流动性</span></div>
                <dl className={styles.ladderStats}><div><dt>通过</dt><dd>684</dd></div><div><dt>新高</dt><dd>143</dd></div><div><dt>Gap &gt;5%</dt><dd>38</dd></div></dl>
                <p>质量过滤先于动量排序，避免高涨幅但难以成交的低流动性样本进入推荐池。</p>
              </section>
            )}

            <section className={styles.themeCard}>
              <header><div><span>MARKET THEMES</span><h2>今日主线</h2></div><small>样本热度</small></header>
              <ol>{themesByMarket[market].map((item, index) => <li key={item.name}><button type="button" onClick={() => setTheme(item.name)}><b>{index + 1}</b><span><strong>{item.name}</strong><small>{"●".repeat(item.heat)}<i>{"●".repeat(5 - item.heat)}</i></small></span><em>{item.change}<small>{item.count} 个信号</small></em></button></li>)}</ol>
            </section>

            <section className={styles.scaleCard}>
              <span>SCORE GUIDE</span><h2>机会评分说明</h2>
              <div><i className={styles.scoreStrong}>90</i><span><strong>强烈关注</strong><small>优先进入研究清单</small></span></div>
              <div><i className={styles.scoreGood}>80</i><span><strong>值得关注</strong><small>等待价格与量能确认</small></span></div>
              <div><i className={styles.scoreWatch}>70</i><span><strong>观察</strong><small>信号尚未完全闭环</small></span></div>
              <p>评分仅描述短线交易机会质量，不代表公司长期投资价值，也不构成投资建议。</p>
            </section>
          </aside>
        </div>

        <footer className={styles.disclaimer}><strong>数据说明</strong><span>本页为智能选股产品演示，行情、概率、评分与交易区间均为样本数据；正式版本需接入实时行情、交易日历与回测模型后方可用于研究。</span></footer>
      </main>

      {selected ? <OpportunityDrawer stock={selected} watched={isWatched(selected)} onClose={() => setSelected(null)} onAdd={() => addToWatchlist(selected)} /> : null}
      {toast ? <div className={styles.toast} role="status"><i />{toast}</div> : null}
    </div>
  );
}

function OpportunityDrawer({ stock, watched, onClose, onAdd }: { stock: Opportunity; watched: boolean; onClose: () => void; onAdd: () => void }) {
  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className={styles.drawerHeader}>
          <div><span>{stock.exchange} · {stock.signal}</span><h2 id="drawer-title">{stock.name} <small>{stock.symbol}</small></h2></div>
          <button type="button" onClick={onClose} aria-label="关闭机会详情">×</button>
        </header>
        <div className={styles.drawerQuote}>
          <div><span>样本价格</span><strong>{stock.currency === "CNY" ? "¥" : "$"}{stock.price.toFixed(2)}</strong><em>+{stock.change.toFixed(2)}%</em></div>
          <div className={styles.drawerScore}><span>AI 机会评分</span><strong>{stock.score}</strong><small>{recommendationIcon(stock.recommendation)} {stock.recommendation}</small></div>
        </div>
        <div className={styles.miniChart} aria-label="示意趋势图"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><span /></div>

        {stock.risk >= 60 ? <div className={styles.chaseWarning}><strong>⚠ 强势，但不建议当前位置追高</strong><span>风险评分 {stock.risk}，等待分歧回踩后重新评估风险收益比。</span></div> : null}

        <section className={styles.drawerSection}>
          <header><h3>因子拆解</h3><span>风险评分 <strong className={riskClass(stock.risk, styles)}>{stock.risk}</strong></span></header>
          <div className={styles.factorGrid}>{stock.factorScores.map((factor) => <div key={factor.label}><span>{factor.label}<strong>{factor.value}</strong></span><i><b style={{ width: `${factor.value}%` }} /></i></div>)}</div>
        </section>

        <section className={styles.drawerSection}>
          <header><h3>为什么进入候选池</h3><span>{stock.themes.join(" · ")}</span></header>
          <ul className={styles.reasonList}>{stock.reasons.map((reason) => <li key={reason}><i>✓</i>{reason}</li>)}</ul>
        </section>

        <section className={styles.drawerSection}>
          <header><h3>主要风险</h3><span>先看风险，再看空间</span></header>
          <ul className={styles.riskList}>{stock.risks.map((risk) => <li key={risk}><i>!</i>{risk}</li>)}</ul>
        </section>

        <section className={`${styles.drawerSection} ${styles.tradePlan}`}>
          <header><h3>机会计划</h3><span>样本区间 · 非交易指令</span></header>
          <dl><div><dt>建议关注</dt><dd>{stock.plan.watch}</dd></div><div><dt>突破确认</dt><dd>{stock.plan.breakout}</dd></div><div><dt>风险失效</dt><dd>{stock.plan.stop}</dd></div><div><dt>观察目标</dt><dd>{stock.plan.targets}</dd></div></dl>
        </section>

        <div className={styles.drawerActions}>
          <button type="button" onClick={onAdd}>{watched ? "★ 已在自选 · 置顶" : "☆ 加入自选"}</button>
          <Link href={`/?stock=${encodeURIComponent(stockRouteKey({ code: stock.symbol, market: stock.market }))}`}>查看完整个股分析 <span>→</span></Link>
        </div>
      </aside>
    </div>
  );
}

function recommendationIcon(recommendation: Recommendation) {
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
