import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scoreScreenerOpportunity } from "../app/lib/screenerData.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, "..");
const defaultSeed = 20260827;
const defaultHorizons = [5, 10, 20, 40];
const transactionCost = 0.002;
let activeBenchmark = null;

const config = parseArguments(process.argv.slice(2));
await main();

async function main() {
  await mkdir(config.cacheDirectory, { recursive: true });
  await mkdir(path.dirname(config.output), { recursive: true });

  console.log(config.reuseSample ? "读取上次固定样本并刷新流通股本……" : "读取沪深 A 股当前股票池……");
  const sampleSource = config.reuseSample ? await loadReusableSample(config.reuseSample) : null;
  const universe = sampleSource?.stocks ?? await fetchUniverse();
  const eligible = sampleSource?.stocks ?? universe.filter(isEligibleUniverseStock);
  const candidates = sampleSource?.stocks ?? seededShuffle(eligible, config.seed);
  const universeCount = sampleSource?.universeCount ?? universe.length;
  const eligibleUniverseCount = sampleSource?.eligibleUniverseCount ?? eligible.length;
  console.log(`全市场 ${universeCount} 只；当前质量过滤后 ${eligibleUniverseCount} 只；固定种子 ${config.seed}`);

  console.log(`抓取前复权日 K，目标 ${config.stocks} 只，每只最多 ${config.historyChunks * config.chunkSize} 根……`);
  const { stocks, failures } = await loadStockSample(candidates);
  if (stocks.length < config.stocks) {
    throw new Error(`只有 ${stocks.length} 只股票取得至少 ${config.minimumHistory} 根历史日 K，未达到 ${config.stocks} 只目标`);
  }

  const benchmark = await loadBenchmark();
  const benchmarkContext = buildBenchmarkContext(benchmark);
  activeBenchmark = benchmarkContext;
  console.log(`行情就绪：${stocks.length} 只股票；基准 ${benchmark.length} 根；开始逐日无前视评分……`);

  const evaluated = [];
  for (let index = 0; index < stocks.length; index += 1) {
    const stock = stocks[index];
    evaluated.push({ ...stock, scores: scoreHistory(stock, benchmarkContext) });
    if ((index + 1) % 50 === 0 || index + 1 === stocks.length) {
      console.log(`评分进度 ${index + 1}/${stocks.length}`);
    }
  }
  applyHistoricalRanks(evaluated);
  console.log("已完成逐交易日横向排名；开始生成稀缺信号与退出策略对照……");

  const baseline = evaluated.flatMap((stock) => collectBaselineEvents(stock));
  const strategies = [
    buildStrategy(evaluated, "mainUptrend", 62, "主升旧规则≥62", { scoreKey: "rawMainUptrend" }),
    buildStrategy(evaluated, "mainUptrend", 55, "主升优化版", { requireActionable: true, minRankPercentile: 80, maxRisk: 68 }),
    buildStrategy(evaluated, "accumulation", 58, "建仓旧规则≥58", { scoreKey: "rawAccumulation" }),
    buildStrategy(evaluated, "accumulation", 50, "建仓早期/确认", { requireActionable: true, minRankPercentile: 50, stages: ["早期平台", "平台确认"] }),
    buildStrategy(evaluated, "accumulation", 72, "建仓突破准备", { requireActionable: true, minRankPercentile: 80, stages: ["突破准备"] }),
  ];
  const baselineSummary = summarizeEvents(baseline, config.seed ^ 0x51f15e);
  const strategySummaries = strategies.map((strategy, index) => ({
    key: strategy.key,
    label: strategy.label,
    phase: strategy.phase,
    threshold: strategy.threshold,
    ...summarizeEvents(strategy.events, config.seed ^ ((index + 1) * 0x9e3779b)),
    conversion: strategy.phase === "accumulation" ? summarizeConversion(strategy.events) : null,
  }));

  const thresholdSweep = {
    mainUptrend: [55, 60, 65, 70, 75, 80].map((threshold, index) => summarizeSweep(
      buildStrategy(evaluated, "mainUptrend", threshold, `主升优化 ${threshold}`, { requireActionable: true, minRankPercentile: 80, maxRisk: 68 }),
      config.seed ^ (0x1000 + index),
    )),
    accumulation: [50, 55, 60, 65, 70, 72, 75, 80].map((threshold, index) => summarizeSweep(
      buildStrategy(evaluated, "accumulation", threshold, `建仓优化 ${threshold}`, { requireActionable: true, minRankPercentile: 80 }),
      config.seed ^ (0x2000 + index),
    )),
  };

  const legacyMain = strategies[0].events;
  const optimizedMain = strategies[1].events;
  const legacyAccumulation = strategies[2].events;
  const optimizedAccumulation = buildStrategy(evaluated, "accumulation", 50, "建仓优化汇总", { requireActionable: true, minRankPercentile: 80 }).events;
  const mainRankDiagnostics = [50, 60, 70, 80].map((rank) => optimizationSummary(
    `主升横向前${100 - rank}%`,
    buildStrategy(evaluated, "mainUptrend", 55, `主升横向前${100 - rank}%`, { requireActionable: true, minRankPercentile: rank, maxRisk: 68 }).events,
  ));
  const accumulationRankDiagnostics = [50, 60, 70, 80].map((rank) => optimizationSummary(
    `建仓早期/确认横向前${100 - rank}%`,
    buildStrategy(evaluated, "accumulation", 50, `建仓早期/确认横向前${100 - rank}%`, { requireActionable: true, minRankPercentile: rank, stages: ["早期平台", "平台确认"] }).events,
    true,
  ));
  const optimizations = [
    optimizationSummary("主升旧规则", legacyMain),
    optimizationSummary("主升优化：环境+防追高+前20%", optimizedMain),
    optimizationSummary("主升优化：强势环境（基准>5%）", optimizedMain.filter((item) => item.benchmarkReturn20 > 5)),
    optimizationSummary("建仓旧规则", legacyAccumulation, true),
    optimizationSummary("建仓优化：非弱市+换手+前20%", optimizedAccumulation, true),
    optimizationSummary("建仓优化：早期/确认", strategies[3].events, true),
    optimizationSummary("建仓优化：早期/确认+基准>0", strategies[3].events.filter((item) => item.benchmarkReturn20 > 0), true),
    optimizationSummary("建仓优化：突破准备", strategies[4].events, true),
    ...mainRankDiagnostics,
    ...accumulationRankDiagnostics,
  ];

  const dates = stocks.flatMap((stock) => [stock.candles[0]?.date, stock.candles.at(-1)?.date]).filter(Boolean).sort();
  const boardDistribution = countBy(stocks, (stock) => stock.board);
  const report = {
    generatedAt: new Date().toISOString(),
    modelVersion: "rules-2026.08.4",
    methodology: {
      universe: "新浪财经当前沪深 A 股行情池，经现有价格、成交额、ST/退市过滤后固定种子抽样",
      requestedStocks: config.stocks,
      evaluatedStocks: stocks.length,
      universeCount,
      eligibleUniverseCount,
      seed: config.seed,
      dataSource: "腾讯证券前复权日 K；新浪财经当前股票池",
      benchmark: "沪深300（sh000300）",
      requestedBarsPerStock: config.historyChunks * config.chunkSize,
      minimumHistory: config.minimumHistory,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      horizons: config.horizons,
      transactionCost,
      eventDefinition: `当日收盘首次满足分数、环境、防追高和当日横向排名条件；同一股票同类信号至少间隔 ${config.cooldown} 个交易日`,
      ranking: "每个交易日仅在1000股固定样本的有效信号中横向排名，优化版要求位于前20%；不等同完整历史全市场排名",
      execution: "信号产生后的下一交易日开盘买入；固定持有5/10/20/40日，并对照初始风险位、1R保本、2R后MA10/2ATR移动保护、最长40日退出",
      leakageControl: "每次评分只传入该交易日及以前最多90根日K，基准相对强弱也只使用当日及以前数据",
      turnoverCaveat: "历史换手率由腾讯成交量与当前流通股本近似估算，送转或股本变化期间可能存在偏差",
      biases: [
        "样本来自当前仍上市股票，存在生存者偏差",
        "当前名称和流动性过滤无法完整重建历史 ST、退市与当时可交易股票池",
        "停牌日不会形成日K，持有期按该股票实际交易日计",
        "本次阈值比较属于样本内诊断，任何优化均需在独立时段再次验证",
      ],
    },
    coverage: {
      boardDistribution,
      historyRows: stocks.reduce((sum, stock) => sum + stock.candles.length, 0),
      failures: failures.length,
      failureExamples: failures.slice(0, 30),
    },
    baseline: baselineSummary,
    baselineConversion: summarizeConversion(baseline),
    strategies: strategySummaries,
    thresholdSweep,
    optimizations,
    sampledStocks: stocks.map((stock) => ({
      code: stock.code,
      name: stock.name,
      symbol: stock.symbol,
      board: stock.board,
      rows: stock.candles.length,
      firstDate: stock.candles[0]?.date,
      lastDate: stock.candles.at(-1)?.date,
    })),
  };

  await writeFile(config.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdownOutput = config.output.replace(/\.json$/i, ".md");
  await writeFile(markdownOutput, renderMarkdown(report), "utf8");
  console.log(JSON.stringify({
    output: config.output,
    markdownOutput,
    stocks: stocks.length,
    historyRows: report.coverage.historyRows,
    period: [report.methodology.firstDate, report.methodology.lastDate],
    strategies: strategySummaries.map((item) => ({
      label: item.label,
      events: item.events,
      stocks: item.stocks,
      return20: item.horizons["20"],
      conversion: item.conversion,
    })),
  }, null, 2));
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) continue;
    const [rawKey, inline] = argument.slice(2).split("=", 2);
    values[rawKey] = inline ?? args[++index];
  }
  const stocks = integer(values.stocks, 1_000);
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return {
    stocks,
    seed: integer(values.seed, defaultSeed),
    historyChunks: integer(values.chunks, 2),
    chunkSize: 640,
    minimumHistory: integer(values["minimum-history"], 320),
    concurrency: integer(values.concurrency, 8),
    cooldown: integer(values.cooldown, 20),
    horizons: defaultHorizons,
    cacheDirectory: path.resolve(webRoot, values.cache ?? ".cache/phase-backtest"),
    output: path.resolve(webRoot, values.output ?? `outputs/phase-backtest-${stocks}-${stamp}.json`),
    reuseSample: values["reuse-sample"] ? path.resolve(webRoot, values["reuse-sample"]) : null,
  };
}

async function loadReusableSample(reportPath) {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const sampled = Array.isArray(report.sampledStocks) ? report.sampledStocks : [];
  if (sampled.length < config.stocks) throw new Error(`复用报告只有 ${sampled.length} 只股票`);
  const profiles = new Map();
  for (const batch of chunks(sampled.slice(0, config.stocks), 50)) {
    const symbols = batch.map((stock) => stock.symbol).join(",");
    const body = await fetchText(`https://qt.gtimg.cn/q=${symbols}`, "https://gu.qq.com/");
    for (const match of body.matchAll(/v_(?:sh|sz)\d{6}="([\s\S]*?)";/g)) {
      const fields = match[1].split("~");
      const code = String(fields[2] ?? "");
      const price = positive(fields[3]);
      const floatShares = positive(fields[72]) || positive(fields[76]);
      if (/^\d{6}$/.test(code)) profiles.set(code, { price, floatShares });
    }
  }
  return {
    universeCount: report.methodology?.universeCount ?? sampled.length,
    eligibleUniverseCount: report.methodology?.eligibleUniverseCount ?? sampled.length,
    stocks: sampled.slice(0, config.stocks).map((stock) => {
      const profile = profiles.get(stock.code) ?? {};
      return {
        symbol: stock.symbol,
        code: stock.code,
        name: stock.name,
        board: stock.board,
        price: profile.price ?? 0,
        change: 0,
        amount: 50_000_000,
        marketCap: 0,
        floatMarketCap: (profile.floatShares ?? 0) * (profile.price ?? 0),
        floatShares: profile.floatShares ?? 0,
        currentTurnover: 0,
      };
    }),
  };
}

async function fetchUniverse() {
  const countEndpoint = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=hs_a";
  const countBody = await fetchText(countEndpoint, "https://vip.stock.finance.sina.com.cn/mkt/");
  const count = Math.max(100, Math.min(6_000, Number(countBody.replaceAll('"', "")) || 0));
  const pages = Array.from({ length: Math.ceil(count / 100) }, (_, index) => index + 1);
  const responses = await mapLimit(pages, 4, async (page) => {
    const endpoint = new URL("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData");
    endpoint.searchParams.set("page", String(page));
    endpoint.searchParams.set("num", "100");
    endpoint.searchParams.set("sort", "symbol");
    endpoint.searchParams.set("asc", "1");
    endpoint.searchParams.set("node", "hs_a");
    endpoint.searchParams.set("symbol", "");
    endpoint.searchParams.set("_s_r_a", "page");
    const body = await fetchText(endpoint, "https://vip.stock.finance.sina.com.cn/mkt/");
    const payload = JSON.parse(body);
    return Array.isArray(payload) ? payload : [];
  });
  return responses.flat().flatMap((raw) => {
    const symbol = String(raw.symbol ?? "").toLowerCase();
    const code = String(raw.code ?? "");
    const price = positive(raw.trade);
    if (!/^(?:sh|sz)\d{6}$/.test(symbol) || !/^\d{6}$/.test(code) || price <= 0) return [];
    const floatMarketCap = nonNegative(raw.nmc) * 10_000;
    return [{
      symbol,
      code,
      name: String(raw.name ?? code).trim() || code,
      price,
      change: finite(raw.changepercent),
      amount: nonNegative(raw.amount),
      marketCap: nonNegative(raw.mktcap) * 10_000,
      floatMarketCap,
      currentTurnover: nonNegative(raw.turnoverratio),
      board: boardFor(symbol, code),
    }];
  });
}

function isEligibleUniverseStock(stock) {
  return stock.price > 2
    && stock.amount >= 50_000_000
    && stock.change > -9.5
    && !/(?:^|\*)ST|退$|^N/.test(stock.name);
}

async function loadStockSample(candidates) {
  const stocks = [];
  const failures = [];
  let offset = 0;
  while (stocks.length < config.stocks && offset < candidates.length) {
    const remaining = config.stocks - stocks.length;
    const batchSize = Math.min(Math.max(50, Math.ceil(remaining * 1.15)), 180, candidates.length - offset);
    const batch = candidates.slice(offset, offset + batchSize);
    offset += batchSize;
    const results = await mapLimit(batch, config.concurrency, async (stock) => {
      try {
        const candles = await loadStockCandles(stock);
        if (candles.length < config.minimumHistory) throw new Error(`历史仅 ${candles.length} 根`);
        return { ...stock, candles };
      } catch (reason) {
        return { ...stock, error: reason instanceof Error ? reason.message : String(reason) };
      }
    });
    for (const result of results) {
      if (result.error) failures.push({ code: result.code, name: result.name, error: result.error });
      else if (stocks.length < config.stocks) stocks.push(result);
    }
    console.log(`历史数据：成功 ${stocks.length}/${config.stocks}；已尝试 ${offset}；失败 ${failures.length}`);
  }
  return { stocks, failures };
}

async function loadStockCandles(stock) {
  const cachePath = path.join(config.cacheDirectory, `${stock.symbol}-${config.historyChunks}x${config.chunkSize}.json`);
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (Array.isArray(cached.candles) && cached.candles.length) return cached.candles;
  } catch {
    // A missing or interrupted cache entry is fetched again.
  }
  const collected = [];
  let endDate = "";
  for (let chunk = 0; chunk < config.historyChunks; chunk += 1) {
    const rows = await fetchTencentCandles(stock.symbol, config.chunkSize, endDate);
    if (!rows.length) break;
    collected.push(...rows);
    const earliest = rows[0].date;
    endDate = previousCalendarDate(earliest);
    if (rows.length < config.chunkSize) break;
  }
  const byDate = new Map(collected.map((row) => [row.date, row]));
  const candles = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  await writeFile(cachePath, `${JSON.stringify({ fetchedAt: new Date().toISOString(), candles })}\n`, "utf8");
  return candles;
}

async function loadBenchmark() {
  const cachePath = path.join(config.cacheDirectory, "sh000300-1500.json");
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (Array.isArray(cached.candles) && cached.candles.length >= 1_000) return cached.candles;
  } catch {
    // Fetch a fresh benchmark below.
  }
  const candles = await fetchTencentCandles("sh000300", 1_500, "", false);
  await writeFile(cachePath, `${JSON.stringify({ fetchedAt: new Date().toISOString(), candles })}\n`, "utf8");
  return candles;
}

async function fetchTencentCandles(symbol, count, endDate = "", adjusted = true) {
  const parameter = `${symbol},day,,${endDate},${count},${adjusted ? "qfq" : ""}`;
  const endpoint = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(parameter)}`;
  const payload = JSON.parse(await fetchText(endpoint, "https://gu.qq.com/"));
  const root = payload?.data?.[symbol] ?? {};
  const rows = root.qfqday ?? root.day ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((raw) => {
    if (!Array.isArray(raw) || raw.length < 6) return [];
    const date = String(raw[0] ?? "").slice(0, 10);
    const open = positive(raw[1]);
    const close = positive(raw[2]);
    const high = positive(raw[3]);
    const low = positive(raw[4]);
    const volume = nonNegative(raw[5]) * 100;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !open || !close || !high || !low) return [];
    return [{ date, open, high, low, close, volume, amount: close * volume }];
  });
}

function buildBenchmarkContext(candles) {
  const byDate = new Map(candles.map((row, index) => [row.date, { row, index }]));
  const return20ByDate = new Map(candles.map((row, index) => [
    row.date,
    index >= 20 ? percentChange(row.close, candles[index - 20].close) : 0,
  ]));
  return { candles, byDate, return20ByDate };
}

function scoreHistory(stock, benchmark) {
  const scores = Array(stock.candles.length).fill(null);
  const floatShares = stock.floatShares || (stock.floatMarketCap > 0 && stock.price > 0 ? stock.floatMarketCap / stock.price : 0);
  for (let index = 89; index < stock.candles.length; index += 1) {
    const row = stock.candles[index];
    const previous = stock.candles[index - 1];
    const change = percentChange(row.close, previous.close);
    const turnover = floatShares > 0 ? row.volume / floatShares * 100 : stock.currentTurnover;
    const history = stock.candles.slice(index - 89, index + 1);
    const benchmarkReturn20 = benchmark.return20ByDate.get(row.date) ?? 0;
    const opportunity = scoreScreenerOpportunity({
      market: "CN",
      symbol: stock.code,
      name: stock.name,
      exchange: stock.symbol.startsWith("sh") ? "沪市" : "深市",
      price: row.close,
      change,
      previousClose: previous.close,
      open: row.open,
      high: row.high,
      low: row.low,
      volume: row.volume,
      amount: row.amount,
      marketCap: stock.marketCap,
      turnover,
      sector: stock.board,
      themes: [stock.board],
      streak: 0,
      securityType: "股票",
      qualityTier: "standard",
      wasYesterdayLimit: false,
      isCurrentLimit: false,
    }, history, benchmarkReturn20);
    scores[index] = {
      eligible: row.close > 2 && row.amount >= 50_000_000,
      mainUptrend: opportunity.phaseAnalysis.mainUptrend.score,
      accumulation: opportunity.phaseAnalysis.accumulation.score,
      rawMainUptrend: opportunity.phaseAnalysis.mainUptrend.rawScore,
      rawAccumulation: opportunity.phaseAnalysis.accumulation.rawScore,
      mainActionable: opportunity.phaseAnalysis.mainUptrend.actionable,
      accumulationActionable: opportunity.phaseAnalysis.accumulation.actionable,
      mainStage: opportunity.phaseAnalysis.mainUptrend.stage,
      accumulationStage: opportunity.phaseAnalysis.accumulation.stage,
      mainRankPercentile: 0,
      accumulationRankPercentile: 0,
      score: opportunity.score,
      risk: opportunity.risk,
      return5: percentChange(row.close, stock.candles[index - 5].close),
      return20: opportunity.return20,
      benchmarkReturn20,
      relativeStrength20: opportunity.relativeStrength20,
      volumeRatio: opportunity.volumeRatio,
      turnover,
      stopPrice: opportunity.plan.stopPrice,
      atr: opportunity.plan.atr,
    };
  }
  return scores;
}

function applyHistoricalRanks(stocks) {
  const byDate = new Map();
  for (const stock of stocks) {
    stock.scores.forEach((score, index) => {
      if (!score?.eligible) return;
      const date = stock.candles[index]?.date;
      if (!date) return;
      const items = byDate.get(date) ?? [];
      items.push(score);
      byDate.set(date, items);
    });
  }
  for (const items of byDate.values()) {
    const assignRanks = (phase, rankKey, pool) => {
      const ordered = [...pool].sort((left, right) => right[phase] - left[phase] || right.score - left.score);
      ordered.forEach((score, index) => {
        score[rankKey] = Math.round((ordered.length - index) / ordered.length * 100);
      });
    };
    assignRanks("mainUptrend", "mainRankPercentile", items.filter((score) => score.mainActionable && score.risk < 68));
    assignRanks("accumulation", "accumulationRankPercentile", items.filter((score) => score.accumulationActionable));
  }
}

function buildStrategy(stocks, phase, threshold, label, rules = {}) {
  return {
    key: `${phase}-${threshold}-${rules.scoreKey ?? "optimized"}-${rules.minRankPercentile ?? 0}-${(rules.stages ?? []).join("_")}`,
    label,
    phase,
    threshold,
    rules,
    events: stocks.flatMap((stock) => collectSignalEvents(stock, phase, threshold, rules)),
  };
}

function collectSignalEvents(stock, phase, threshold, rules = {}) {
  const events = [];
  let lastSignalIndex = -Infinity;
  const scoreKey = rules.scoreKey ?? phase;
  const actionKey = phase === "mainUptrend" ? "mainActionable" : "accumulationActionable";
  const stageKey = phase === "mainUptrend" ? "mainStage" : "accumulationStage";
  const rankKey = phase === "mainUptrend" ? "mainRankPercentile" : "accumulationRankPercentile";
  const qualifies = (score) => Boolean(score?.eligible
    && score[scoreKey] >= threshold
    && (!rules.requireActionable || score[actionKey])
    && (!rules.minRankPercentile || score[rankKey] >= rules.minRankPercentile)
    && (!rules.maxRisk || score.risk < rules.maxRisk)
    && (!rules.stages?.length || rules.stages.includes(score[stageKey])));
  for (let index = 89; index < stock.candles.length - Math.max(...config.horizons); index += 1) {
    const score = stock.scores[index];
    const previous = stock.scores[index - 1];
    if (!qualifies(score)) continue;
    if (qualifies(previous)) continue;
    if (index - lastSignalIndex < config.cooldown) continue;
    const event = buildEvent(stock, index, phase, threshold, rules);
    if (!event) continue;
    events.push(event);
    lastSignalIndex = index;
  }
  return events;
}

function collectBaselineEvents(stock) {
  const events = [];
  const maximumHorizon = Math.max(...config.horizons);
  for (let index = 99; index < stock.candles.length - maximumHorizon; index += 20) {
    if (!stock.scores[index]?.eligible) continue;
    const event = buildEvent(stock, index, "baseline", 0);
    if (event) events.push(event);
  }
  return events;
}

function buildEvent(stock, originIndex, phase, threshold, rules = {}) {
  const entryIndex = originIndex + 1;
  const origin = stock.candles[originIndex];
  const entry = stock.candles[entryIndex];
  const score = stock.scores[originIndex];
  if (!origin || !entry || !score) return null;
  const event = {
    code: stock.code,
    name: stock.name,
    board: stock.board,
    phase,
    threshold,
    rules,
    originIndex,
    originDate: origin.date,
    entryDate: entry.date,
    entryPrice: entry.open,
    mainUptrendScore: score.mainUptrend,
    accumulationScore: score.accumulation,
    rawMainUptrendScore: score.rawMainUptrend,
    rawAccumulationScore: score.rawAccumulation,
    mainStage: score.mainStage,
    accumulationStage: score.accumulationStage,
    mainRankPercentile: score.mainRankPercentile,
    accumulationRankPercentile: score.accumulationRankPercentile,
    overallScore: score.score,
    risk: score.risk,
    return5: score.return5,
    return20: score.return20,
    benchmarkReturn20: score.benchmarkReturn20,
    relativeStrength20: score.relativeStrength20,
    volumeRatio: score.volumeRatio,
    turnover: score.turnover,
    marketRegime: score.benchmarkReturn20 > 5 ? "强势" : score.benchmarkReturn20 < -5 ? "弱势" : "震荡",
    outcomes: {},
  };
  for (const horizon of config.horizons) {
    event.outcomes[horizon] = buildOutcome(stock.candles, entryIndex, horizon);
  }
  event.managedOutcome = buildManagedOutcome(stock.candles, entryIndex, score.stopPrice, score.atr, 40);
  if (phase === "accumulation" || phase === "baseline") {
    const future20 = stock.scores.slice(originIndex + 1, originIndex + 21).filter(Boolean);
    const future40 = stock.scores.slice(originIndex + 1, originIndex + 41).filter(Boolean);
    event.conversion = {
      main62Within20: future20.some((item) => item.rawMainUptrend >= 62),
      main75Within20: future20.some((item) => item.rawMainUptrend >= 75),
      main62Within40: future40.some((item) => item.rawMainUptrend >= 62),
      main75Within40: future40.some((item) => item.rawMainUptrend >= 75),
      optimizedMainWithin20: future20.some((item) => item.mainActionable && item.mainRankPercentile >= 80),
      optimizedMainWithin40: future40.some((item) => item.mainActionable && item.mainRankPercentile >= 80),
    };
  }
  return event;
}

function buildManagedOutcome(candles, entryIndex, proposedStop, atr, maximumHoldingDays) {
  const entry = candles[entryIndex];
  if (!entry) return null;
  const initialStop = Number.isFinite(proposedStop) && proposedStop < entry.open ? proposedStop : entry.open * .975;
  const unitRisk = Math.max(entry.open - initialStop, entry.open * .025);
  const trailingAtr = Number.isFinite(atr) && atr > 0 ? atr : entry.open * .015;
  let protectiveStop = initialStop;
  let highestClose = entry.open;
  let trailing = false;
  const endIndex = Math.min(candles.length - 1, entryIndex + maximumHoldingDays - 1);
  const window = candles.slice(entryIndex, endIndex + 1);
  for (let index = entryIndex; index <= endIndex; index += 1) {
    const row = candles[index];
    if (row.low <= protectiveStop) {
      const exitPrice = row.open <= protectiveStop ? row.open : protectiveStop;
      return managedResult(entry, row, exitPrice, index - entryIndex + 1, trailing ? "移动保护" : protectiveStop >= entry.open ? "保本保护" : "初始风险位", window.slice(0, index - entryIndex + 1));
    }
    highestClose = Math.max(highestClose, row.close);
    if (row.high >= entry.open + unitRisk) protectiveStop = Math.max(protectiveStop, entry.open);
    if (row.high >= entry.open + unitRisk * 2) trailing = true;
    if (trailing) {
      const ma10 = mean(candles.slice(Math.max(entryIndex, index - 9), index + 1).map((item) => item.close));
      protectiveStop = Math.max(protectiveStop, highestClose - Math.max(trailingAtr * 2, entry.open * .02), ma10 * .98);
    }
  }
  const exit = candles[endIndex];
  return managedResult(entry, exit, exit.close, endIndex - entryIndex + 1, "40日到期", window);
}

function managedResult(entry, exit, exitPrice, holdingDays, reason, window) {
  const grossReturn = exitPrice / entry.open - 1;
  return {
    exitDate: exit.date,
    exitPrice,
    grossReturn,
    netReturn: grossReturn - transactionCost,
    holdingDays,
    reason,
    mfe: Math.max(...window.map((row) => row.high)) / entry.open - 1,
    mae: Math.min(...window.map((row) => row.low)) / entry.open - 1,
  };
}

function buildOutcome(candles, entryIndex, horizon) {
  const entry = candles[entryIndex];
  const exitIndex = entryIndex + horizon - 1;
  const exit = candles[exitIndex];
  if (!entry || !exit) return null;
  const window = candles.slice(entryIndex, exitIndex + 1);
  const grossReturn = exit.close / entry.open - 1;
  const benchmarkEntry = activeBenchmark?.byDate.get(entry.date)?.row;
  const benchmarkExit = activeBenchmark?.byDate.get(exit.date)?.row;
  const benchmarkReturn = benchmarkEntry && benchmarkExit ? benchmarkExit.close / benchmarkEntry.open - 1 : null;
  const netReturn = grossReturn - transactionCost;
  return {
    exitDate: exit.date,
    grossReturn,
    netReturn,
    benchmarkReturn,
    excessReturn: Number.isFinite(benchmarkReturn) ? netReturn - benchmarkReturn : null,
    mfe: Math.max(...window.map((row) => row.high)) / entry.open - 1,
    mae: Math.min(...window.map((row) => row.low)) / entry.open - 1,
  };
}

function summarizeEvents(events, seed) {
  const validEvents = events.filter((event) => config.horizons.every((horizon) => event.outcomes[horizon]));
  const horizons = Object.fromEntries(config.horizons.map((horizon) => {
    const values = validEvents.map((event) => event.outcomes[horizon]);
    const returns = values.map((item) => item.netReturn);
    return [horizon, {
      samples: values.length,
      averageNetReturn: mean(returns),
      medianNetReturn: quantile(returns, 0.5),
      winRate: ratio(returns.filter((value) => value > 0).length, returns.length),
      averageExcessReturn: mean(values.map((item) => item.excessReturn).filter(Number.isFinite)),
      excessWinRate: ratio(values.filter((item) => item.excessReturn > 0).length, values.filter((item) => Number.isFinite(item.excessReturn)).length),
      gain5Rate: ratio(returns.filter((value) => value >= 0.05).length, returns.length),
      loss5Rate: ratio(returns.filter((value) => value <= -0.05).length, returns.length),
      averageMfe: mean(values.map((item) => item.mfe)),
      averageMae: mean(values.map((item) => item.mae)),
      stockEqualBootstrap95: horizon === 20 ? stockEqualBootstrap(validEvents, horizon, seed) : null,
    }];
  }));
  return {
    events: validEvents.length,
    stocks: new Set(validEvents.map((event) => event.code)).size,
    firstSignal: validEvents.map((event) => event.originDate).sort()[0] ?? null,
    lastSignal: validEvents.map((event) => event.originDate).sort().at(-1) ?? null,
    horizons,
    managedExit: summarizeManagedExit(validEvents),
    byRegime: Object.fromEntries([...groupBy(validEvents, (event) => event.marketRegime)].map(([regime, items]) => [
      regime,
      summarizeSubset(items, 20),
    ])),
    byBoard: Object.fromEntries([...groupBy(validEvents, (event) => event.board)].map(([board, items]) => [
      board,
      summarizeSubset(items, 20),
    ])),
    byYear: Object.fromEntries([...groupBy(validEvents, (event) => event.originDate.slice(0, 4))].map(([year, items]) => [
      year,
      summarizeSubset(items, 20),
    ])),
  };
}

function summarizeSubset(events, horizon) {
  const returns = events.map((event) => event.outcomes[horizon]?.netReturn).filter(Number.isFinite);
  return {
    events: returns.length,
    stocks: new Set(events.map((event) => event.code)).size,
    averageNetReturn: mean(returns),
    winRate: ratio(returns.filter((value) => value > 0).length, returns.length),
    averageExcessReturn: mean(events.map((event) => event.outcomes[horizon]?.excessReturn).filter(Number.isFinite)),
    excessWinRate: ratio(events.filter((event) => event.outcomes[horizon]?.excessReturn > 0).length, events.filter((event) => Number.isFinite(event.outcomes[horizon]?.excessReturn)).length),
  };
}

function summarizeConversion(events) {
  if (!events.length) return { events: 0 };
  return {
    events: events.length,
    main62Within20: ratio(events.filter((event) => event.conversion?.main62Within20).length, events.length),
    main75Within20: ratio(events.filter((event) => event.conversion?.main75Within20).length, events.length),
    main62Within40: ratio(events.filter((event) => event.conversion?.main62Within40).length, events.length),
    main75Within40: ratio(events.filter((event) => event.conversion?.main75Within40).length, events.length),
    optimizedMainWithin20: ratio(events.filter((event) => event.conversion?.optimizedMainWithin20).length, events.length),
    optimizedMainWithin40: ratio(events.filter((event) => event.conversion?.optimizedMainWithin40).length, events.length),
  };
}

function summarizeManagedExit(events) {
  const outcomes = events.map((event) => event.managedOutcome).filter(Boolean);
  const returns = outcomes.map((item) => item.netReturn);
  return {
    samples: outcomes.length,
    averageNetReturn: mean(returns),
    medianNetReturn: quantile(returns, .5),
    winRate: ratio(returns.filter((value) => value > 0).length, returns.length),
    averageHoldingDays: mean(outcomes.map((item) => item.holdingDays)),
    averageMfe: mean(outcomes.map((item) => item.mfe)),
    averageMae: mean(outcomes.map((item) => item.mae)),
    exitReasons: countBy(outcomes, (item) => item.reason),
  };
}

function summarizeSweep(strategy, seed) {
  const summary = summarizeEvents(strategy.events, seed);
  return {
    threshold: strategy.threshold,
    events: summary.events,
    stocks: summary.stocks,
    return20: summary.horizons["20"],
    conversion: strategy.phase === "accumulation" ? summarizeConversion(strategy.events) : null,
  };
}

function optimizationSummary(label, events, includeConversion = false) {
  const horizon20 = summarizeSubset(events, 20);
  const horizon40 = summarizeSubset(events, 40);
  return {
    label,
    events: events.length,
    stocks: new Set(events.map((event) => event.code)).size,
    horizon20,
    horizon40,
    managedExit: summarizeManagedExit(events),
    byRegime: Object.fromEntries([...groupBy(events, (event) => event.marketRegime)].map(([regime, items]) => [regime, summarizeSubset(items, 20)])),
    byYear: Object.fromEntries([...groupBy(events, (event) => event.originDate.slice(0, 4))].map(([year, items]) => [year, summarizeSubset(items, 20)])),
    conversion: includeConversion ? summarizeConversion(events) : null,
  };
}

function stockEqualBootstrap(events, horizon, seed, samples = 1_000) {
  const groups = [...groupBy(events, (event) => event.code).values()]
    .map((items) => mean(items.map((event) => event.outcomes[horizon]?.netReturn).filter(Number.isFinite)))
    .filter(Number.isFinite);
  if (groups.length < 2) return [null, null];
  const random = mulberry32(seed >>> 0);
  const values = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let total = 0;
    for (let index = 0; index < groups.length; index += 1) total += groups[Math.floor(random() * groups.length)];
    values.push(total / groups.length);
  }
  values.sort((left, right) => left - right);
  return [quantile(values, 0.025), quantile(values, 0.975)];
}

function renderMarkdown(report) {
  const lines = [
    "# 主升浪与建仓特征 1000 股历史回测",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 样本：${report.methodology.evaluatedStocks} 只沪深 A 股，${report.coverage.historyRows.toLocaleString("zh-CN")} 根前复权日 K`,
    `- 区间：${report.methodology.firstDate} 至 ${report.methodology.lastDate}`,
    `- 交易假设：收盘生成信号，下一交易日开盘成交，双边总成本 ${(report.methodology.transactionCost * 100).toFixed(2)}%`,
    "",
    "## 核心结果",
    "",
    "| 信号 | 事件数 | 股票数 | 20日平均净收益 | 20日平均超额 | 20日胜率 | 跑赢基准率 | 管理退出平均净收益 | 管理退出胜率 | 平均持有 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const strategy of report.strategies) {
    const metric = strategy.horizons["20"];
    lines.push(`| ${strategy.label} | ${strategy.events} | ${strategy.stocks} | ${percent(metric.averageNetReturn)} | ${percent(metric.averageExcessReturn)} | ${percent(metric.winRate)} | ${percent(metric.excessWinRate)} | ${percent(strategy.managedExit.averageNetReturn)} | ${percent(strategy.managedExit.winRate)} | ${formatDays(strategy.managedExit.averageHoldingDays)} |`);
  }
  const baseline = report.baseline.horizons["20"];
  lines.push(`| 等间隔基线 | ${report.baseline.events} | ${report.baseline.stocks} | ${percent(baseline.averageNetReturn)} | ${percent(baseline.averageExcessReturn)} | ${percent(baseline.winRate)} | ${percent(baseline.excessWinRate)} | ${percent(report.baseline.managedExit.averageNetReturn)} | ${percent(report.baseline.managedExit.winRate)} | ${formatDays(report.baseline.managedExit.averageHoldingDays)} |`);
  lines.push("", "## 建仓信号向主升信号的转化", "", "| 信号 | 20日转旧主升≥62 | 40日转旧强主升≥75 | 20日转优化主升 | 40日转优化主升 |", "| --- | ---: | ---: | ---: | ---: |");
  for (const strategy of report.strategies.filter((item) => item.conversion)) {
    lines.push(`| ${strategy.label} | ${percent(strategy.conversion.main62Within20)} | ${percent(strategy.conversion.main75Within40)} | ${percent(strategy.conversion.optimizedMainWithin20)} | ${percent(strategy.conversion.optimizedMainWithin40)} |`);
  }
  lines.push(`| 等间隔基线 | ${percent(report.baselineConversion.main62Within20)} | ${percent(report.baselineConversion.main75Within40)} | ${percent(report.baselineConversion.optimizedMainWithin20)} | ${percent(report.baselineConversion.optimizedMainWithin40)} |`);
  lines.push("", "## 逐年20日平均净收益", "", `| 年份 | ${report.strategies.map((item) => item.label).join(" | ")} | 等间隔基线 |`, `| --- | ${report.strategies.map(() => "---:").join(" | ")} | ---: |`);
  const years = [...new Set([report.baseline, ...report.strategies].flatMap((item) => Object.keys(item.byYear)))].sort();
  for (const year of years) {
    lines.push(`| ${year} | ${report.strategies.map((item) => percent(item.byYear[year]?.averageNetReturn)).join(" | ")} | ${percent(report.baseline.byYear[year]?.averageNetReturn)} |`);
  }
  lines.push("", "## 阈值扫描（20日）", "", "### 主升", "", "| 阈值 | 事件数 | 平均净收益 | 胜率 | 股票等权95%区间 |", "| ---: | ---: | ---: | ---: | --- |");
  for (const item of report.thresholdSweep.mainUptrend) {
    const metric = item.return20;
    lines.push(`| ${item.threshold} | ${item.events} | ${percent(metric.averageNetReturn)} | ${percent(metric.winRate)} | ${interval(metric.stockEqualBootstrap95)} |`);
  }
  lines.push("", "### 建仓", "", "| 阈值 | 事件数 | 平均净收益 | 胜率 | 40日转强主升 | 股票等权95%区间 |", "| ---: | ---: | ---: | ---: | ---: | --- |");
  for (const item of report.thresholdSweep.accumulation) {
    const metric = item.return20;
    lines.push(`| ${item.threshold} | ${item.events} | ${percent(metric.averageNetReturn)} | ${percent(metric.winRate)} | ${percent(item.conversion.main75Within40)} | ${interval(metric.stockEqualBootstrap95)} |`);
  }
  lines.push("", "## 条件优化诊断", "", "| 规则 | 事件数 | 20日平均净收益 | 20日胜率 | 管理退出净收益 | 管理退出胜率 | 平均持有 | 40日转优化主升 |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const item of report.optimizations) {
    lines.push(`| ${item.label} | ${item.events} | ${percent(item.horizon20.averageNetReturn)} | ${percent(item.horizon20.winRate)} | ${percent(item.managedExit.averageNetReturn)} | ${percent(item.managedExit.winRate)} | ${formatDays(item.managedExit.averageHoldingDays)} | ${item.conversion ? percent(item.conversion.optimizedMainWithin40) : "—"} |`);
  }
  lines.push("", "## 管理退出触发分布", "", "| 信号 | 初始风险位 | 保本保护 | 移动保护 | 40日到期 |", "| --- | ---: | ---: | ---: | ---: |");
  for (const strategy of report.strategies) {
    const reasons = strategy.managedExit.exitReasons;
    lines.push(`| ${strategy.label} | ${reasons["初始风险位"] ?? 0} | ${reasons["保本保护"] ?? 0} | ${reasons["移动保护"] ?? 0} | ${reasons["40日到期"] ?? 0} |`);
  }
  lines.push("", "## 重要限制", "");
  for (const bias of report.methodology.biases) lines.push(`- ${bias}`);
  lines.push("", "完整机器可读结果、板块分组和失败样本见同名 JSON 文件。", "");
  return lines.join("\n");
}

async function fetchText(endpoint, referer, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json,text/javascript,*/*;q=0.8",
          Referer: referer,
          "User-Agent": "Mozilla/5.0 (compatible; TrendSight-Research/1.0)",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (reason) {
      lastError = reason;
      if (attempt + 1 < attempts) await delay(250 * 2 ** attempt + Math.floor(Math.random() * 120));
    }
  }
  throw new Error(`行情请求失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function mapLimit(values, limit, mapper) {
  const results = Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }));
  return results;
}

function seededShuffle(values, seed) {
  const result = [...values];
  const random = mulberry32(seed >>> 0);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function mulberry32(seed) {
  let value = seed;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4_294_967_296;
  };
}

function previousCalendarDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function boardFor(symbol, code) {
  if (symbol.startsWith("sh") && /^68/.test(code)) return "科创板";
  if (symbol.startsWith("sz") && /^30/.test(code)) return "创业板";
  if (symbol.startsWith("sh")) return "沪市主板";
  return "深市主板";
}

function countBy(values, keyFor) {
  return Object.fromEntries([...groupBy(values, keyFor)].map(([key, items]) => [key, items.length]));
}

function chunks(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function groupBy(values, keyFor) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function quantile(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function percentChange(value, base) {
  return base ? (value / base - 1) * 100 : 0;
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function formatDays(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}日` : "—";
}

function interval(values) {
  return Array.isArray(values) && values.every(Number.isFinite) ? `${percent(values[0])}～${percent(values[1])}` : "—";
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positive(value) {
  return Math.max(0, finite(value));
}

function nonNegative(value) {
  return Math.max(0, finite(value));
}

function integer(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
