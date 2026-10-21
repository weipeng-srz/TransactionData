import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { emptyFinancialDataset } from "../app/lib/financials.ts";
import { calculateIndicators } from "../app/lib/market.ts";
import { calculateRiskMetrics } from "../app/lib/research.ts";
import { buildStockScore } from "../app/lib/stockScore.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, "..");
const dimensionKeys = ["trend", "momentum", "capital", "profitability", "growth", "valuation", "sentiment", "risk"];
const transactionCostPct = 0.2;
const horizons = [5, 10, 20, 40];
const config = parseArguments(process.argv.slice(2));

await main();

async function main() {
  await mkdir(config.fundamentalCache, { recursive: true });
  await mkdir(path.dirname(config.output), { recursive: true });

  const sampleReport = JSON.parse(await readFile(config.sampleReport, "utf8"));
  const sampled = (sampleReport.sampledStocks ?? []).slice(0, config.stocks);
  if (sampled.length < config.stocks) throw new Error(`固定样本只有 ${sampled.length} 只，少于目标 ${config.stocks} 只`);

  const historyFiles = await indexHistoryFiles(config.historyCache);
  const stocks = [];
  for (const item of sampled) {
    const file = historyFiles.get(item.symbol);
    if (!file) continue;
    const cached = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(cached.candles) || cached.candles.length < config.minimumHistory) continue;
    stocks.push({ ...item, candles: cached.candles.map(toCandle) });
  }
  if (stocks.length < config.stocks) throw new Error(`历史缓存只覆盖 ${stocks.length}/${config.stocks} 只股票`);

  const benchmarkFile = path.join(config.historyCache, "sh000300-1500.json");
  const benchmark = JSON.parse(await readFile(benchmarkFile, "utf8")).candles.map(toCandle);
  const benchmarkByDate = new Map(benchmark.map((row, index) => [row.date, { row, index }]));
  const evaluationDates = monthEndDates(benchmark)
    .filter((date) => date >= config.startDate)
    .filter((date) => (benchmarkByDate.get(date)?.index ?? Infinity) < benchmark.length - Math.max(...horizons));

  console.log(`固定样本 ${stocks.length} 只；${evaluationDates.length} 个无前视月末截面；开始加载历史财务主指标……`);
  const fundamentals = new Map();
  let finished = 0;
  const failures = [];
  await mapLimit(stocks, config.concurrency, async (stock) => {
    try {
      fundamentals.set(stock.code, await loadFinancialHistory(stock.code));
    } catch (reason) {
      failures.push({ code: stock.code, name: stock.name, error: reason instanceof Error ? reason.message : String(reason) });
      fundamentals.set(stock.code, []);
    }
    finished += 1;
    if (finished % 50 === 0 || finished === stocks.length) console.log(`财务进度 ${finished}/${stocks.length}；失败 ${failures.length}`);
  });

  console.log("财务数据就绪，开始逐截面计算八维评分与未来收益……");
  const observations = [];
  for (let stockIndex = 0; stockIndex < stocks.length; stockIndex += 1) {
    const stock = stocks[stockIndex];
    const dateIndex = new Map(stock.candles.map((row, index) => [row.date, index]));
    const financialRows = fundamentals.get(stock.code) ?? [];
    for (const date of evaluationDates) {
      const index = dateIndex.get(date);
      if (index == null || index < 252 || index >= stock.candles.length - Math.max(...horizons) - 1) continue;
      const candles = stock.candles.slice(0, index + 1);
      const indicators = calculateIndicators(candles);
      const financials = financialDatasetAt(stock, financialRows, date, stock.candles[index].close);
      const intent = dailyIntent(candles);
      const report = buildStockScore({
        candles,
        indicators,
        currentPrice: candles.at(-1)?.close ?? null,
        intent,
        financials,
        newsItems: [],
        risk: calculateRiskMetrics(candles.slice(-504), benchmarkWindow(benchmark, date, 504)),
        backtest: emptyBacktest(),
        dataQuality: emptyQuality(),
      });
      const future = futureReturns(stock.candles, index);
      const benchmarkIndex = benchmarkByDate.get(date)?.index;
      if (benchmarkIndex == null) continue;
      const benchmarkFuture = futureReturns(benchmark, benchmarkIndex);
      const dimensions = Object.fromEntries(report.dimensions.map((item) => [item.key, item.score]));
      observations.push({
        code: stock.code,
        name: stock.name,
        board: stock.board,
        date,
        legacyScore: report.score,
        coverage: report.coverage,
        dimensions,
        returns: future,
        excessReturns: Object.fromEntries(horizons.map((horizon) => [horizon, finite(future[horizon]) && finite(benchmarkFuture[horizon]) ? future[horizon] - benchmarkFuture[horizon] : null])),
      });
    }
    if ((stockIndex + 1) % 50 === 0 || stockIndex + 1 === stocks.length) console.log(`评分进度 ${stockIndex + 1}/${stocks.length}；观测 ${observations.length}`);
  }

  const train = observations.filter((item) => item.date < config.holdoutDate);
  const test = observations.filter((item) => item.date >= config.holdoutDate);
  const dimensionDiagnostics = dimensionIcTable(train, test);
  const weights = deriveWeights(dimensionDiagnostics);
  const penalty = selectOverheatPenalty(train, weights);
  for (const observation of observations) {
    observation.optimizedScore = optimizedScore(observation, weights, penalty);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    methodology: {
      sample: `${stocks.length} 只沪深 A 股固定样本`,
      requestedStocks: config.stocks,
      evaluatedStocks: stocks.length,
      observations: observations.length,
      trainObservations: train.length,
      testObservations: test.length,
      startDate: config.startDate,
      holdoutDate: config.holdoutDate,
      lastDate: evaluationDates.at(-1) ?? null,
      cadence: "沪深300月末交易日横截面",
      execution: `评分日后一交易日开盘买入，固定持有 ${horizons.join("/")} 个交易日，收益扣除双边总成本 ${transactionCostPct.toFixed(2)}%`,
      leakageControl: "行情、财务与估值只使用评分日及以前数据；财务按 NOTICE_DATE 首次披露日生效；参数只在留出期之前训练",
      scoreCoverage: "八个维度均参与；历史新闻无法可靠回放，因此舆情维度保持50分中性且覆盖为0；资金维度使用日K量价代理",
      calibrationRule: "以研究型先验权重为起点，按训练期横截面IC做指数收缩；单一维度最高30%，未回放维度降权但不假设其无效",
      financialSource: "东方财富历史财务主指标；估值由评分日价格与当时已披露TTM利润、收入和每股净资产重建",
      marketSource: "腾讯证券前复权日K缓存；沪深300为基准",
      biases: [
        "样本来自当前仍上市股票，存在生存者偏差",
        "历史新闻与逐笔资金数据不可回放，舆情中性、资金使用量价代理",
        "本次采用月末截面，结论不自动外推到任意盘中时点",
        "阈值在训练样本内选择，留出期结果仍不等于未来保证",
      ],
    },
    coverage: {
      financialFailures: failures.length,
      financialFailureExamples: failures.slice(0, 30),
      averageScoreCoverage: average(observations.map((item) => item.coverage)),
      observationsByYear: countBy(observations, (item) => item.date.slice(0, 4)),
    },
    calibration: {
      weights,
      overheatPenalty: penalty,
      dimensionDiagnostics,
    },
    legacy: {
      train: analyzeModel(train, "legacyScore"),
      test: analyzeModel(test, "legacyScore"),
      all: analyzeModel(observations, "legacyScore"),
    },
    optimized: {
      train: analyzeModel(train, "optimizedScore"),
      test: analyzeModel(test, "optimizedScore"),
      all: analyzeModel(observations, "optimizedScore"),
    },
    currentHighScores: currentHighScores(observations),
  };

  await writeFile(config.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdown = config.output.replace(/\.json$/i, ".md");
  await writeFile(markdown, renderMarkdown(report), "utf8");
  console.log(JSON.stringify({ output: config.output, markdown, observations: observations.length, weights, penalty, legacyTest: report.legacy.test.horizon20, optimizedTest: report.optimized.test.horizon20 }, null, 2));
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) continue;
    const [key, inline] = argument.slice(2).split("=", 2);
    values[key] = inline ?? args[++index];
  }
  const stocks = integer(values.stocks, 1_000);
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return {
    stocks,
    concurrency: integer(values.concurrency, 8),
    minimumHistory: integer(values["minimum-history"], 320),
    startDate: values["start-date"] ?? "2022-01-01",
    holdoutDate: values["holdout-date"] ?? "2025-01-01",
    sampleReport: path.resolve(webRoot, values.sample ?? "outputs/phase-backtest-optimized-1000-20260827.json"),
    historyCache: path.resolve(webRoot, values["history-cache"] ?? ".cache/phase-backtest"),
    fundamentalCache: path.resolve(webRoot, values["fundamental-cache"] ?? ".cache/eight-dimension-backtest"),
    output: path.resolve(webRoot, values.output ?? `outputs/eight-dimension-score-backtest-${stocks}-${stamp}.json`),
  };
}

async function indexHistoryFiles(directory) {
  const result = new Map();
  for (const name of await readdir(directory)) {
    const match = name.match(/^((?:sh|sz|bj)\d{6})-(\d+)x640\.json$/);
    if (!match) continue;
    const chunks = Number(match[2]);
    const existing = result.get(match[1]);
    if (!existing || chunks > existing.chunks) result.set(match[1], { chunks, path: path.join(directory, name) });
  }
  return new Map([...result].map(([symbol, value]) => [symbol, value.path]));
}

async function loadFinancialHistory(code) {
  const cachePath = path.join(config.fundamentalCache, `${code}.json`);
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (Array.isArray(cached.rows)) return cached.rows;
  } catch {
    // A missing or interrupted cache entry is fetched again.
  }
  const secuCode = `${code}.${code.startsWith("6") ? "SH" : code.startsWith("8") || code.startsWith("4") ? "BJ" : "SZ"}`;
  const columns = [
    "SECUCODE", "SECURITY_CODE", "SECURITY_NAME_ABBR", "REPORT_DATE", "REPORT_TYPE", "REPORT_DATE_NAME", "NOTICE_DATE",
    "EPSJB", "BPS", "MGJYXJJE", "TOTALOPERATEREVE", "PARENTNETPROFIT", "KCFJCXSYJLR", "TOTALOPERATEREVETZ",
    "PARENTNETPROFITTZ", "KCFJCXSYJLRTZ", "ROEJQ", "ROIC", "XSMLL", "XSJLL", "NETCASH_OPERATE_PK", "TOTAL_SHARE", "REPORT_YEAR",
  ].join(",");
  const url = new URL("https://datacenter-web.eastmoney.com/api/data/v1/get");
  for (const [key, value] of Object.entries({
    reportName: "RPT_F10_FINANCE_MAINFINADATA",
    columns,
    filter: `(SECUCODE=\"${secuCode}\")`,
    pageNumber: "1",
    pageSize: "50",
    sortColumns: "REPORT_DATE",
    sortTypes: "-1",
    source: "WEB",
    client: "WEB",
  })) url.searchParams.set(key, value);
  const payload = await fetchJsonWithRetry(url.toString());
  const rows = Array.isArray(payload?.result?.data) ? payload.result.data : [];
  if (!rows.length) throw new Error("财务主指标为空");
  await writeFile(cachePath, `${JSON.stringify({ fetchedAt: new Date().toISOString(), rows })}\n`, "utf8");
  return rows;
}

async function fetchJsonWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", Referer: "https://data.eastmoney.com/", "User-Agent": "Mozilla/5.0 (compatible; TrendSightResearch/1.0)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.success === false) throw new Error(String(payload.message || "服务拒绝请求"));
      return payload;
    } catch (reason) {
      lastError = reason;
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
  throw lastError;
}

function financialDatasetAt(stock, rows, date, price) {
  const known = rows
    .filter((row) => dateOnly(row.NOTICE_DATE) && dateOnly(row.NOTICE_DATE) <= date)
    .sort((left, right) => dateOnly(right.REPORT_DATE).localeCompare(dateOnly(left.REPORT_DATE)) || dateOnly(right.NOTICE_DATE).localeCompare(dateOnly(left.NOTICE_DATE)));
  const latest = known[0];
  const dataset = emptyFinancialDataset();
  dataset.code = stock.code;
  dataset.name = stock.name;
  if (!latest) return dataset;

  const ttmRevenue = ttmValue(known, latest, "TOTALOPERATEREVE");
  const ttmProfit = ttmValue(known, latest, "PARENTNETPROFIT");
  const ttmCash = ttmValue(known, latest, "NETCASH_OPERATE_PK") ?? ttmValue(known, latest, "MGJYXJJE");
  const shares = positive(latest.TOTAL_SHARE);
  const bps = finiteNumber(latest.BPS);
  const revenueGrowth = finiteNumber(latest.TOTALOPERATEREVETZ);
  const profitGrowth = finiteNumber(latest.PARENTNETPROFITTZ);
  const deductGrowth = finiteNumber(latest.KCFJCXSYJLRTZ);
  const epsTtm = ttmProfit != null && shares ? ttmProfit / shares : null;
  const marketCap = shares ? shares * price : null;
  const pe = epsTtm != null && epsTtm !== 0 ? price / epsTtm : null;
  const pb = bps != null && bps !== 0 ? price / bps : null;
  const ps = marketCap != null && ttmRevenue != null && ttmRevenue !== 0 ? marketCap / ttmRevenue : null;
  const peg = pe != null && profitGrowth != null && profitGrowth > 0 ? pe / profitGrowth : null;

  dataset.snapshot = {
    ...dataset.snapshot,
    asOfDate: date,
    closePrice: price,
    totalMarketCap: marketCap,
    totalShares: shares,
    peTtm: pe,
    pb,
    psTtm: ps,
    peg,
  };
  dataset.analysis.periods = [{
    ttm: {
      roe: finiteNumber(latest.ROEJQ),
      roic: finiteNumber(latest.ROIC),
      grossMargin: finiteNumber(latest.XSMLL),
      netMargin: finiteNumber(latest.XSJLL),
      cashCoverage: ttmCash != null && ttmProfit != null && ttmProfit !== 0 ? ttmCash / ttmProfit : null,
    },
    ttmYoY: { revenue: revenueGrowth, parentNetProfit: profitGrowth, deductNetProfit: deductGrowth },
  }];
  return dataset;
}

function ttmValue(known, latest, field) {
  const reportDate = dateOnly(latest.REPORT_DATE);
  const current = finiteNumber(latest[field]);
  if (!reportDate || current == null) return null;
  if (reportDate.endsWith("12-31")) return current;
  const year = Number(reportDate.slice(0, 4));
  const suffix = reportDate.slice(4);
  const previousAnnual = known.find((row) => dateOnly(row.REPORT_DATE) === `${year - 1}-12-31`);
  const previousSame = known.find((row) => dateOnly(row.REPORT_DATE) === `${year - 1}${suffix}`);
  const annualValue = finiteNumber(previousAnnual?.[field]);
  const previousValue = finiteNumber(previousSame?.[field]);
  return annualValue != null && previousValue != null ? annualValue + current - previousValue : current;
}

function dailyIntent(candles) {
  const candle = candles.at(-1);
  const previous = candles.at(-2);
  if (!candle) return null;
  const range = Math.max(candle.high - candle.low, candle.close * .001);
  const multiplier = clamp(((2 * candle.close) - candle.high - candle.low) / range, -1, 1);
  const activeNetRatio = multiplier * 100;
  const closeVsVwapPct = candle.vwap > 0 ? ((candle.close / candle.vwap) - 1) * 100 : 0;
  const returnPct = previous?.close ? ((candle.close / previous.close) - 1) * 100 : 0;
  const priorVolumes = candles.slice(-21, -1).map((row) => row.volume).sort((left, right) => left - right);
  const medianVolume = priorVolumes.length ? priorVolumes[Math.floor(priorVolumes.length / 2)] : candle.volume;
  const volumeRatio = medianVolume > 0 ? candle.volume / medianVolume : 1;
  const largeNetRatio = activeNetRatio * clamp(volumeRatio / 1.5, .35, 1.25);
  const score = clamp(activeNetRatio / 22 + closeVsVwapPct / 1.2 + returnPct / 3, -4.5, 4.5);
  return {
    score,
    label: score >= 1 ? "偏吸筹 / 承接（量价代理）" : score <= -1 ? "偏派发（量价代理）" : "量价中性 / 分歧",
    activeNetRatio,
    largeNetRatio,
    closeVsVwapPct,
  };
}

function futureReturns(candles, originIndex) {
  const entry = candles[originIndex + 1];
  return Object.fromEntries(horizons.map((horizon) => {
    const exit = candles[originIndex + horizon];
    const value = entry?.open > 0 && exit?.close > 0 ? ((exit.close / entry.open) - 1) * 100 - transactionCostPct : null;
    return [horizon, value];
  }));
}

function benchmarkWindow(benchmark, date, count) {
  const index = benchmark.findIndex((item) => item.date === date);
  return index < 0 ? [] : benchmark.slice(Math.max(0, index - count + 1), index + 1);
}

function monthEndDates(candles) {
  const byMonth = new Map();
  for (const candle of candles) byMonth.set(candle.date.slice(0, 7), candle.date);
  return [...byMonth.values()].sort();
}

function emptyBacktest() {
  return { totalSignals: 0, buySignals: 0, sellSignals: 0, skippedSignals: 0, roundTripCostPct: transactionCostPct, executionModel: "", horizons: [] };
}

function emptyQuality() {
  return { ambiguousDuplicates: 0, duplicateRate: 0, zeroVolumeRows: 0, sideCoverage: 0, dailyContextCoverage: 0, warnings: [] };
}

function dimensionIcTable(train, test) {
  return dimensionKeys.map((key) => {
    const trainIcs = crossSectionIcs(train, (item) => item.dimensions[key], 20, true);
    const testIcs = crossSectionIcs(test, (item) => item.dimensions[key], 20, true);
    return {
      key,
      trainIc: average(trainIcs),
      trainPositiveRate: ratio(trainIcs.filter((value) => value > 0).length, trainIcs.length),
      testIc: average(testIcs),
      testPositiveRate: ratio(testIcs.filter((value) => value > 0).length, testIcs.length),
    };
  });
}

function deriveWeights(diagnostics) {
  const priors = {
    trend: .12,
    momentum: .1,
    capital: .1,
    profitability: .15,
    growth: .15,
    valuation: .18,
    sentiment: .08,
    risk: .12,
  };
  const raw = Object.fromEntries(diagnostics.map((item) => {
    const multiplier = item.trainIc == null
      ? .75
      : Math.exp(clamp(item.trainIc * 8, -.7, .7));
    return [item.key, priors[item.key] * multiplier];
  }));
  const normalized = normalizeWeights(raw);
  return Object.fromEntries(dimensionKeys.map((key) => [key, round(normalized[key] ?? 0, 4)]));
}

function normalizeWeights(raw) {
  const result = { ...raw };
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const total = Object.values(result).reduce((sum, value) => sum + value, 0) || 1;
    for (const key of dimensionKeys) result[key] /= total;
    const capped = dimensionKeys.filter((key) => result[key] > .3);
    if (!capped.length) break;
    const overflow = capped.reduce((sum, key) => sum + result[key] - .3, 0);
    capped.forEach((key) => { result[key] = .3; });
    const recipients = dimensionKeys.filter((key) => !capped.includes(key) && result[key] > 0);
    const recipientTotal = recipients.reduce((sum, key) => sum + result[key], 0) || 1;
    recipients.forEach((key) => { result[key] += overflow * result[key] / recipientTotal; });
  }
  const total = Object.values(result).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(dimensionKeys.map((key) => [key, result[key] / total]));
}

function selectOverheatPenalty(train, weights) {
  const candidates = [];
  for (const threshold of [72, 76, 80, 84]) {
    for (const penalty of [0, 3, 6, 9, 12]) {
      const rule = { trendThreshold: threshold, momentumThreshold: threshold, penalty };
      const prepared = train.map((item) => ({ ...item, candidateScore: optimizedScore(item, weights, rule) }));
      const analysis = analyzeModel(prepared, "candidateScore");
      const primary = analysis.horizon20;
      candidates.push({ ...rule, objective: (primary.meanIc ?? -1) + (primary.topBottomSpread ?? -100) / 100 });
    }
  }
  return candidates.sort((left, right) => right.objective - left.objective)[0];
}

function optimizedScore(observation, weights, penalty) {
  const totalWeight = dimensionKeys.reduce((sum, key) => sum + (weights[key] ?? 0), 0) || 1;
  const raw = dimensionKeys.reduce((sum, key) => sum + observation.dimensions[key] * (weights[key] ?? 0), 0) / totalWeight;
  const coverageAdjusted = 50 + (raw - 50) * (.55 + .45 * observation.coverage / 100);
  const overheated = observation.dimensions.trend >= penalty.trendThreshold && observation.dimensions.momentum >= penalty.momentumThreshold;
  return Math.round(clamp(coverageAdjusted - (overheated ? penalty.penalty : 0), 0, 100));
}

function analyzeModel(items, scoreKey) {
  const result = { observations: items.length };
  for (const horizon of horizons) {
    const valid = items.filter((item) => finite(item[scoreKey]) && finite(item.returns[horizon]) && finite(item.excessReturns[horizon]));
    const ics = crossSectionIcs(valid, (item) => item[scoreKey], horizon, false);
    const quintiles = quintileTable(valid, scoreKey, horizon);
    result[`horizon${horizon}`] = {
      observations: valid.length,
      meanIc: average(ics),
      icPositiveRate: ratio(ics.filter((value) => value > 0).length, ics.length),
      monotonicSteps: quintiles.slice(1).filter((item, index) => item.averageReturn >= quintiles[index].averageReturn).length,
      excessMonotonicSteps: quintiles.slice(1).filter((item, index) => item.averageExcessReturn >= quintiles[index].averageExcessReturn).length,
      topBottomSpread: quintiles.length === 5 ? quintiles[4].averageReturn - quintiles[0].averageReturn : null,
      topBottomExcessSpread: quintiles.length === 5 ? quintiles[4].averageExcessReturn - quintiles[0].averageExcessReturn : null,
      quintiles,
    };
  }
  return result;
}

function crossSectionIcs(items, scoreAccessor, horizon, excess) {
  const groups = groupBy(items, (item) => item.date);
  return [...groups.values()].flatMap((group) => {
    const pairs = group.flatMap((item) => {
      const score = scoreAccessor(item);
      const outcome = excess ? item.excessReturns[horizon] : item.returns[horizon];
      return finite(score) && finite(outcome) ? [[score, outcome]] : [];
    });
    return pairs.length >= 30 ? [spearman(pairs.map((item) => item[0]), pairs.map((item) => item[1]))].filter(finite) : [];
  });
}

function quintileTable(items, scoreKey, horizon) {
  const buckets = Array.from({ length: 5 }, () => []);
  for (const group of groupBy(items, (item) => item.date).values()) {
    const ordered = [...group].sort((left, right) => left[scoreKey] - right[scoreKey]);
    ordered.forEach((item, index) => buckets[Math.min(4, Math.floor(index / ordered.length * 5))].push(item));
  }
  return buckets.map((bucket, index) => ({
    quintile: index + 1,
    observations: bucket.length,
    averageScore: average(bucket.map((item) => item[scoreKey])),
    averageReturn: average(bucket.map((item) => item.returns[horizon])),
    averageExcessReturn: average(bucket.map((item) => item.excessReturns[horizon])),
    winRate: ratio(bucket.filter((item) => item.returns[horizon] > 0).length, bucket.length) * 100,
  }));
}

function currentHighScores(observations) {
  const latestDate = observations.map((item) => item.date).sort().at(-1);
  return observations
    .filter((item) => item.date === latestDate)
    .sort((left, right) => right.optimizedScore - left.optimizedScore || right.coverage - left.coverage)
    .slice(0, 20)
    .map((item) => ({ code: item.code, name: item.name, board: item.board, date: item.date, legacyScore: item.legacyScore, optimizedScore: item.optimizedScore, coverage: item.coverage, dimensions: item.dimensions }));
}

function renderMarkdown(report) {
  const legacy = report.legacy.test.horizon20;
  const optimized = report.optimized.test.horizon20;
  const table = (analysis) => analysis.horizon20.quintiles.map((item) => `| Q${item.quintile} | ${fixed(item.averageScore, 1)} | ${fixed(item.averageReturn, 2)}% | ${fixed(item.averageExcessReturn, 2)}% | ${fixed(item.winRate, 1)}% | ${item.observations} |`).join("\n");
  const weightRows = report.calibration.dimensionDiagnostics.map((item) => `| ${item.key} | ${fixed(item.trainIc, 4)} | ${fixed(item.testIc, 4)} | ${fixed((report.calibration.weights[item.key] ?? 0) * 100, 1)}% |`).join("\n");
  const highRows = report.currentHighScores.map((item, index) => `| ${index + 1} | ${item.name} | ${item.code} | ${item.optimizedScore} | ${item.legacyScore} | ${item.coverage}% |`).join("\n");
  return `# 八维研究评分：1000 股评分—收益关系实测\n\n- 生成时间：${report.generatedAt}\n- 样本：${report.methodology.sample}，${report.methodology.observations} 个股票/月末观测\n- 训练/留出：${report.methodology.startDate}～${report.methodology.holdoutDate} 之前 / ${report.methodology.holdoutDate}～${report.methodology.lastDate}\n- 执行：${report.methodology.execution}\n- 无前视：${report.methodology.leakageControl}\n\n## 结论\n\n- 原等权评分在留出期 20 日横截面 IC 为 ${fixed(legacy.meanIc, 4)}，五分组单调阶数 ${legacy.monotonicSteps}/4，最高组相对最低组收益差 ${fixed(legacy.topBottomSpread, 2)} 个百分点。\n- 优化评分在留出期 20 日横截面 IC 为 ${fixed(optimized.meanIc, 4)}，五分组单调阶数 ${optimized.monotonicSteps}/4，最高组相对最低组收益差 ${fixed(optimized.topBottomSpread, 2)} 个百分点。\n- 评分与收益的关系应按“横截面排序有效性”理解，不是分数每增加 1 分、收益就按固定比例增加。\n\n## 维度诊断与优化权重\n\n| 维度 | 训练期 IC | 留出期 IC | 优化权重 |\n| --- | ---: | ---: | ---: |\n${weightRows}\n\n过热惩罚：趋势与动量同时达到 ${report.calibration.overheatPenalty.trendThreshold} 分时扣 ${report.calibration.overheatPenalty.penalty} 分。\n\n## 留出期 20 日收益分组\n\n### 原等权评分\n\n| 分组 | 平均评分 | 平均净收益 | 平均超额 | 胜率 | 观测 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${table(report.legacy.test)}\n\n### 优化评分\n\n| 分组 | 平均评分 | 平均净收益 | 平均超额 | 胜率 | 观测 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${table(report.optimized.test)}\n\n## 最新月末高分样本\n\n| 排名 | 股票 | 代码 | 优化分 | 原分 | 覆盖 |\n| ---: | --- | --- | ---: | ---: | ---: |\n${highRows}\n\n## 重要限制\n\n${report.methodology.biases.map((item) => `- ${item}`).join("\n")}\n`;
}

function toCandle(row) {
  const amount = Number(row.amount) || Number(row.close) * Number(row.volume);
  const previousClose = Number(row.previousClose) || Number(row.open) || Number(row.close);
  return {
    key: row.date,
    label: row.date.slice(5),
    date: row.date,
    time: "",
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    amount,
    adjustedAmount: amount,
    vwap: Number(row.volume) > 0 ? amount / Number(row.volume) : Number(row.close),
    turnoverPct: null,
    change: Number(row.close) - previousClose,
    changePct: previousClose > 0 ? (Number(row.close) / previousClose - 1) * 100 : 0,
  };
}

function spearman(left, right) {
  return pearson(ranks(left), ranks(right));
}

function ranks(values) {
  const ordered = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const result = Array(values.length);
  for (let index = 0; index < ordered.length;) {
    let end = index + 1;
    while (end < ordered.length && ordered[end].value === ordered[index].value) end += 1;
    const rank = (index + end - 1) / 2 + 1;
    for (let cursor = index; cursor < end; cursor += 1) result[ordered[cursor].index] = rank;
    index = end;
  }
  return result;
}

function pearson(left, right) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = average(left);
  const rightMean = average(right);
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    numerator += a * b;
    leftVariance += a * a;
    rightVariance += b * b;
  }
  return leftVariance > 0 && rightVariance > 0 ? numerator / Math.sqrt(leftVariance * rightVariance) : null;
}

function groupBy(items, keyFor) {
  const result = new Map();
  for (const item of items) result.set(keyFor(item), [...(result.get(keyFor(item)) ?? []), item]);
  return result;
}

function countBy(items, keyFor) {
  return Object.fromEntries([...groupBy(items, keyFor)].map(([key, values]) => [key, values.length]));
}

async function mapLimit(items, limit, mapper) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
}

function dateOnly(value) {
  return String(value ?? "").slice(0, 10);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function average(values) {
  const valid = values.filter(finite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function integer(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function fixed(value, digits) {
  return finite(value) ? value.toFixed(digits) : "—";
}
