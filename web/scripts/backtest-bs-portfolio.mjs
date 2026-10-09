import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { calculateIndicators, LEGACY_SIGNAL_GUIDE_POLICY } from "../app/lib/market.ts";
import { collectGuideSignals, estimateLiquidityRoundTripCostPct, isGuideEntryTradable, resolveGuideExit } from "../app/lib/research.ts";
import { parseCNListResponse } from "../app/lib/screenerData.ts";

const args = parseArgs(process.argv.slice(2));
const config = {
  sampleSize: integerArg(args, "sample-size", 1_000),
  bars: integerArg(args, "bars", 1_250),
  initialCapital: numberArg(args, "capital", 400_000),
  holdingPeriods: integerArg(args, "holding-periods", 10),
  maxPositions: integerArg(args, "max-positions", 5),
  baseRoundTripCostPct: numberArg(args, "base-cost", 0.25),
  minimumDailyAmount: numberArg(args, "minimum-daily-amount", 50_000_000),
  cacheDir: String(args["cache-dir"] ?? join(tmpdir(), "trendsight-bs-portfolio-cache-v1")),
  output: args.output ? String(args.output) : "",
  exitRule: String(args["exit-rule"] ?? "fixed"),
};
if (!["fixed", "sell-signal"].includes(config.exitRule)) throw new Error("--exit-rule 必须为 fixed 或 sell-signal");

const runAt = new Date().toISOString();
const closedBeforeDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(runAt));
async function main() {
  await mkdir(config.cacheDir, { recursive: true });

  const universe = await fetchUniverse();
  const eligible = universe
    .filter((quote) => /^(?:sh|sz)/.test(quote.symbol) && quote.price > 0 && quote.volume > 0 && !/(?:\*?ST|退)/i.test(quote.name))
    .sort((left, right) => hashKey(left.code).localeCompare(hashKey(right.code)));
  progress("universe", { received: universe.length, eligible: eligible.length });

  const benchmark = await loadSecurity({ code: "000300", symbol: "sh000300", name: "沪深300" });
  const securities = [];
  const failures = [];
  let cursor = 0;
  while (securities.length < config.sampleSize && cursor < eligible.length) {
    const batch = eligible.slice(cursor, cursor + 120);
    cursor += batch.length;
    const loaded = await mapLimit(batch, 6, loadSecurity);
    for (let index = 0; index < loaded.length && securities.length < config.sampleSize; index += 1) {
      if (loaded[index].ok) securities.push(loaded[index].value);
      else failures.push({ code: batch[index].code, error: loaded[index].error });
    }
    progress("history", { attempted: cursor, successes: securities.length, failures: failures.length });
  }
  if (securities.length < config.sampleSize) throw new Error(`只有 ${securities.length} 只股票满足历史数据要求`);

  const endDate = benchmark.candles.at(-1)?.date ?? "";
  const startDate = oneYearBefore(endDate);
  const tradingDates = benchmark.candles.map((candle) => candle.date).filter((date) => date >= startDate && date <= endDate);
  const legacyEvents = [];
  const optimizedEvents = [];
  for (const security of securities) {
    security.candles = security.candles.filter((candle) => candle.date <= endDate);
    const legacyIndicators = calculateIndicators(security.candles, LEGACY_SIGNAL_GUIDE_POLICY);
    const optimizedIndicators = calculateIndicators(security.candles, { version: "stable" });
    legacyEvents.push(...buildEvents(security, legacyIndicators, "legacy"));
    optimizedEvents.push(...buildEvents(security, optimizedIndicators, "optimized"));
  }

  const optimizedBuyOutcomes = optimizedEvents.filter((event) => event.direction === "buy");
  const policyByDate = buildRollingPolicy(tradingDates, optimizedBuyOutcomes, benchmark.candles.map((candle) => candle.date));
  const legacyPortfolio = simulatePortfolio(
    legacyEvents.filter((event) => event.direction === "buy" && event.entryDate >= startDate && event.entryDate <= endDate),
    tradingDates,
    buildRollingPolicy(tradingDates, legacyEvents.filter((event) => event.direction === "buy"), benchmark.candles.map((candle) => candle.date)),
    "legacy",
    "score-first",
  );
  const optimizedPortfolio = simulatePortfolio(
    optimizedEvents.filter((event) => event.direction === "buy" && event.entryDate >= startDate && event.entryDate <= endDate),
    tradingDates,
    policyByDate,
    "optimized",
    "score-first",
  );
  const optimizedRankingDiagnostics = Object.fromEntries(["adaptive", "confirmed-first", "standard-first", "score-first", "liquidity-first"].map((ranking) => [ranking, simulatePortfolio(
    optimizedEvents.filter((event) => event.direction === "buy" && event.entryDate >= startDate && event.entryDate <= endDate),
    tradingDates,
    policyByDate,
    "optimized",
    ranking,
  )]));

  const result = {
    runAt,
    period: { startDate, endDate, tradingDays: tradingDates.length },
    sample: {
      size: securities.length,
      attempted: cursor,
      failures: failures.length,
      boards: countBy(securities, (security) => boardName(security.quote.symbol)),
      medianBars: median(securities.map((security) => security.candles.length)),
      survivorshipWarning: "样本来自当前存续且活跃的非ST股票，不包含历史退市证券，仍存在幸存者偏差。",
    },
    policy: {
      legacy: "优化前v1：基础分加量能>=3、九转3分、共用冷却；使用与v2相同的修正后执行引擎",
    optimized: "标准版：保留原评分权重与RSI/BOLL质量锚，B/S独立冷却；回测修正入场前成交额、T+1、涨跌停和受阻退出",
      portfolio: `两版均本金${config.initialCapital}元、最多${config.maxPositions}只、信号日成交额>=${config.minimumDailyAmount}、相同成本/排序/滚动63与252日门槛；次日开盘进入；退出模式${config.exitRule}、观察${config.holdingPeriods}期，受阻顺延；未平仓按市值保留`,
      validation: "同一当前存续样本的历史对照，非独立样本外验证；排名诊断不得作为已验证最优参数。当天未完成日K排除。",
    },
    eventStudy: {
      fullHistory: compareEventStudy(legacyEvents, optimizedEvents),
      oneYear: compareEventStudy(
        legacyEvents.filter((event) => event.entryDate >= startDate && event.entryDate <= endDate),
        optimizedEvents.filter((event) => event.entryDate >= startDate && event.entryDate <= endDate),
      ),
    },
    portfolio: {
      legacy: legacyPortfolio,
      optimized: optimizedPortfolio,
      rankingDiagnostics: optimizedRankingDiagnostics,
      improvement: {
        endingCapital: round(optimizedPortfolio.endingCapital - legacyPortfolio.endingCapital, 2),
        profit: round(optimizedPortfolio.profit - legacyPortfolio.profit, 2),
        returnPct: round(optimizedPortfolio.returnPct - legacyPortfolio.returnPct, 4),
        maxDrawdownPct: round(optimizedPortfolio.maxDrawdownPct - legacyPortfolio.maxDrawdownPct, 4),
      },
      benchmark: benchmarkReturn(benchmark.candles, startDate, endDate),
    },
    rollingGateDays: countBy([...policyByDate.values()], (policy) => policy.status),
    rollingPreferredTierDays: countBy([...policyByDate.values()], (policy) => policy.preferredTier),
    failureExamples: failures.slice(0, 12),
  };

  if (config.output) {
    await writeFile(config.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  console.log(`FINAL_RESULT ${JSON.stringify(result)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

export function buildEvents(security, indicators, mode) {
  const signals = deduplicateSignals(indicators.guidePoints);
  return signals.flatMap((signal) => {
    const signalCandle = security.candles[signal.index];
    const entry = security.candles[signal.index + 1];
    const options = { market: "CN", code: security.quote.code, name: security.quote.name, exitRule: config.exitRule };
    if (!signalCandle || !entry || !isGuideEntryTradable(security.candles, signal.index + 1, signal.guide.type, options)) return [];
    const exit = resolveGuideExit(security.candles, signal.index, config.holdingPeriods, signal.guide.type, options, indicators.guidePoints);
    const target = exit ? security.candles[exit.index] : null;
    const direction = signal.guide.type === "buy" ? 1 : -1;
    const grossReturn = exit ? (exit.price / entry.open - 1) * 100 * direction : null;
    const positionValue = config.initialCapital / config.maxPositions;
    const costPct = estimateLiquidityRoundTripCostPct(signalCandle, positionValue, config.baseRoundTripCostPct);
    return [{
      code: security.quote.code,
      name: security.quote.name,
      board: boardName(security.quote.symbol),
      mode,
      direction: signal.guide.type,
      score: signal.guide.score,
      confirmed: signal.guide.confidence === "confirmed" || signal.guide.reasons.includes("量能确认"),
      signalDate: signalCandle.date,
      entryDate: entry.date,
      targetDate: target?.date ?? null,
      exitExecution: exit?.execution ?? null,
      delayedExit: exit?.delayed ?? false,
      entryOpen: entry.open,
      targetClose: exit?.price ?? null,
      dailyAmount: Math.max(signalCandle.rawAmount ?? 0, signalCandle.amount, signalCandle.adjustedAmount),
      grossReturn,
      costPct,
      netReturn: grossReturn == null ? null : grossReturn - costPct,
      candlesByDate: security.candlesByDate,
    }];
  });
}

function deduplicateSignals(guidePoints) {
  return collectGuideSignals(guidePoints);
}

function buildRollingPolicy(tradingDates, outcomes, allTradingDates) {
  const indexByDate = new Map(allTradingDates.map((date, index) => [date, index]));
  return new Map(tradingDates.map((date) => {
    const dateIndex = indexByDate.get(date) ?? 0;
    const slowStart = allTradingDates[Math.max(0, dateIndex - 252)] ?? "";
    const fastStart = allTradingDates[Math.max(0, dateIndex - 63)] ?? "";
    const available = outcomes.filter((event) => event.targetDate != null && event.targetDate < date && event.signalDate >= slowStart && event.dailyAmount >= config.minimumDailyAmount);
    const recent = available.filter((event) => event.signalDate >= fastStart);
    const stats = eventSummary(available);
    const recentStats = eventSummary(recent);
    const slowHealthy = (stats.mean ?? 0) > 0 && (stats.profitFactor ?? 0) >= 1.1;
    const fastHealthy = (recentStats.mean ?? 0) > 0 && (recentStats.profitFactor ?? 0) >= 1;
    const status = stats.n < 500 || recentStats.n < 100
      ? "insufficient"
      : slowHealthy && fastHealthy
        ? "active"
        : slowHealthy || fastHealthy
          ? "watch"
          : "weak";
    const confirmed = eventSummary(recent.filter((event) => event.confirmed));
    const standard = eventSummary(recent.filter((event) => !event.confirmed));
    const preferredTier = standard.n >= 30 && confirmed.n >= 100
      && (standard.mean ?? Number.NEGATIVE_INFINITY) > (confirmed.mean ?? Number.NEGATIVE_INFINITY)
      && (standard.profitFactor ?? 0) > (confirmed.profitFactor ?? 0)
      ? "standard"
      : "confirmed";
    return [date, { status, preferredTier }];
  }));
}

export function simulatePortfolio(events, tradingDates, policyByDate, mode, ranking = "score-first") {
  const entriesByDate = new Map();
  for (const event of events) {
    const rows = entriesByDate.get(event.entryDate) ?? [];
    rows.push(event);
    entriesByDate.set(event.entryDate, rows);
  }
  let cash = config.initialCapital;
  let lastEquity = config.initialCapital;
  let peak = config.initialCapital;
  let maxDrawdown = 0;
  let exposureSum = 0;
  const positions = new Map();
  const trades = [];
  const closePositions = (date, execution) => {
    for (const [code, position] of [...positions]) {
      if (position.targetDate !== date || position.exitExecution !== execution) continue;
      const exitValue = position.notional * position.targetClose / position.entryOpen;
      const exitCost = exitValue * position.costPct / 200;
      const pnl = exitValue - exitCost - position.notional - position.entryCost;
      cash += exitValue - exitCost;
      trades.push({ pnl, returnPct: pnl / (position.notional + position.entryCost) * 100, confirmed: position.confirmed });
      positions.delete(code);
    }
  };

  for (const date of tradingDates) {
    closePositions(date, "open");
    const policy = policyByDate.get(date) ?? { status: "insufficient", preferredTier: "confirmed" };
    const gate = typeof policy === "string" ? policy : policy.status;
    let effectiveRanking = ranking === "adaptive"
      ? policy.preferredTier === "standard" ? "standard-first" : "confirmed-first"
      : ranking;
    const allowedPositions = gate === "active" ? config.maxPositions : gate === "watch" || gate === "insufficient" ? Math.min(2, config.maxPositions) : 0;
    const candidates = (entriesByDate.get(date) ?? [])
      .filter((event) => !positions.has(event.code))
      .filter((event) => event.dailyAmount >= config.minimumDailyAmount);
    if (ranking.startsWith("anti-crowding-")) {
      const threshold = Number(ranking.slice("anti-crowding-".length));
      effectiveRanking = candidates.length >= threshold ? "standard-first" : "confirmed-first";
    }
    candidates.sort((left, right) => rankCandidates(left, right, effectiveRanking));

    for (const candidate of candidates) {
      if (positions.size >= allowedPositions || positions.size >= config.maxPositions) break;
      const targetValue = Math.min(lastEquity / config.maxPositions, cash / (1 + candidate.costPct / 200));
      if (targetValue < 10_000) break;
      const entryCost = targetValue * candidate.costPct / 200;
      cash -= targetValue + entryCost;
      positions.set(candidate.code, { ...candidate, notional: targetValue, entryCost, lastValue: targetValue });
    }

    for (const position of positions.values()) {
      const candle = position.candlesByDate.get(date);
      if (candle) position.lastValue = position.notional * candle.close / position.entryOpen;
    }

    closePositions(date, "close");

    const positionValue = [...positions.values()].reduce((sum, position) => sum + position.lastValue, 0);
    const equity = cash + positionValue;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, peak > 0 ? (equity / peak - 1) * 100 : 0);
    exposureSum += equity > 0 ? positionValue / equity : 0;
    lastEquity = equity;
  }

  const tradeReturns = trades.map((trade) => trade.returnPct);
  const positive = trades.filter((trade) => trade.pnl > 0);
  const negative = trades.filter((trade) => trade.pnl < 0);
  const endingCapital = lastEquity;
  return {
    mode,
    initialCapital: config.initialCapital,
    endingCapital: round(endingCapital, 2),
    profit: round(endingCapital - config.initialCapital, 2),
    returnPct: round((endingCapital / config.initialCapital - 1) * 100, 4),
    maxDrawdownPct: round(maxDrawdown, 4),
    trades: trades.length,
    winRate: round(trades.length ? positive.length / trades.length * 100 : null, 4),
    averageTradeReturn: round(mean(tradeReturns), 4),
    profitFactor: round(positive.length && negative.length ? sum(positive.map((trade) => trade.pnl)) / Math.abs(sum(negative.map((trade) => trade.pnl))) : null, 4),
    averageExposurePct: round(tradingDates.length ? exposureSum / tradingDates.length * 100 : 0, 4),
    confirmedTrades: trades.filter((trade) => trade.confirmed).length,
    openPositions: positions.size,
    unrealizedPnl: round([...positions.values()].reduce((total, position) => total + position.lastValue - position.notional - position.entryCost, 0), 2),
  };
}

function rankCandidates(left, right, ranking) {
  if (ranking === "legacy") return right.score - left.score || left.code.localeCompare(right.code);
  if (ranking === "confirmed-first") return Number(right.confirmed) - Number(left.confirmed) || right.score - left.score || right.dailyAmount - left.dailyAmount || left.code.localeCompare(right.code);
  if (ranking === "standard-first") return Number(left.confirmed) - Number(right.confirmed) || right.score - left.score || right.dailyAmount - left.dailyAmount || left.code.localeCompare(right.code);
  if (ranking === "liquidity-first") return right.dailyAmount - left.dailyAmount || right.score - left.score || left.code.localeCompare(right.code);
  return right.score - left.score || right.dailyAmount - left.dailyAmount || left.code.localeCompare(right.code);
}

function compareEventStudy(legacyEvents, optimizedEvents) {
  return {
    legacy: {
      buy: eventSummary(legacyEvents.filter((event) => event.direction === "buy")),
      sell: eventSummary(legacyEvents.filter((event) => event.direction === "sell")),
    },
    optimized: {
      buy: eventSummary(optimizedEvents.filter((event) => event.direction === "buy")),
      confirmedBuy: eventSummary(optimizedEvents.filter((event) => event.direction === "buy" && event.confirmed)),
      standardBuy: eventSummary(optimizedEvents.filter((event) => event.direction === "buy" && !event.confirmed)),
      sellRiskOnly: eventSummary(optimizedEvents.filter((event) => event.direction === "sell")),
    },
  };
}

function eventSummary(events) {
  const completed = events.filter((event) => event.netReturn != null);
  const returns = completed.map((event) => event.netReturn);
  const positive = returns.filter((value) => value > 0);
  const negative = returns.filter((value) => value < 0);
  return {
    n: returns.length,
    pending: events.length - completed.length,
    delayedExits: completed.filter((event) => event.delayedExit).length,
    stocks: new Set(completed.map((event) => event.code)).size,
    winRate: round(returns.length ? positive.length / returns.length * 100 : null, 4),
    mean: round(mean(returns), 4),
    median: round(median(returns), 4),
    profitFactor: round(positive.length && negative.length ? sum(positive) / Math.abs(sum(negative)) : null, 4),
    averageCostPct: round(mean(completed.map((event) => event.costPct)), 4),
  };
}

async function fetchUniverse() {
  const countBody = await fetchCached("universe-count", "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=hs_a", 32_768, 30 * 60_000);
  const count = Math.min(6_000, Math.max(100, Math.floor(Number(countBody.replaceAll('"', "")))));
  const pages = Array.from({ length: Math.ceil(count / 100) }, (_, index) => index + 1);
  const responses = await mapLimit(pages, 4, async (page) => {
    const url = new URL("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData");
    url.searchParams.set("page", String(page));
    url.searchParams.set("num", "100");
    url.searchParams.set("sort", "symbol");
    url.searchParams.set("asc", "1");
    url.searchParams.set("node", "hs_a");
    url.searchParams.set("symbol", "");
    url.searchParams.set("_s_r_a", "page");
    return parseCNListResponse(await fetchCached(`universe-${page}`, url, 2 * 1024 * 1024, 30 * 60_000));
  });
  return [...new Map(responses.flatMap((response) => response.ok ? response.value : []).map((quote) => [quote.code, quote])).values()];
}

async function loadSecurity(quote) {
  const klineUrl = new URL("https://quotes.sina.cn/cn/api/jsonp_v2.php/trendsight=/CN_MarketDataService.getKLineData");
  klineUrl.searchParams.set("symbol", quote.symbol);
  klineUrl.searchParams.set("scale", "240");
  klineUrl.searchParams.set("ma", "no");
  klineUrl.searchParams.set("datalen", String(config.bars));
  const factorUrl = `https://finance.sina.com.cn/realstock/company/${quote.symbol}/qfq.js?d=${runAt.slice(0, 10)}`;
  const [klineBody, factorBody] = await Promise.all([
    fetchCached(`kline-${quote.symbol}-${config.bars}`, klineUrl, 5 * 1024 * 1024, 6 * 60 * 60_000),
    fetchCached(`factor-${quote.symbol}-${runAt.slice(0, 10)}`, factorUrl, 256 * 1024, 6 * 60 * 60_000),
  ]);
  const rows = parseKlines(klineBody).filter((row) => row.date < closedBeforeDate);
  if (rows.length < 500) throw new Error(`只有 ${rows.length} 根日K`);
  const factors = parseFactors(factorBody);
  const candles = rows.map((row, index) => {
    const factor = factorForDate(factors, row.date);
    const open = row.open / factor;
    const high = row.high / factor;
    const low = row.low / factor;
    const close = row.close / factor;
    const previous = index ? rows[index - 1].close / factorForDate(factors, rows[index - 1].date) : open;
    return {
      key: row.date,
      label: row.date.slice(5),
      date: row.date,
      time: "",
      open,
      high,
      low,
      close,
      volume: row.volume,
      amount: row.close * row.volume,
      adjustedAmount: close * row.volume,
      rawAmount: row.close * row.volume,
      vwap: (open + high + low + close) / 4,
      turnoverPct: null,
      change: close - previous,
      changePct: previous > 0 ? (close / previous - 1) * 100 : 0,
    };
  });
  return { quote, candles, candlesByDate: new Map(candles.map((candle) => [candle.date, candle])) };
}

async function fetchCached(key, url, maxBytes, ttlMs) {
  const path = join(config.cacheDir, `${key.replace(/[^a-z0-9_.-]/gi, "_")}.txt`);
  try {
    const cached = JSON.parse(await readFile(`${path}.meta`, "utf8"));
    if (Date.now() - cached.savedAt <= ttlMs) return await readFile(path, "utf8");
  } catch { /* cache miss */ }
  const body = await fetchText(url, maxBytes);
  await Promise.all([
    writeFile(path, body, "utf8"),
    writeFile(`${path}.meta`, JSON.stringify({ savedAt: Date.now() }), "utf8"),
  ]);
  return body;
}

async function fetchText(url, maxBytes) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json,text/javascript,*/*;q=0.8", Referer: "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0 (compatible; TrendSight-BS-Research/1.0)" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > maxBytes) throw new Error("响应超过安全上限");
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await delay(350 * (2 ** attempt));
    }
  }
  throw lastError;
}

function parseKlines(body) {
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("日K响应无法解析");
  const rows = JSON.parse(body.slice(start, end + 1));
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const date = String(row.day ?? "").slice(0, 10);
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const volume = Number(row.volume);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || ![open, high, low, close, volume].every(Number.isFinite) || Math.min(open, high, low, close) <= 0) return [];
    return [{ date, open, high, low, close, volume: Math.max(0, volume) }];
  });
}

function parseFactors(body) {
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  const payload = JSON.parse(body.slice(start, end + 1));
  return (Array.isArray(payload.data) ? payload.data : []).flatMap((item) => {
    const date = String(item.d ?? "");
    const factor = Number(item.f);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(factor) && factor > 0 ? [{ date, factor }] : [];
  }).sort((left, right) => right.date.localeCompare(left.date));
}

function factorForDate(events, date) { return events.find((event) => event.date <= date)?.factor ?? 1; }
function hashKey(code) { return createHash("sha256").update(`trendsight-bs-1000-v1:${code}`).digest("hex"); }
function boardName(symbol) { const code = symbol.slice(2); return /^(?:688|689)/.test(code) ? "科创板" : /^(?:300|301)/.test(code) ? "创业板" : symbol.startsWith("sh") ? "沪市主板" : "深市主板"; }
function benchmarkReturn(candles, startDate, endDate) { const start = candles.find((candle) => candle.date >= startDate); const end = [...candles].reverse().find((candle) => candle.date <= endDate); return { startDate: start?.date ?? "", endDate: end?.date ?? "", returnPct: start && end ? round((end.close / start.open - 1) * 100, 4) : null }; }
function oneYearBefore(date) { const value = new Date(`${date}T00:00:00Z`); value.setUTCFullYear(value.getUTCFullYear() - 1); return value.toISOString().slice(0, 10); }
function parseArgs(values) { const result = {}; for (let index = 0; index < values.length; index += 1) { const value = values[index]; if (!value.startsWith("--")) continue; const [key, inline] = value.slice(2).split("="); result[key] = inline ?? (values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : true); } return result; }
function integerArg(values, key, fallback) { const value = Number(values[key] ?? fallback); if (!Number.isInteger(value) || value <= 0) throw new Error(`--${key} 必须是正整数`); return value; }
function numberArg(values, key, fallback) { const value = Number(values[key] ?? fallback); if (!Number.isFinite(value) || value < 0) throw new Error(`--${key} 必须是非负数`); return value; }
async function mapLimit(items, limit, worker) { const results = Array(items.length); let cursor = 0; async function run() { while (true) { const index = cursor++; if (index >= items.length) return; try { results[index] = { ok: true, value: await worker(items[index], index) }; } catch (error) { results[index] = { ok: false, error: error instanceof Error ? error.message : String(error) }; } } } await Promise.all(Array.from({ length: limit }, run)); return results; }
function countBy(items, key) { const result = {}; for (const item of items) { const value = key(item); result[value] = (result[value] ?? 0) + 1; } return result; }
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function mean(values) { return values.length ? sum(values) / values.length : null; }
function median(values) { if (!values.length) return null; const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function round(value, digits = 4) { return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)); }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function progress(stage, detail) { console.log(JSON.stringify({ progress: stage, ...detail })); }
