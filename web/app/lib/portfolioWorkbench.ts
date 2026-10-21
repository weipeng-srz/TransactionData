import { calculateHoldingMetrics, type HoldingMetrics, type StockHoldings } from "./holdings.ts";
import type { NewsItem } from "./news.ts";
import type { NextDayPredictionReport } from "./nextDayPrediction.ts";
import { buildPortfolioPredictionConclusion } from "./portfolioPrediction.ts";
import { currencyOf, marketOf, stockStorageKey, type StockCurrency, type StockMarket } from "./security.ts";
import type { ScreenerFeed, ScreenerOpportunity } from "./screenerTypes.ts";
import type { StockScoreReport } from "./stockScore.ts";
import { calculatePortfolioTotals, type PortfolioTotals, type WatchlistStock } from "./watchlist.ts";

export type PortfolioTechnicalSignal = {
  side: "B" | "S";
  date: string;
  price: number;
  score: number;
  reasons: string[];
};

export type PortfolioWorkbenchQuote = {
  status: "idle" | "loading" | "ready" | "error";
  partial?: boolean;
  price: number | null;
  change?: number | null;
  changePct: number | null;
  date: string;
  time: string;
  score: StockScoreReport | null;
  prediction: NextDayPredictionReport | null;
  technicalSignal?: PortfolioTechnicalSignal | null;
  newsItems?: NewsItem[];
  newsStatus?: "idle" | "loading" | "ready" | "error";
  newsError?: string;
};

export type PortfolioWorkbenchActionName =
  | "集中度复核"
  | "止损候选"
  | "止盈候选"
  | "减仓候选"
  | "加仓条件复核"
  | "风险证据复核"
  | "数据待核验"
  | "继续观察";

export type PortfolioWorkbenchAction = {
  key: string;
  code: string;
  stockName: string;
  market: StockMarket;
  currency: StockCurrency;
  action: PortfolioWorkbenchActionName;
  actionable: boolean;
  priority: number;
  reason: string;
  secondaryReasons: string[];
  source: "组合风控" | "明日模型" | "综合评分" | "数据状态";
  referenceLabel: string;
  referencePrice: number | null;
  confidence: number | null;
  score: number | null;
  quoteDate: string;
};

export type PortfolioHoldingAnalysis = {
  key: string;
  code: string;
  stockName: string;
  market: StockMarket;
  currency: StockCurrency;
  shares: number;
  cost: number;
  price: number | null;
  marketValue: number | null;
  profit: number | null;
  profitPct: number | null;
  dayChangePct: number | null;
  weightPct: number | null;
  action: PortfolioWorkbenchAction;
};

export type PortfolioBsSignal = {
  key: string;
  code: string;
  stockName: string;
  market: StockMarket;
  kind: "technical" | "evidence";
  side: "B" | "S";
  score: number;
  coverage: number | null;
  headline: string;
  detail: string;
  occurredAt: string;
  price: number | null;
  hasHolding: boolean;
};

export type PortfolioAttentionNews = {
  key: string;
  stockKey: string;
  code: string;
  stockName: string;
  market: StockMarket;
  title: string;
  summary: string;
  url: string;
  media: string;
  publishedAt: string;
  sentiment: NewsItem["sentiment"];
  eventType: NonNullable<NewsItem["eventType"]> | "其他事件";
  sourceQuality: NonNullable<NewsItem["sourceQuality"]> | "低";
  attention: "风险" | "利好" | "事件";
};

export type PortfolioSignalConflict = {
  key: string;
  stockName: string;
  hasHolding: boolean;
  summary: string;
};

export type PortfolioCoverage = {
  tracked: number;
  ready: number;
  partial: number;
  loading: number;
  failed: number;
  lagging: number;
  latestUpdate: string;
  failedKeys: string[];
};

export type PortfolioNewsCoverage = PortfolioCoverage & {
  totalItems: number;
};

export type PortfolioWorkbenchDigest = {
  totals: PortfolioTotals;
  holdings: PortfolioHoldingAnalysis[];
  actions: PortfolioWorkbenchAction[];
  bsSignals: PortfolioBsSignal[];
  attentionNews: PortfolioAttentionNews[];
  conflicts: PortfolioSignalConflict[];
  quoteCoverage: PortfolioCoverage;
  newsCoverage: PortfolioNewsCoverage;
  actionableCount: number;
  observeCount: number;
  technicalSignalCount: number;
  evidenceSignalCount: number;
  signalConflictCount: number;
  holdingConflictCount: number;
  negativeNewsCount: number;
  concentrationThresholdPct: number;
};

const minimumModelConfidence = 65;
const concentrationReviewThresholdPct = 60;
const newsRecencyDays = 14;
const standaloneQuoteFreshnessDays = 4;

export type PortfolioSignalAvailability = {
  state: "idle" | "loading" | "ready" | "empty" | "partial" | "error";
  value: string;
  detail: string;
  emptyText: string;
  tone: "neutral" | "warning" | "risk";
};

export function buildPortfolioSignalAvailability(
  coverage: PortfolioCoverage,
  technicalSignalCount: number,
  evidenceSignalCount: number,
): PortfolioSignalAvailability {
  if (!coverage.tracked) return { state: "idle", value: "待建立", detail: "添加自选后计算技术触发与综合证据", emptyText: "添加自选股后会计算技术 B/S 触发与综合证据。", tone: "neutral" };
  if (coverage.failed === coverage.tracked) return { state: "error", value: "不可用", detail: `${coverage.failed} 只行情失败，暂不能判断 B/S`, emptyText: "行情全部不可用，暂不能判断是否存在技术 B/S 触发；请先重试行情。", tone: "risk" };
  if (coverage.loading) return { state: "loading", value: "计算中", detail: `已显示 ${technicalSignalCount} 个技术触发 · ${coverage.loading} 只待完成`, emptyText: "技术信号与综合证据正在计算，当前不能得出“未触发”结论。", tone: "warning" };
  if (coverage.partial || coverage.failed || coverage.lagging) {
    const freshReady = Math.max(0, coverage.ready - coverage.lagging);
    return { state: "partial", value: "部分可用", detail: `${technicalSignalCount} 个技术触发 · 完整且新鲜 ${freshReady}/${coverage.tracked} 只`, emptyText: "行情覆盖或时效不完整，当前只展示已有结果，不能得出“没有近期 B/S 触发”结论。", tone: "warning" };
  }
  return technicalSignalCount
    ? { state: "ready", value: `${technicalSignalCount} 个`, detail: `${evidenceSignalCount} 个综合证据倾向 · 二者口径分开`, emptyText: "", tone: "neutral" }
    : { state: "empty", value: "0 个", detail: `${evidenceSignalCount} 个综合证据倾向 · 完整行情已核验`, emptyText: "完整行情中未发现近期技术 B/S 触发，综合评分也未形成明确倾向。", tone: "neutral" };
}

export function buildPortfolioWorkbenchDigest(
  watchlist: WatchlistStock[],
  holdings: StockHoldings,
  quotes: Record<string, PortfolioWorkbenchQuote | undefined>,
): PortfolioWorkbenchDigest {
  const totalQuotes: Record<string, { price?: number | null; change?: number | null }> = {};
  Object.entries(quotes).forEach(([key, quote]) => {
    if (quote) totalQuotes[key] = quote;
  });
  const totals = calculatePortfolioTotals(watchlist, holdings, totalQuotes);
  const latestMarketDates = latestQuoteDatesByMarket(watchlist, quotes);
  const positions = watchlist.flatMap((stock) => {
    const key = stockStorageKey(stock);
    const holding = holdings[key];
    if (!holding) return [];
    const quote = quotes[key];
    const metrics = calculateHoldingMetrics(holding.shares, holding.cost, quote?.price);
    const currency = currencyOf(stock);
    const currencyMarketValue = totals.byCurrency[currency].marketValue;
    const weightPct = metrics && currencyMarketValue > 0 ? metrics.marketValue / currencyMarketValue * 100 : null;
    return [{ stock, key, holding, quote, metrics, currency, weightPct, staleReason: quoteStaleReason(stock, quote, latestMarketDates) }];
  });
  const actions = positions.map(({ stock, quote, metrics, weightPct, staleReason }) => (
    actionFor(stock, quote, metrics, weightPct, staleReason)
  )).sort((left, right) => right.priority - left.priority || left.stockName.localeCompare(right.stockName));
  const actionsByKey = new Map(actions.map((action) => [action.key, action]));
  const holdingAnalysis = positions.map(({ stock, key, holding, quote, metrics, currency, weightPct }): PortfolioHoldingAnalysis => ({
    key,
    code: stock.code,
    stockName: stock.name,
    market: marketOf(stock),
    currency,
    shares: holding.shares,
    cost: holding.cost,
    price: finiteOrNull(quote?.price),
    marketValue: metrics?.marketValue ?? null,
    profit: metrics?.profit ?? null,
    profitPct: metrics?.profitPct ?? null,
    dayChangePct: finiteOrNull(quote?.changePct),
    weightPct,
    action: actionsByKey.get(key)!,
  })).sort((left, right) => right.action.priority - left.action.priority || (left.profitPct ?? 0) - (right.profitPct ?? 0));

  const bsSignals = buildBsSignals(watchlist, holdings, quotes);
  const attentionNews = selectAttentionNews(watchlist, quotes);
  const conflicts = buildSignalConflicts(watchlist, holdings, quotes);
  const quoteCoverage = buildQuoteCoverage(watchlist, quotes);
  const newsCoverage = buildNewsCoverage(watchlist, quotes);

  return {
    totals,
    holdings: holdingAnalysis,
    actions,
    bsSignals,
    attentionNews,
    conflicts,
    quoteCoverage,
    newsCoverage,
    actionableCount: actions.filter((item) => item.actionable).length,
    observeCount: actions.filter((item) => !item.actionable).length,
    technicalSignalCount: bsSignals.filter((item) => item.kind === "technical").length,
    evidenceSignalCount: bsSignals.filter((item) => item.kind === "evidence").length,
    signalConflictCount: conflicts.length,
    holdingConflictCount: conflicts.filter((item) => item.hasHolding).length,
    negativeNewsCount: attentionNews.filter((item) => item.sentiment === "负面").length,
    concentrationThresholdPct: concentrationReviewThresholdPct,
  };
}

export function selectPortfolioDiscoveryIdeas(
  feeds: Partial<Record<StockMarket, ScreenerFeed>>,
  watchlist: WatchlistStock[],
  limit = 6,
): ScreenerOpportunity[] {
  const watched = new Set(watchlist.map(stockStorageKey));
  const eligible = Object.values(feeds).flatMap((feed) => feed?.opportunities ?? [])
    .filter((idea) => !watched.has(stockStorageKey({ code: idea.symbol, market: idea.market })))
    .filter((idea) => ["强烈关注", "值得关注"].includes(idea.recommendation))
    .filter((idea) => idea.risk <= 70 && idea.plan.rewardRisk >= 1)
    .filter((idea) => idea.market === "CN" || idea.qualityTier === "standard")
    .sort((left, right) => discoveryRank(right) - discoveryRank(left));
  const selected: ScreenerOpportunity[] = [];
  for (const market of ["CN", "US"] as StockMarket[]) {
    selected.push(...eligible.filter((idea) => idea.market === market).slice(0, Math.ceil(limit / 2)));
  }
  return selected.sort((left, right) => discoveryRank(right) - discoveryRank(left)).slice(0, limit);
}

function actionFor(
  stock: WatchlistStock,
  quote: PortfolioWorkbenchQuote | undefined,
  metrics: HoldingMetrics | null,
  weightPct: number | null,
  staleReason: string | null,
): PortfolioWorkbenchAction {
  const key = stockStorageKey(stock);
  const base = {
    key,
    code: stock.code,
    stockName: stock.name,
    market: marketOf(stock),
    currency: currencyOf(stock),
    confidence: quote?.prediction?.signal.decisionConfidence ?? null,
    score: quote?.score?.score ?? null,
    quoteDate: quote?.date ?? "",
    secondaryReasons: [] as string[],
  };
  const concentrationReason = weightPct != null && weightPct >= concentrationReviewThresholdPct
    ? `${stock.name} 占${currencyName(currencyOf(stock))}子组合 ${weightPct.toFixed(1)}%，超过默认 ${concentrationReviewThresholdPct}% 复核阈值。`
    : "";
  if (!quote || quote.status !== "ready" || !quote.date || !metrics) {
    return {
      ...base,
      secondaryReasons: concentrationReason ? [concentrationReason] : [],
      action: "数据待核验",
      actionable: true,
      priority: 110,
      reason: "行情或持仓复算尚未就绪，不能形成操作方向。",
      source: "数据状态",
      referenceLabel: "参考位",
      referencePrice: null,
    };
  }
  if (quote.partial) {
    return {
      ...base,
      secondaryReasons: concentrationReason ? [concentrationReason] : [],
      action: "数据待核验",
      actionable: true,
      priority: 108,
      reason: "历史或实时行情仅部分可用，操作方向需等待完整行情复核。",
      source: "数据状态",
      referenceLabel: "参考位",
      referencePrice: null,
    };
  }
  if (staleReason) {
    return {
      ...base,
      secondaryReasons: concentrationReason ? [concentrationReason] : [],
      action: "数据待核验",
      actionable: true,
      priority: 107,
      reason: staleReason,
      source: "数据状态",
      referenceLabel: "行情过期待核验",
      referencePrice: null,
    };
  }
  const conclusion = quote.prediction ? buildPortfolioPredictionConclusion(quote.prediction) : null;
  const decision = quote.prediction?.decisionSupport;
  const confident = (quote.prediction?.signal.decisionConfidence ?? 0) >= minimumModelConfidence;
  if (quote.prediction && !confident) {
    return {
      ...base,
      secondaryReasons: concentrationReason ? [concentrationReason] : [],
      action: "数据待核验",
      actionable: true,
      priority: 76,
      reason: `模型给出${conclusion?.action ?? "持有"}观察，但置信分 ${quote.prediction.signal.decisionConfidence}/100 低于 ${minimumModelConfidence}/100 复核门槛。`,
      source: "明日模型",
      referenceLabel: conclusion?.action === "止盈" ? "模型兑现参考" : "模型风险参考",
      referencePrice: conclusion?.action === "止盈" ? decision?.takeProfitReference ?? null : decision?.riskReference ?? null,
    };
  }
  if (concentrationReason) {
    const secondaryReasons = [
      quote.newsStatus === "error" ? "该股新闻扫描失败，消息面风险尚未完成核验。" : "",
      conclusion && conclusion.action !== "持有" ? `明日模型另有${conclusion.action}候选，需结合个人交易计划复核。` : "",
      quote.score?.signal.tone === "sell" ? quote.score.signal.headline : "",
    ].filter(Boolean);
    return {
      ...base,
      secondaryReasons,
      action: "集中度复核",
      actionable: true,
      priority: 120,
      reason: concentrationReason,
      source: "组合风控",
      referenceLabel: "同币种权重",
      referencePrice: null,
    };
  }
  if (quote.newsStatus === "error") {
    return {
      ...base,
      action: "数据待核验",
      actionable: true,
      priority: 105,
      reason: "该股新闻扫描失败，消息面风险尚未完成核验。",
      source: "数据状态",
      referenceLabel: "参考位",
      referencePrice: null,
    };
  }
  if (!quote.prediction) {
    if (quote.score?.signal.tone === "sell") {
      return { ...base, action: "风险证据复核", actionable: true, priority: 80, reason: quote.score.signal.headline, source: "综合评分", referenceLabel: "风险参考", referencePrice: null };
    }
    return { ...base, action: "数据待核验", actionable: true, priority: 70, reason: "明日模型尚未形成，当前仅保留持仓事实与综合证据。", source: "数据状态", referenceLabel: "参考位", referencePrice: null };
  }

  if (!conclusion || !decision) return { ...base, action: "数据待核验", actionable: true, priority: 70, reason: "明日模型结构不完整，当前不能形成操作方向。", source: "数据状态", referenceLabel: "参考位", referencePrice: null };
  if (conclusion.action === "止损") {
    return { ...base, action: "止损候选", actionable: true, priority: 100, reason: `${decision.summary} 这是单日模型候选，需与个人止损计划核对。`, source: "明日模型", referenceLabel: "模型风险参考", referencePrice: decision.riskReference };
  }
  if (conclusion.action === "减仓") {
    return { ...base, action: "减仓候选", actionable: true, priority: 90, reason: `${decision.summary} 需结合目标仓位与交易周期复核。`, source: "明日模型", referenceLabel: "模型风险参考", referencePrice: decision.riskReference };
  }
  if (conclusion.action === "止盈") {
    return { ...base, action: "止盈候选", actionable: true, priority: 85, reason: `${decision.summary} 这是模型兑现观察位，不是自动卖出指令。`, source: "明日模型", referenceLabel: "模型兑现参考", referencePrice: decision.takeProfitReference };
  }
  if (quote.score?.signal.tone === "sell") {
    return { ...base, action: "风险证据复核", actionable: true, priority: 80, reason: `${quote.score.signal.headline}；明日模型尚未给出退出确认。`, source: "综合评分", referenceLabel: "模型风险参考", referencePrice: decision.riskReference };
  }
  if (quote.score?.signal.tone === "buy" && decision.tone === "positive" && confident) {
    return { ...base, action: "加仓条件复核", actionable: true, priority: 65, reason: "综合证据与明日方向同时偏强；仍需先确认目标仓位、集中度上限与个人风险线。", source: "明日模型", referenceLabel: "模型风险参考", referencePrice: decision.riskReference };
  }
  return { ...base, action: "继续观察", actionable: false, priority: 20, reason: decision.summary, source: "明日模型", referenceLabel: "模型风险参考", referencePrice: decision.riskReference };
}

function buildBsSignals(
  watchlist: WatchlistStock[],
  holdings: StockHoldings,
  quotes: Record<string, PortfolioWorkbenchQuote | undefined>,
): PortfolioBsSignal[] {
  return watchlist.flatMap((stock): PortfolioBsSignal[] => {
    const key = stockStorageKey(stock);
    const quote = quotes[key];
    const result: PortfolioBsSignal[] = [];
    if (quote?.technicalSignal) {
      result.push({
        key: `${key}:technical`, code: stock.code, stockName: stock.name, market: marketOf(stock), kind: "technical",
        side: quote.technicalSignal.side, score: quote.technicalSignal.score, coverage: null,
        headline: quote.technicalSignal.side === "B" ? "技术 B 点触发" : "技术 S 点触发",
        detail: quote.technicalSignal.reasons.join("、"), occurredAt: quote.technicalSignal.date,
        price: quote.technicalSignal.price, hasHolding: Boolean(holdings[key]),
      });
    }
    const report = quote?.score;
    if (report && report.signal.tone !== "hold") {
      result.push({
        key: `${key}:evidence`, code: stock.code, stockName: stock.name, market: marketOf(stock), kind: "evidence",
        side: report.signal.tone === "buy" ? "B" : "S", score: report.score, coverage: report.coverage,
        headline: report.signal.tone === "buy" ? "综合证据偏强" : "综合证据偏弱",
        detail: report.signal.headline, occurredAt: quote?.date ?? "", price: finiteOrNull(quote?.price), hasHolding: Boolean(holdings[key]),
      });
    }
    return result;
  }).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "technical" ? -1 : 1;
    if (left.side !== right.side) return left.side === "S" ? -1 : 1;
    return left.side === "B" ? right.score - left.score : left.score - right.score;
  });
}

function buildSignalConflicts(
  watchlist: WatchlistStock[], holdings: StockHoldings,
  quotes: Record<string, PortfolioWorkbenchQuote | undefined>,
): PortfolioSignalConflict[] {
  return watchlist.flatMap((stock): PortfolioSignalConflict[] => {
    const key = stockStorageKey(stock);
    const quote = quotes[key];
    if (!quote) return [];
    const directions: string[] = [];
    const scoreTone = quote.score?.signal.tone;
    const predictionAction = quote.prediction ? buildPortfolioPredictionConclusion(quote.prediction).action : null;
    if (scoreTone === "buy" && predictionAction && ["止损", "减仓"].includes(predictionAction)) directions.push("综合证据偏强，但明日模型提示风险");
    if (scoreTone === "sell" && predictionAction === "持有") directions.push("综合证据偏弱，但明日模型仍为持有观察");
    if (quote.technicalSignal?.side === "B" && scoreTone === "sell") directions.push("技术 B 点与综合弱势证据相反");
    if (quote.technicalSignal?.side === "S" && scoreTone === "buy") directions.push("技术 S 点与综合强势证据相反");
    return directions.length ? [{ key, stockName: stock.name, hasHolding: Boolean(holdings[key]), summary: directions.join("；") }] : [];
  });
}

function buildQuoteCoverage(watchlist: WatchlistStock[], quotes: Record<string, PortfolioWorkbenchQuote | undefined>): PortfolioCoverage {
  const states = watchlist.map((stock) => ({ stock, key: stockStorageKey(stock), quote: quotes[stockStorageKey(stock)] }));
  const marketLatest = latestQuoteDatesByMarket(watchlist, quotes);
  const failedStates = states.filter(({ quote }) => quote?.status === "error");
  return {
    tracked: watchlist.length,
    ready: states.filter(({ quote }) => quote?.status === "ready" && !quote.partial).length,
    partial: states.filter(({ quote }) => quote?.status === "ready" && quote.partial).length,
    loading: states.filter(({ quote }) => !quote || quote.status === "idle" || quote.status === "loading").length,
    failed: failedStates.length,
    lagging: states.filter(({ stock, quote }) => quote?.status === "ready" && quote.date && quote.date < (marketLatest[marketOf(stock)] ?? quote.date)).length,
    latestUpdate: states.map(({ quote }) => quote?.date ? `${quote.date}${quote.time ? ` ${quote.time}` : ""}` : "").filter(Boolean).sort().at(-1) ?? "",
    failedKeys: failedStates.map(({ key }) => key),
  };
}

function latestQuoteDatesByMarket(
  watchlist: WatchlistStock[],
  quotes: Record<string, PortfolioWorkbenchQuote | undefined>,
): Partial<Record<StockMarket, string>> {
  const latest: Partial<Record<StockMarket, string>> = {};
  watchlist.forEach((stock) => {
    const quote = quotes[stockStorageKey(stock)];
    if (quote?.status !== "ready" || !quote.date) return;
    const market = marketOf(stock);
    latest[market] = [latest[market] ?? "", quote.date].sort().at(-1);
  });
  return latest;
}

function quoteStaleReason(
  stock: WatchlistStock,
  quote: PortfolioWorkbenchQuote | undefined,
  marketLatest: Partial<Record<StockMarket, string>>,
): string | null {
  if (quote?.status !== "ready" || !quote.date) return null;
  const latest = marketLatest[marketOf(stock)];
  if (latest && quote.date < latest) return `该股行情 ${quote.date} 落后同市场最新时点 ${latest}，需刷新后再形成操作方向。`;
  const timestamp = newsTimestamp(quote.date);
  if (timestamp && Date.now() - timestamp > standaloneQuoteFreshnessDays * 86_400_000) {
    return `该股行情停留在 ${quote.date}，已超出 ${standaloneQuoteFreshnessDays} 日新鲜度窗口。`;
  }
  return null;
}

function buildNewsCoverage(watchlist: WatchlistStock[], quotes: Record<string, PortfolioWorkbenchQuote | undefined>): PortfolioNewsCoverage {
  const states = watchlist.map((stock) => ({ key: stockStorageKey(stock), quote: quotes[stockStorageKey(stock)] }));
  const newsStatus = (quote: PortfolioWorkbenchQuote | undefined) => quote?.newsStatus ?? (quote?.newsItems ? "ready" : quote?.status === "error" ? "error" : quote?.status === "loading" ? "loading" : "idle");
  const failedStates = states.filter(({ quote }) => newsStatus(quote) === "error");
  return {
    tracked: watchlist.length,
    ready: states.filter(({ quote }) => newsStatus(quote) === "ready").length,
    partial: 0,
    loading: states.filter(({ quote }) => ["idle", "loading"].includes(newsStatus(quote))).length,
    failed: failedStates.length,
    lagging: 0,
    latestUpdate: states.flatMap(({ quote }) => quote?.newsItems?.map((item) => item.publishedAt) ?? []).filter(Boolean).sort().at(-1) ?? "",
    failedKeys: failedStates.map(({ key }) => key),
    totalItems: states.reduce((sum, { quote }) => sum + (quote?.newsItems?.length ?? 0), 0),
  };
}

function selectAttentionNews(watchlist: WatchlistStock[], quotes: Record<string, PortfolioWorkbenchQuote | undefined>): PortfolioAttentionNews[] {
  const seen = new Set<string>();
  const candidates = watchlist.flatMap((stock) => {
    const stockKey = stockStorageKey(stock);
    return (quotes[stockKey]?.newsItems ?? []).flatMap((item): PortfolioAttentionNews[] => {
      const dedupeKey = `${stockKey}:${item.url || item.title}`;
      if (seen.has(dedupeKey)) return [];
      seen.add(dedupeKey);
      return [{
        key: dedupeKey, stockKey, code: stock.code, stockName: stock.name, market: marketOf(stock), title: item.title,
        summary: item.summary, url: item.url, media: item.media || item.portal || "来源待核验", publishedAt: item.publishedAt,
        sentiment: item.sentiment, eventType: item.eventType ?? "其他事件", sourceQuality: item.sourceQuality ?? "低",
        attention: item.sentiment === "负面" ? "风险" : item.sentiment === "正面" ? "利好" : "事件",
      }];
    });
  });
  const quoteAnchor = Math.max(0, ...watchlist.map((stock) => newsTimestamp(quotes[stockStorageKey(stock)]?.date ?? "")));
  const cutoff = (quoteAnchor || Date.now()) - newsRecencyDays * 86_400_000;
  return candidates
    .filter((item) => newsTimestamp(item.publishedAt) >= cutoff)
    .sort((left, right) => newsRank(right) - newsRank(left) || right.publishedAt.localeCompare(left.publishedAt));
}

function newsRank(item: PortfolioAttentionNews): number {
  return (item.sentiment === "负面" ? 5 : item.sentiment === "正面" ? 3 : 1)
    + (item.sourceQuality === "高" ? 4 : item.sourceQuality === "中" ? 2 : 0)
    + (item.eventType === "其他事件" ? 0 : 2);
}

function newsTimestamp(value: string): number {
  const parsed = Date.parse(value.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function discoveryRank(idea: ScreenerOpportunity): number {
  return idea.score + idea.confidence * .12 + idea.plan.rewardRisk * 3 - idea.risk * .18;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function currencyName(currency: StockCurrency): string {
  return currency === "USD" ? "美元" : "人民币";
}
