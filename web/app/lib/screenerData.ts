import { fetchGlobalIndexFeed, type GlobalIndexFeed } from "./globalIndexes.ts";
import { fetchUSDailyRows } from "./usStockMarket.ts";
import type {
  ScreenerFeed,
  ScreenerMarket,
  ScreenerOpportunity,
  ScreenerRecommendation,
  ScreenerSnapshot,
  ScreenerStructure,
  ScreenerTheme,
} from "./screenerTypes.ts";

const cnListEndpoint = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";
const cnCountEndpoint = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount";
const cnDailyEndpoint = "https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData";
const usListEndpoint = "https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20_trendsight=/US_CategoryService.getList";
const eastmoneyEndpoint = "https://push2ex.eastmoney.com";
const maxResponseBytes = 2 * 1024 * 1024;
const cacheTtlMs: Record<ScreenerMarket, number> = { CN: 90_000, US: 120_000 };
const cache = new Map<ScreenerMarket, { value: ScreenerFeed; expiresAt: number }>();
const pending = new Map<ScreenerMarket, Promise<ScreenerFeed>>();

type CNQuote = {
  symbol: string;
  code: string;
  name: string;
  price: number;
  change: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  marketCap: number;
  floatMarketCap: number;
  turnover: number;
  tickTime: string;
};

type USQuote = {
  symbol: string;
  name: string;
  exchange: string;
  category: string;
  price: number;
  change: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  marketCap: number;
};

type DailyRow = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
};

type LimitPoolItem = {
  code: string;
  name: string;
  price: number;
  change: number;
  amount: number;
  floatMarketCap: number;
  turnover: number;
  streak: number;
  firstLimit: number;
  lastLimit: number;
  sealFund: number;
  burstCount: number;
  sector: string;
  limitPrice: number;
};

type LimitPool = { tradeDate: string; total: number; items: LimitPoolItem[] };

type AnalysisSeed = {
  market: ScreenerMarket;
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  change: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  marketCap: number;
  turnover: number;
  sector: string;
  themes: string[];
  streak: number;
  firstLimit?: string;
  sealStrength?: number;
  wasYesterdayLimit: boolean;
  isCurrentLimit: boolean;
};

export async function fetchScreenerFeed(market: ScreenerMarket): Promise<ScreenerFeed> {
  const now = Date.now();
  const cached = cache.get(market);
  if (cached && cached.expiresAt > now) return cached.value;
  const active = pending.get(market);
  if (active) return active;

  const request = (market === "CN" ? buildCNFeed() : buildUSFeed())
    .then((value) => {
      cache.set(market, { value, expiresAt: Date.now() + cacheTtlMs[market] });
      return value;
    })
    .finally(() => pending.delete(market));
  pending.set(market, request);
  return request;
}

export function normalizeScreenerMarket(value: unknown): ScreenerMarket {
  return String(value ?? "CN").toUpperCase() === "US" ? "US" : "CN";
}

export function parseCNListResponse(body: string): CNQuote[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("A股行情列表无法解析");
  }
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const code = String(item.code ?? "").trim();
    const symbol = String(item.symbol ?? "").trim().toLowerCase();
    const price = positiveNumber(item.trade);
    if (!/^\d{6}$/.test(code) || !/^(?:sh|sz|bj)\d{6}$/.test(symbol) || price <= 0) return [];
    return [{
      symbol,
      code,
      name: String(item.name ?? code).trim() || code,
      price,
      change: finiteNumber(item.changepercent),
      previousClose: positiveNumber(item.settlement) || price,
      open: positiveNumber(item.open) || price,
      high: positiveNumber(item.high) || price,
      low: positiveNumber(item.low) || price,
      volume: nonNegativeNumber(item.volume),
      amount: nonNegativeNumber(item.amount),
      marketCap: nonNegativeNumber(item.mktcap) * 10_000,
      floatMarketCap: nonNegativeNumber(item.nmc) * 10_000,
      turnover: nonNegativeNumber(item.turnoverratio),
      tickTime: String(item.ticktime ?? "").trim(),
    }];
  });
}

export function parseUSListResponse(body: string): { count: number; quotes: USQuote[] } {
  const start = body.indexOf("({");
  const end = body.lastIndexOf("})");
  if (start < 0 || end <= start) throw new Error("美股行情列表无法解析");
  let payload: unknown;
  try {
    payload = JSON.parse(body.slice(start + 1, end + 1));
  } catch {
    throw new Error("美股行情列表无法解析");
  }
  const root = payload as { count?: unknown; data?: unknown };
  const rows = Array.isArray(root.data) ? root.data : [];
  const quotes = rows.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const symbol = String(item.symbol ?? "").trim().toUpperCase();
    const price = positiveNumber(item.price);
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) || price <= 0) return [];
    const volume = nonNegativeNumber(item.volume);
    return [{
      symbol,
      name: String(item.cname ?? item.name ?? symbol).trim() || symbol,
      exchange: normalizeUSExchange(item.market),
      category: String(item.category ?? "").trim(),
      price,
      change: finiteNumber(item.chg),
      previousClose: positiveNumber(item.preclose) || price,
      open: positiveNumber(item.open) || price,
      high: positiveNumber(item.high) || price,
      low: positiveNumber(item.low) || price,
      volume,
      amount: price * volume,
      marketCap: nonNegativeNumber(item.mktcap),
    }];
  });
  return { count: Math.max(0, Math.floor(finiteNumber(root.count))), quotes };
}

export function parseCNDailyResponse(body: string): DailyRow[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("A股日线数据无法解析");
  }
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const date = String(item.day ?? item.date ?? "").slice(0, 10);
    const open = positiveNumber(item.open);
    const high = positiveNumber(item.high);
    const low = positiveNumber(item.low);
    const close = positiveNumber(item.close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !open || !high || !low || !close) return [];
    const volume = nonNegativeNumber(item.volume);
    return [{ date, open, high, low, close, volume, amount: close * volume }];
  });
}

export function scoreScreenerOpportunity(seed: AnalysisSeed, rows: DailyRow[]): ScreenerOpportunity {
  if (rows.length < 20) throw new Error(`${seed.symbol} 日线样本不足`);
  const closes = rows.map((row) => row.close);
  const latest = rows.at(-1)!;
  const previousRows = rows.slice(-6, -1);
  const price = seed.price || latest.close;
  const ma5 = average(closes.slice(-5));
  const ma10 = average(closes.slice(-10));
  const ma20 = average(closes.slice(-20));
  const previous20High = Math.max(...rows.slice(-21, -1).map((row) => row.high));
  const previous60High = Math.max(...rows.slice(-61, -1).map((row) => row.high));
  const volumeBase = average(previousRows.map((row) => row.volume)) || latest.volume;
  const volumeRatio = volumeBase > 0 ? seed.volume / volumeBase : 1;
  const closePosition = seed.high > seed.low ? ((price - seed.low) / (seed.high - seed.low)) * 100 : 100;
  const return5 = percentChange(price, rows.at(-6)?.close ?? rows[0].close);
  const return20 = percentChange(price, rows.at(-21)?.close ?? rows[0].close);
  const gap = percentChange(seed.open, seed.previousClose);
  const breakout20 = price >= previous20High * .998;
  const breakout60 = price >= previous60High * .998;
  const atr = averageTrueRange(rows.slice(-16));
  const atrPct = price > 0 ? atr / price * 100 : 0;
  const ma5Distance = ma5 > 0 ? percentChange(price, ma5) : 0;

  const strengthScore = clamp(48 + seed.change * 3 + (closePosition - 50) * .32 - Math.max(0, gap - seed.change) * 1.4, 0, 100);
  const trendScore = clamp(42 + (price > ma5 ? 12 : -8) + (ma5 > ma10 ? 11 : -5) + (ma10 > ma20 ? 11 : -5) + return20 * 1.15 + (breakout20 ? 12 : 0), 0, 100);
  const volumeScore = clamp(40 + Math.min(volumeRatio, 3) * 20 + (seed.change > 0 ? 8 : -8) - Math.max(0, volumeRatio - 4) * 8, 0, 100);
  const momentumScore = clamp(46 + return5 * 2 + return20 * .65 + (breakout20 ? 11 : 0) + (breakout60 ? 7 : 0), 0, 100);
  const contextScore = clamp(52 + Math.min(seed.streak, 3) * 6 + (seed.isCurrentLimit ? 10 : 0) + (seed.wasYesterdayLimit ? 4 : 0), 0, 100);
  const risk = Math.round(clamp(20 + atrPct * 4 + Math.max(0, ma5Distance - 5) * 3 + Math.max(0, return5 - 15) * 1.2 + Math.max(0, seed.turnover - 12) * 1.15 + Math.max(0, seed.streak - 2) * 8, 8, 92));
  const score = Math.round(clamp(strengthScore * .2 + trendScore * .25 + volumeScore * .18 + momentumScore * .22 + contextScore * .15 - Math.max(0, risk - 55) * .18, 0, 100));
  const confidence = Math.round(clamp(38 + score * .46 - risk * .13, 35, 82));
  const recommendation = recommendationFor(score, risk);

  const strategies = seed.market === "CN"
    ? cnStrategies(seed, { breakout20, volumeRatio })
    : usStrategies(seed, { breakout60, volumeRatio, gap, return20, ma20 });
  const signal = signalFor(seed, { breakout20, breakout60, volumeRatio, gap, return20 });
  const reasons = buildReasons(seed, { ma5, ma10, ma20, closePosition, volumeRatio, return5, return20, breakout20, breakout60, gap });
  const risks = buildRisks(seed, { ma5Distance, return5, atrPct, volumeRatio, gap, closePosition });
  const formatPrice = (value: number) => `${seed.market === "CN" ? "¥" : "$"}${value.toFixed(2)}`;
  const stop = Math.max(price - atr * 2, Math.min(price * .97, ma10 * .98));
  const unitRisk = Math.max(price - stop, price * .025);
  const watchLow = risk >= 60 ? Math.max(stop + unitRisk * .35, price - atr) : Math.max(stop + unitRisk * .5, Math.min(price, ma5) * .99);
  const watchHigh = risk >= 60 ? price - atr * .25 : price * 1.005;
  const breakout = Math.max(seed.high, previous20High) * 1.003;

  return {
    market: seed.market,
    symbol: seed.symbol,
    name: seed.name,
    exchange: seed.exchange,
    price,
    currency: seed.market === "CN" ? "CNY" : "USD",
    change: seed.change,
    score,
    risk,
    confidence,
    recommendation,
    signal,
    strategies,
    sector: seed.sector,
    themes: seed.themes.length ? seed.themes : [seed.sector],
    streak: seed.streak,
    volumeRatio: round(volumeRatio, 2),
    turnover: round(seed.turnover, 2),
    amount: formatAmount(seed.amount, seed.market),
    closePosition: round(clamp(closePosition, 0, 100), 1),
    firstLimit: seed.firstLimit,
    sealStrength: seed.sealStrength,
    reasons,
    risks,
    factorScores: [
      { label: "强度", value: Math.round(strengthScore) },
      { label: "趋势", value: Math.round(trendScore) },
      { label: "量价", value: Math.round(volumeScore) },
      { label: "动量", value: Math.round(momentumScore) },
    ],
    plan: {
      watch: risk >= 68 ? `等待回落至 ${formatPrice(watchLow)} – ${formatPrice(Math.max(watchLow, watchHigh))}` : `${formatPrice(watchLow)} – ${formatPrice(Math.max(watchLow, watchHigh))}`,
      breakout: formatPrice(breakout),
      stop: formatPrice(stop),
      targets: `${formatPrice(price + unitRisk * 1.5)} / ${formatPrice(price + unitRisk * 2.5)}`,
    },
  };
}

async function buildCNFeed(): Promise<ScreenerFeed> {
  const now = new Date();
  const dateKey = zonedDate(now, "Asia/Shanghai").replaceAll("-", "");
  const [quotes, limitPool, yesterdayPool, downPool, indexes] = await Promise.all([
    fetchCNUniverse(),
    fetchLimitPool("getTopicZTPool", dateKey).catch(() => emptyPool()),
    fetchLimitPool("getYesterdayZTPool", dateKey).catch(() => emptyPool()),
    fetchLimitPool("getTopicDTPool", dateKey).catch(() => emptyPool()),
    fetchGlobalIndexFeed().catch(() => null),
  ]);
  if (quotes.length < 100) throw new Error("A股全市场行情返回数量不足");

  const quoteByCode = new Map(quotes.map((quote) => [quote.code, quote]));
  const currentByCode = new Map(limitPool.items.map((item) => [item.code, item]));
  const yesterdayByCode = new Map(yesterdayPool.items.map((item) => [item.code, item]));
  const selectedCodes = unique([
    ...yesterdayPool.items.sort((left, right) => right.change - left.change).map((item) => item.code).slice(0, 9),
    ...limitPool.items.sort((left, right) => (right.streak - left.streak) || (right.sealFund - left.sealFund)).map((item) => item.code).slice(0, 9),
    ...quotes.filter(isCNQualityQuote).sort((left, right) => cnPreScore(right) - cnPreScore(left)).map((quote) => quote.code).slice(0, 16),
  ]).filter((code) => quoteByCode.has(code)).slice(0, 24);

  const analyzed = await mapLimited(selectedCodes, 6, async (code) => {
    const quote = quoteByCode.get(code)!;
    const currentLimit = currentByCode.get(code);
    const yesterdayLimit = yesterdayByCode.get(code);
    const seed = cnSeed(quote, currentLimit, yesterdayLimit);
    const rows = await fetchCNDailyRows(quote.symbol);
    return scoreScreenerOpportunity(seed, rows);
  });
  const opportunities = analyzed.flatMap((result) => result.ok ? [result.value] : []).sort((left, right) => right.score - left.score);
  opportunities.slice(0, 12).forEach((item) => item.strategies.unshift("今日精选"));
  const failedHistoryCount = analyzed.filter((result) => !result.ok).length;
  const tradeDate = limitPool.tradeDate || yesterdayPool.tradeDate || latestOpportunityDate(opportunities, now, "Asia/Shanghai");
  const themes = buildThemes([
    ...limitPool.items.map((item) => ({ name: item.sector, change: item.change })),
    ...yesterdayPool.items.map((item) => ({ name: item.sector, change: item.change })),
  ], opportunities);
  const snapshot = buildCNSnapshot(quotes, limitPool.total, downPool.total, indexes);

  return {
    market: "CN",
    tradeDate,
    fetchedAt: now.toISOString(),
    quoteStatus: cnQuoteStatus(now, tradeDate),
    source: "新浪财经沪深京行情与日K、东方财富涨跌停池、公开指数行情",
    sourceLinks: [
      { label: "新浪财经行情中心", url: "https://vip.stock.finance.sina.com.cn/mkt/" },
      { label: "东方财富涨停板", url: "https://quote.eastmoney.com/ztb/" },
    ],
    snapshot,
    brief: cnBrief(snapshot, opportunities),
    opportunities,
    themes,
    structure: buildCNStructure(limitPool, yesterdayPool),
    diagnostics: { universeCount: quotes.length, analyzedCount: opportunities.length, failedHistoryCount, delayed: true },
  };
}

async function buildUSFeed(): Promise<ScreenerFeed> {
  const now = new Date();
  const [marketList, indexes] = await Promise.all([
    fetchUSTopMovers(14),
    fetchGlobalIndexFeed().catch(() => null),
  ]);
  const qualityQuotes = marketList.quotes.filter(isUSQualityQuote);
  const selected = qualityQuotes.sort((left, right) => usPreScore(right) - usPreScore(left)).slice(0, 22);
  const analyzed = await mapLimited(selected, 6, async (quote) => {
    const rows = await fetchUSDailyRows(quote.symbol, 100);
    const latest = rows.at(-1);
    const effective = latest ? {
      ...quote,
      price: latest.close,
      change: percentChange(latest.close, rows.at(-2)?.close ?? quote.previousClose),
      previousClose: rows.at(-2)?.close ?? quote.previousClose,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      volume: latest.volume,
      amount: latest.amount || latest.close * latest.volume,
    } : quote;
    return scoreScreenerOpportunity(usSeed(effective), rows);
  });
  const opportunities = analyzed.flatMap((result) => result.ok ? [result.value] : []).sort((left, right) => right.score - left.score);
  opportunities.slice(0, 12).forEach((item) => item.strategies.unshift("今日精选"));
  const tradeDate = await inferUSLatestDate(selected[0]?.symbol).catch(() => zonedDate(now, "America/New_York"));
  const snapshot = buildUSSnapshot(marketList.quotes, qualityQuotes.length, opportunities, indexes);
  return {
    market: "US",
    tradeDate,
    fetchedAt: now.toISOString(),
    quoteStatus: usQuoteStatus(indexes),
    source: "新浪财经美股涨幅榜与日K、公开指数与 CBOE VIX 行情",
    sourceLinks: [
      { label: "新浪财经美股", url: "https://finance.sina.com.cn/stock/usstock/" },
      { label: "CBOE VIX", url: "https://www.cboe.com/tradable-products/vix" },
    ],
    snapshot,
    brief: usBrief(snapshot),
    opportunities,
    themes: buildThemes(marketList.quotes.map((quote) => ({ name: quote.category || quote.exchange, change: quote.change })), opportunities),
    structure: buildUSStructure(marketList.quotes.length, qualityQuotes, opportunities),
    diagnostics: {
      universeCount: marketList.count,
      analyzedCount: opportunities.length,
      failedHistoryCount: analyzed.filter((result) => !result.ok).length,
      delayed: true,
    },
  };
}

async function fetchCNUniverse(): Promise<CNQuote[]> {
  const countBody = await fetchText(`${cnCountEndpoint}?node=hs_a`, 32 * 1024);
  const count = Math.min(6_000, Math.max(100, Math.floor(finiteNumber(countBody.replaceAll('"', "")))));
  const pages = Array.from({ length: Math.ceil(count / 100) }, (_, index) => index + 1);
  const responses = await mapLimited(pages, 10, async (page) => {
    const url = new URL(cnListEndpoint);
    url.searchParams.set("page", String(page));
    url.searchParams.set("num", "100");
    url.searchParams.set("sort", "symbol");
    url.searchParams.set("asc", "1");
    url.searchParams.set("node", "hs_a");
    url.searchParams.set("symbol", "");
    url.searchParams.set("_s_r_a", "page");
    return parseCNListResponse(await fetchText(url.toString(), maxResponseBytes));
  });
  const quotes = responses.flatMap((result) => result.ok ? result.value : []);
  const uniqueQuotes = [...new Map(quotes.map((quote) => [quote.code, quote])).values()];
  if (uniqueQuotes.length < count * .8) throw new Error(`A股全市场行情仅返回 ${uniqueQuotes.length}/${count} 只`);
  return uniqueQuotes;
}

async function fetchUSTopMovers(pageCount: number): Promise<{ count: number; quotes: USQuote[] }> {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  const responses = await mapLimited(pages, 5, async (page) => {
    const url = new URL(usListEndpoint);
    url.searchParams.set("page", String(page));
    url.searchParams.set("num", "20");
    url.searchParams.set("sort", "chg");
    url.searchParams.set("asc", "0");
    url.searchParams.set("market", "");
    url.searchParams.set("id", "");
    return parseUSListResponse(await fetchText(url.toString(), 512 * 1024));
  });
  const successful = responses.flatMap((result) => result.ok ? [result.value] : []);
  if (!successful.length) throw new Error("美股行情列表暂不可用");
  return {
    count: Math.max(...successful.map((item) => item.count)),
    quotes: [...new Map(successful.flatMap((item) => item.quotes).map((quote) => [quote.symbol, quote])).values()],
  };
}

async function fetchCNDailyRows(symbol: string): Promise<DailyRow[]> {
  const url = new URL(cnDailyEndpoint);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("scale", "240");
  url.searchParams.set("ma", "no");
  url.searchParams.set("datalen", "90");
  const rows = parseCNDailyResponse(await fetchText(url.toString(), 512 * 1024));
  if (rows.length < 20) throw new Error(`${symbol} 日线数据不足`);
  return rows;
}

async function fetchLimitPool(method: string, dateKey: string): Promise<LimitPool> {
  const url = new URL(`${eastmoneyEndpoint}/${method}`);
  url.searchParams.set("cb", "trendsight");
  url.searchParams.set("ut", "7eea3edcaed734bea9cbfc24409ed989");
  url.searchParams.set("dpt", "wz.ztzt");
  url.searchParams.set("Pageindex", "0");
  url.searchParams.set("pagesize", "200");
  url.searchParams.set("sort", method === "getTopicZTPool" ? "fbt:asc" : "zdp:desc");
  url.searchParams.set("date", dateKey);
  url.searchParams.set("_", String(Date.now()));
  const body = await fetchText(url.toString(), maxResponseBytes);
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("涨跌停池无法解析");
  const payload = JSON.parse(body.slice(start, end + 1)) as { data?: Record<string, unknown> };
  const data = payload.data ?? {};
  const rawItems = Array.isArray(data.pool) ? data.pool : [];
  return {
    tradeDate: normalizeTradeDate(data.qdate),
    total: Math.max(0, Math.floor(finiteNumber(data.tc))),
    items: rawItems.flatMap((raw) => {
      const item = raw as Record<string, unknown>;
      const code = String(item.c ?? "").trim();
      if (!/^\d{6}$/.test(code)) return [];
      return [{
        code,
        name: String(item.n ?? code).trim(),
        price: finiteNumber(item.p) / 1_000,
        change: finiteNumber(item.zdp),
        amount: nonNegativeNumber(item.amount),
        floatMarketCap: nonNegativeNumber(item.ltsz),
        turnover: nonNegativeNumber(item.hs),
        streak: Math.max(0, Math.floor(finiteNumber(item.lbc ?? item.ylbc ?? (item.zttj as Record<string, unknown> | undefined)?.ct))),
        firstLimit: Math.max(0, Math.floor(finiteNumber(item.fbt ?? item.yfbt))),
        lastLimit: Math.max(0, Math.floor(finiteNumber(item.lbt))),
        sealFund: nonNegativeNumber(item.fund),
        burstCount: Math.max(0, Math.floor(finiteNumber(item.zbc))),
        sector: String(item.hybk ?? "沪深A股").trim() || "沪深A股",
        limitPrice: finiteNumber(item.ztp) / 1_000,
      }];
    }),
  };
}

function cnSeed(quote: CNQuote, current: LimitPoolItem | undefined, yesterday: LimitPoolItem | undefined): AnalysisSeed {
  const pool = current ?? yesterday;
  return {
    market: "CN",
    symbol: quote.code,
    name: quote.name,
    exchange: quote.symbol.startsWith("sh") ? "沪市" : quote.symbol.startsWith("bj") ? "北交所" : quote.code.startsWith("30") ? "创业板" : "深市",
    price: quote.price,
    change: quote.change,
    previousClose: quote.previousClose,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    volume: quote.volume,
    amount: quote.amount,
    marketCap: quote.marketCap,
    turnover: quote.turnover,
    sector: pool?.sector ?? "沪深A股",
    themes: pool?.sector ? [pool.sector] : ["沪深A股"],
    streak: current?.streak ?? yesterday?.streak ?? 0,
    firstLimit: pool?.firstLimit ? formatLimitTime(pool.firstLimit) : undefined,
    sealStrength: current ? sealStrength(current) : undefined,
    wasYesterdayLimit: Boolean(yesterday),
    isCurrentLimit: Boolean(current),
  };
}

function usSeed(quote: USQuote): AnalysisSeed {
  const shares = quote.price > 0 ? quote.marketCap / quote.price : 0;
  return {
    market: "US",
    symbol: quote.symbol,
    name: quote.name,
    exchange: quote.exchange,
    price: quote.price,
    change: quote.change,
    previousClose: quote.previousClose,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    volume: quote.volume,
    amount: quote.amount,
    marketCap: quote.marketCap,
    turnover: shares > 0 ? quote.volume / shares * 100 : 0,
    sector: quote.category || quote.exchange,
    themes: [quote.category || quote.exchange],
    streak: 0,
    wasYesterdayLimit: false,
    isCurrentLimit: false,
  };
}

function buildCNSnapshot(quotes: CNQuote[], limitUp: number, limitDown: number, indexes: GlobalIndexFeed | null): ScreenerSnapshot {
  const up = quotes.filter((quote) => quote.change > 0).length;
  const down = quotes.filter((quote) => quote.change < 0).length;
  const averageChange = average(quotes.map((quote) => quote.change));
  const moodScore = Math.round(clamp(50 + (up - down) / quotes.length * 40 + averageChange * 8, 4, 96));
  const shanghai = indexes?.quotes.find((quote) => quote.id === "shanghai");
  const chinext = indexes?.quotes.find((quote) => quote.id === "chinext");
  return {
    mood: moodFor(moodScore),
    moodScore,
    primary: indexLabel(shanghai?.name ?? "上证指数", shanghai?.changePct),
    secondary: indexLabel(chinext?.name ?? "创业板指", chinext?.changePct),
    breadthValue: `${formatInteger(up)} / ${formatInteger(down)}`,
    breadthCaption: "上涨 / 下跌",
    event: `涨停 ${formatInteger(limitUp)} · 跌停 ${formatInteger(limitDown)}`,
    liquidity: `全市场成交额 ${formatAmount(quotes.reduce((sum, quote) => sum + quote.amount, 0), "CN")}`,
    riskBudget: moodScore >= 76 ? "高" : moodScore >= 58 ? "中高" : moodScore >= 38 ? "中" : "低",
    riskNote: moodScore >= 58 ? "可参与 · 避免高位追涨" : "控制仓位 · 等待趋势确认",
  };
}

function buildUSSnapshot(scanned: USQuote[], qualityCount: number, opportunities: ScreenerOpportunity[], indexes: GlobalIndexFeed | null): ScreenerSnapshot {
  const sp500 = indexes?.usQuotes.find((quote) => quote.id === "sp500");
  const nasdaq = indexes?.usQuotes.find((quote) => quote.id === "nasdaq");
  const phaseChanges = [sp500?.phaseChangePct, nasdaq?.phaseChangePct].filter((value): value is number => value != null);
  const averageIndexChange = average(phaseChanges);
  const moodScore = Math.round(clamp(50 + averageIndexChange * 13 + opportunities.filter((item) => item.score >= 75).length * 1.2, 8, 94));
  const breakoutCount = opportunities.filter((item) => item.strategies.includes("突破新高")).length;
  return {
    mood: moodFor(moodScore),
    moodScore,
    primary: indexLabel("S&P 500", sp500?.phaseChangePct),
    secondary: indexLabel("NASDAQ", nasdaq?.phaseChangePct),
    breadthValue: `${scanned.length} / ${qualityCount}`,
    breadthCaption: "涨幅榜扫描 / 质量通过",
    event: `突破信号 ${breakoutCount}`,
    liquidity: `扫描样本成交额 ${formatAmount(scanned.reduce((sum, quote) => sum + quote.amount, 0), "US")}`,
    riskBudget: moodScore >= 72 ? "中高" : moodScore >= 45 ? "中" : "低",
    riskNote: moodScore >= 55 ? "顺势参与 · 小盘股降权" : "减少追涨 · 等待指数企稳",
  };
}

function buildCNStructure(current: LimitPool, yesterday: LimitPool): ScreenerStructure {
  const groups = new Map<number, string[]>();
  for (const item of current.items) {
    const streak = Math.max(1, item.streak);
    groups.set(streak, [...(groups.get(streak) ?? []), item.name]);
  }
  const rows = [...groups.entries()]
    .sort((left, right) => right[0] - left[0])
    .slice(0, 5)
    .map(([level, names]) => ({ level: level === 1 ? "首板" : `${level}板`, names: names.slice(0, 4) }));
  const promotions = yesterday.items.filter((item) => current.items.some((currentItem) => currentItem.code === item.code)).length;
  const bursts = current.items.reduce((sum, item) => sum + item.burstCount, 0);
  const highest = Math.max(0, ...current.items.map((item) => item.streak));
  return {
    title: "连板梯队",
    badge: highest ? `最高 ${highest}板` : "等待行情",
    rows,
    stats: [
      { label: "晋级率", value: yesterday.items.length ? `${Math.round(promotions / yesterday.items.length * 100)}%` : "—" },
      { label: "炸板次数", value: String(bursts) },
      { label: "首板", value: String(current.items.filter((item) => item.streak <= 1).length) },
    ],
    note: "梯队、首次封板、炸板次数与晋级率均来自当前涨停池及昨日涨停池，盘中会随行情变化。",
  };
}

function buildUSStructure(scannedCount: number, qualityQuotes: USQuote[], opportunities: ScreenerOpportunity[]): ScreenerStructure {
  return {
    title: "默认质量过滤",
    badge: "已开启",
    rows: [
      { level: "市值", names: ["> $500M"] },
      { level: "股价", names: ["> $5"] },
      { level: "成交", names: ["> $10M"] },
      { level: "证券", names: ["剔除权证与异常代码"] },
    ],
    stats: [
      { label: "扫描", value: String(scannedCount) },
      { label: "通过", value: String(qualityQuotes.length) },
      { label: "突破", value: String(opportunities.filter((item) => item.strategies.includes("突破新高")).length) },
    ],
    note: "先对新浪美股涨幅榜执行流动性和市值过滤，再以日K计算趋势与动量，避免低流动性高涨幅样本进入推荐池。",
  };
}

function buildThemes(raw: Array<{ name: string; change: number }>, opportunities: ScreenerOpportunity[]): ScreenerTheme[] {
  const groups = new Map<string, { total: number; count: number }>();
  for (const item of raw) {
    const name = item.name.trim();
    if (!name) continue;
    const existing = groups.get(name) ?? { total: 0, count: 0 };
    existing.total += item.change;
    existing.count += 1;
    groups.set(name, existing);
  }
  for (const item of opportunities) {
    if (groups.has(item.sector)) continue;
    groups.set(item.sector, { total: item.change, count: 1 });
  }
  return [...groups.entries()]
    .map(([name, value]) => ({
      name,
      change: round(value.total / value.count, 2),
      count: value.count,
      heat: Math.round(clamp(2.5 + value.total / value.count / 2 + Math.log2(value.count + 1) / 2, 1, 5)),
    }))
    .sort((left, right) => (right.heat - left.heat) || (right.count - left.count))
    .slice(0, 5);
}

function cnBrief(snapshot: ScreenerSnapshot, opportunities: ScreenerOpportunity[]): ScreenerFeed["brief"] {
  const breakout = opportunities.filter((item) => item.strategies.includes("趋势突破")).length;
  const volume = opportunities.filter((item) => item.strategies.includes("放量上涨")).length;
  return {
    priority: breakout >= volume ? "趋势突破  >  放量上涨  >  高位连板" : "放量上涨  >  趋势突破  >  高位连板",
    summary: `当前市场情绪为${snapshot.mood}。候选池中有 ${breakout} 只趋势突破、${volume} 只放量上涨；模型优先保留收盘位置强、趋势与量能同时确认的标的。`,
    positiveTag: "优先 · 趋势确认",
    warningTag: "回避 · 长上影与高换手",
  };
}

function usBrief(snapshot: ScreenerSnapshot): ScreenerFeed["brief"] {
  return {
    priority: "Momentum  >  新高突破  >  高波动 Gap",
    summary: `指数与涨幅榜样本共同指向${snapshot.mood}环境。质量过滤先于动量排序，小市值、低价格与低成交额证券不会进入候选池。`,
    positiveTag: "优先 · 流动性与趋势",
    warningTag: "回避 · 低流动性跳空",
  };
}

function cnStrategies(seed: AnalysisSeed, state: { breakout20: boolean; volumeRatio: number }): string[] {
  const values: string[] = [];
  if (seed.wasYesterdayLimit) values.push("昨日涨停");
  if (seed.streak >= 2) values.push("连板股");
  if (state.breakout20) values.push("趋势突破");
  if (state.volumeRatio >= 1.3 && seed.change > 0) values.push("放量上涨");
  return values;
}

function usStrategies(seed: AnalysisSeed, state: { breakout60: boolean; volumeRatio: number; gap: number; return20: number; ma20: number }): string[] {
  const values: string[] = [];
  if (seed.change >= 3) values.push("强势股");
  if (state.gap >= 3) values.push("Gap Up");
  if (state.breakout60) values.push("突破新高");
  if (state.volumeRatio >= 1.3 && seed.change > 0) values.push("放量上涨");
  if (state.return20 > 4 && seed.price > state.ma20) values.push("Momentum");
  return values;
}

function signalFor(seed: AnalysisSeed, state: { breakout20: boolean; breakout60: boolean; volumeRatio: number; gap: number; return20: number }): string {
  if (seed.isCurrentLimit) return seed.streak >= 2 ? `${seed.streak}连板` : "涨停";
  if (seed.wasYesterdayLimit) return seed.streak >= 2 ? `昨日${seed.streak}板` : "昨日涨停";
  if (state.breakout60) return seed.market === "US" ? "阶段新高" : "60日新高";
  if (state.breakout20) return "20日新高";
  if (state.gap >= 3) return "Gap Up";
  if (state.volumeRatio >= 1.5) return "放量上涨";
  if (state.return20 > 5) return "Momentum";
  return "趋势转强";
}

function buildReasons(seed: AnalysisSeed, state: { ma5: number; ma10: number; ma20: number; closePosition: number; volumeRatio: number; return5: number; return20: number; breakout20: boolean; breakout60: boolean; gap: number }): string[] {
  const values: string[] = [];
  if (seed.isCurrentLimit) values.push(`${seed.streak >= 2 ? `${seed.streak}连板` : "当日涨停"}${seed.firstLimit ? `，首次封板 ${seed.firstLimit}` : ""}`);
  else if (seed.wasYesterdayLimit) values.push(`上个交易日涨停，当前交易日涨幅 ${signed(seed.change)}%`);
  if (state.closePosition >= 80) values.push(`价格位于日内区间上方 ${state.closePosition.toFixed(0)}%，收盘承接较强`);
  if (state.volumeRatio >= 1.2) values.push(`成交量为前 5 日均量的 ${state.volumeRatio.toFixed(2)} 倍`);
  if (seed.price > state.ma5 && state.ma5 > state.ma10 && state.ma10 > state.ma20) values.push("MA5、MA10、MA20 呈多头排列");
  else if (seed.price > state.ma20) values.push("价格运行于 MA20 上方");
  if (state.breakout60) values.push("价格触及近 60 个交易日高位");
  else if (state.breakout20) values.push("价格突破近 20 个交易日高位");
  if (state.gap >= 3) values.push(`相对前收跳空 ${state.gap.toFixed(1)}%`);
  if (state.return5 > 3) values.push(`近 5 日累计涨幅 ${state.return5.toFixed(1)}%`);
  if (values.length < 3) values.push(`近 20 日动量 ${signed(state.return20)}%`);
  return values.slice(0, 5);
}

function buildRisks(seed: AnalysisSeed, state: { ma5Distance: number; return5: number; atrPct: number; volumeRatio: number; gap: number; closePosition: number }): string[] {
  const values: string[] = [];
  if (state.ma5Distance > 7) values.push(`价格高于 MA5 ${state.ma5Distance.toFixed(1)}%，短线乖离偏大`);
  if (state.return5 > 15) values.push(`近 5 日累计上涨 ${state.return5.toFixed(1)}%，存在获利兑现压力`);
  if (seed.turnover > 12) values.push(`换手率 ${seed.turnover.toFixed(1)}%，筹码分歧较大`);
  if (state.atrPct > 5) values.push(`近 14 日真实波幅约 ${state.atrPct.toFixed(1)}%，价格波动偏高`);
  if (state.volumeRatio > 3.5) values.push("成交量显著偏离常态，需防范放量滞涨");
  if (state.gap > 7) values.push(`跳空幅度 ${state.gap.toFixed(1)}%，存在回补缺口风险`);
  if (state.closePosition < 55) values.push("价格未能守在日内区间上半部，上方抛压仍需确认");
  if (!values.length) values.push("公开行情可能延迟，盘中信号需结合最新报价复核");
  return values.slice(0, 4);
}

function isCNQualityQuote(quote: CNQuote): boolean {
  return quote.price > 2 && quote.amount >= 50_000_000 && quote.change > 0 && !/(?:^|\*)ST|退$|^N/.test(quote.name);
}

function isUSQualityQuote(quote: USQuote): boolean {
  const suspicious = /(?:WARRANT|RIGHT|UNIT|权证)/i.test(quote.name) || /W$|WS$|WT$|R$|U$/.test(quote.symbol);
  return quote.price >= 5 && quote.marketCap >= 500_000_000 && quote.amount >= 10_000_000 && quote.change > 0 && !suspicious;
}

function cnPreScore(quote: CNQuote): number {
  return quote.change * 3 + Math.min(quote.turnover, 25) * .45 + Math.log10(Math.max(quote.amount, 1)) * 2;
}

function usPreScore(quote: USQuote): number {
  return quote.change * 2 + Math.log10(Math.max(quote.amount, 1)) * 2 + Math.log10(Math.max(quote.marketCap, 1));
}

function recommendationFor(score: number, risk: number): ScreenerRecommendation {
  if (score >= 86 && risk < 58) return "强烈关注";
  if (score >= 76 && risk < 68) return "值得关注";
  if (score >= 65 && risk < 78) return "观察";
  return "谨慎";
}

function sealStrength(item: LimitPoolItem): number {
  const clock = item.firstLimit ? Math.floor(item.firstLimit / 10_000) * 60 + Math.floor(item.firstLimit / 100) % 100 : 15 * 60;
  const earlyBonus = clamp((11 * 60 - clock) / 4, -8, 22);
  const fundRatio = item.floatMarketCap > 0 ? item.sealFund / item.floatMarketCap * 100 : 0;
  return Math.round(clamp(52 + earlyBonus + Math.min(fundRatio * 5, 24) - item.burstCount * 7 + Math.min(item.streak, 3) * 2, 20, 98));
}

function moodFor(score: number): ScreenerSnapshot["mood"] {
  if (score >= 82) return "极强";
  if (score >= 62) return "偏强";
  if (score >= 42) return "中性";
  if (score >= 22) return "偏弱";
  return "极弱";
}

function cnQuoteStatus(now: Date, tradeDate: string): string {
  const today = zonedDate(now, "Asia/Shanghai");
  const clock = zonedTime(now, "Asia/Shanghai");
  if (tradeDate === today && ((clock >= "09:30" && clock <= "11:30") || (clock >= "13:00" && clock <= "15:00"))) return "盘中公开行情";
  return tradeDate === today ? "当日收盘行情" : "最近交易日行情";
}

function usQuoteStatus(indexes: GlobalIndexFeed | null): string {
  const phase = indexes?.usQuotes.find((quote) => quote.id === "sp500")?.phase;
  return phase ? `${phase}公开行情` : "最近交易日行情";
}

function indexLabel(name: string, change: number | null | undefined): string {
  return `${name} ${change == null ? "—" : `${signed(change)}%`}`;
}

function formatAmount(value: number, market: ScreenerMarket): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (market === "CN") return value >= 1_000_000_000_000 ? `${round(value / 1_000_000_000_000, 2)}万亿` : `${round(value / 100_000_000, 2)}亿`;
  return value >= 1_000_000_000 ? `$${round(value / 1_000_000_000, 2)}B` : `$${round(value / 1_000_000, 1)}M`;
}

function formatLimitTime(value: number): string {
  const raw = String(value).padStart(6, "0");
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
}

function normalizeTradeDate(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";
}

function normalizeUSExchange(value: unknown): string {
  const market = String(value ?? "").toUpperCase();
  if (market.includes("NYSE") || market === "N") return "NYSE";
  if (market.includes("AMEX") || market === "A") return "AMEX";
  return "NASDAQ";
}

function emptyPool(): LimitPool { return { tradeDate: "", total: 0, items: [] }; }

async function inferUSLatestDate(symbol: string | undefined): Promise<string> {
  if (!symbol) throw new Error("没有美股候选代码");
  const rows = await fetchUSDailyRows(symbol, 20);
  return rows.at(-1)?.date ?? "";
}

function latestOpportunityDate(_items: ScreenerOpportunity[], now: Date, timezone: string): string {
  return zonedDate(now, timezone);
}

function averageTrueRange(rows: DailyRow[]): number {
  if (rows.length < 2) return 0;
  const ranges = rows.slice(1).map((row, index) => Math.max(row.high - row.low, Math.abs(row.high - rows[index].close), Math.abs(row.low - rows[index].close)));
  return average(ranges.slice(-14));
}

async function fetchText(url: string, maxBytes: number): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "*/*",
      Referer: url.includes("eastmoney") ? "https://quote.eastmoney.com/ztb/" : "https://finance.sina.com.cn/",
      "User-Agent": "Mozilla/5.0 (compatible; TrendSight/2.0)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`上游行情请求失败：HTTP ${response.status}`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) throw new Error("上游行情响应超过安全上限");
  return body;
}

async function mapLimited<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<Array<{ ok: true; value: R } | { ok: false; reason: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; reason: unknown }> = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { ok: false, reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function zonedDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function zonedTime(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

function signed(value: number): string { return `${value >= 0 ? "+" : ""}${round(value, 2)}`; }
function formatInteger(value: number): string { return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value); }
function percentChange(value: number, anchor: number): number { return anchor > 0 ? (value / anchor - 1) * 100 : 0; }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function round(value: number, digits: number): number { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
function finiteNumber(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function positiveNumber(value: unknown): number { const parsed = finiteNumber(value); return parsed > 0 ? parsed : 0; }
function nonNegativeNumber(value: unknown): number { const parsed = finiteNumber(value); return parsed >= 0 ? parsed : 0; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
