import { readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";

import { aggregateCandles, parseMarketCsv } from "../app/lib/market.ts";
import { buildNextDayPrediction } from "../app/lib/nextDayPrediction.ts";
import { fetchRemoteMarketCsv } from "../app/lib/remoteMarket.ts";

const defaultConfig = {
  stocks: 60,
  minimumStocks: 50,
  days: 650,
  origins: 40,
  originStep: 3,
  minimumHistory: 180,
  seed: 20260818,
  workers: Math.min(4, availableParallelism()),
  confidenceEdge: 0.08,
  bootstrapSamples: 2_000,
};

if (isMainThread) {
  await main();
} else {
  await runWorker();
}

async function main() {
  const config = parseArguments(process.argv.slice(2));
  if (!config.universe) throw new Error("缺少 --universe <沪深300成分股CSV路径>");
  if (!config.output) throw new Error("缺少 --output <结果JSON路径>");

  const universe = await readConstituents(config.universe);
  const excludedCodes = new Set(String(config.excludeCodes ?? "").split(",").map((code) => code.trim()).filter(Boolean));
  const eligibleUniverse = universe.filter((stock) => !excludedCodes.has(stock.code));
  if (eligibleUniverse.length < config.stocks) throw new Error(`排除开发集后股票池只有 ${eligibleUniverse.length} 只，无法抽取 ${config.stocks} 只`);
  const sampled = seededShuffle(eligibleUniverse, config.seed).slice(0, config.stocks);

  console.log(`股票池 ${universe.length} 只；排除 ${excludedCodes.size} 只；固定种子 ${config.seed}；抽样 ${sampled.length} 只`);
  console.log(`开始抓取 ${config.days} 根前复权日K与沪深300同期日K……`);
  const benchmarkPromise = loadCandles("000300", "index", config.days);
  const fetched = await mapLimit(sampled, 8, async (stock) => {
    try {
      const candles = await loadCandles(stock.code, "stock", config.days);
      if (candles.length < config.minimumHistory + 2) throw new Error(`历史仅 ${candles.length} 根`);
      return { ...stock, candles };
    } catch (reason) {
      return { ...stock, error: reason instanceof Error ? reason.message : String(reason) };
    }
  });
  const benchmarkCandles = await benchmarkPromise;
  const successfulCandidates = fetched.filter((item) => item.candles);
  const failures = fetched.filter((item) => item.error).map(({ code, name, error }) => ({ code, name, error }));
  if (successfulCandidates.length < config.minimumStocks) {
    throw new Error(`只有 ${successfulCandidates.length} 只股票取得足够历史数据，未达到 ${config.minimumStocks} 只最低要求`);
  }
  const successful = config.evaluationStocks
    ? successfulCandidates.slice(0, config.evaluationStocks)
    : successfulCandidates;
  console.log(`行情就绪：${successful.length} 只成功，${failures.length} 只失败；开始严格时点滚动回测……`);

  const chunks = chunkEvenly(successful, Math.min(config.workers, successful.length));
  let finishedStocks = 0;
  const records = (await Promise.all(chunks.map((stocks) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { stocks, benchmarkCandles, config },
    });
    worker.on("message", (message) => {
      if (message.type === "progress") {
        finishedStocks += 1;
        if (finishedStocks === successful.length || finishedStocks % 5 === 0) {
          console.log(`已完成 ${finishedStocks}/${successful.length} 只股票`);
        }
      } else if (message.type === "result") {
        resolve(message.records);
      }
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`回测 worker 异常退出：${code}`));
    });
  })))).flat();

  const summary = summarize(records, config);
  const report = {
    generatedAt: new Date().toISOString(),
    methodology: {
      universe: "中证指数公司发布的当日沪深300成分股",
      universeAsOf: universe[0]?.asOf ?? null,
      excludedCodes: [...excludedCodes],
      seed: config.seed,
      requestedStocks: config.stocks,
      evaluatedStocks: successful.length,
      historyDaysRequested: config.days,
      originsPerStockRequested: config.origins,
      originStepTradingDays: config.originStep,
      minimumHistory: config.minimumHistory,
      confidenceThresholds: [0.5 - config.confidenceEdge, 0.5 + config.confidenceEdge],
      benchmark: "沪深300（000300）",
      news: "未纳入：缺少可按历史时点重建的完整新闻归档",
      leakageControl: "每个预测切片仅传入该日及以前的个股和基准K线，预测下一根实际日K",
    },
    sampledStocks: sampled.map(({ code, name }) => ({ code, name })),
    failures,
    evaluatedStocks: successful.map(({ code, name, candles }) => ({
      code,
      name,
      candles: candles.length,
      firstDate: candles[0]?.date,
      lastDate: candles.at(-1)?.date,
    })),
    summary,
    records,
  };
  await writeFile(config.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    output: config.output,
    records: records.length,
    modelVersion: summary.modelVersion,
    firstOrigin: summary.period.first,
    lastOrigin: summary.period.last,
    accuracy: summary.overall.accuracy,
    accuracyClusterBootstrap95: summary.overall.accuracyClusterBootstrap95,
    rollingMajorityAccuracy: summary.baselines.rollingMajorityAccuracy,
    liftVsRollingMajority: summary.baselines.liftVsRollingMajority,
    brierScore: summary.overall.brierScore,
    auc: summary.overall.auc,
    highConfidence: summary.highConfidence,
  }, null, 2));
}

async function runWorker() {
  const { stocks, benchmarkCandles, config } = workerData;
  const records = [];
  for (const stock of stocks) {
    records.push(...evaluateStock(stock, benchmarkCandles, config));
    parentPort.postMessage({ type: "progress", code: stock.code });
  }
  parentPort.postMessage({ type: "result", records });
}

function evaluateStock(stock, benchmarkCandles, config) {
  const candles = stock.candles;
  const origins = [];
  for (let index = candles.length - 2; index >= config.minimumHistory && origins.length < config.origins; index -= config.originStep) {
    origins.push(index);
  }
  origins.reverse();
  return origins.flatMap((index) => {
    const current = candles[index];
    const next = candles[index + 1];
    const benchmarkHistory = benchmarkCandles.filter((candle) => candle.date <= current.date);
    const report = buildNextDayPrediction(candles.slice(0, index + 1), {
      mode: "tomorrow",
      market: "CN",
      window: 126,
      neighbors: 15,
      benchmarkCandles: benchmarkHistory,
      benchmarkName: "沪深300",
      newsItems: [],
    });
    if (!report) return [];
    const probability = report.prediction.upProbability;
    const actualReturn = next.close / current.close - 1;
    const actualUp = actualReturn > 0;
    const predictedUp = probability >= 0.5;
    const rollingMajorityUp = report.modelValidation.baselineUpRate >= 0.5;
    const momentum5Up = index >= 5 ? current.close >= candles[index - 5].close : true;
    return [{
      code: stock.code,
      name: stock.name,
      originDate: current.date,
      targetDate: next.date,
      probability,
      actualReturn,
      actualUp,
      predictedUp,
      correct: predictedUp === actualUp,
      flat: next.close === current.close,
      rollingMajorityUp,
      rollingMajorityCorrect: rollingMajorityUp === actualUp,
      momentum5Up,
      momentum5Correct: momentum5Up === actualUp,
      alwaysUpCorrect: actualUp,
      expectedCloseReturn: report.prediction.expectedCloseReturn,
      expectedReturnDirectionCorrect: (report.prediction.expectedCloseReturn >= 0) === actualUp,
      decisionConfidence: report.signal.decisionConfidence,
      grade: report.signal.grade,
      state: report.signal.state,
      marketRegime: report.externalContext.market.regime,
      marketAvailable: report.externalContext.market.available,
      mlEnabled: report.modelValidation.mlEnabled,
      validationAccuracy: report.modelValidation.accuracy,
      validationAuc: report.modelValidation.auc,
      validationBrierImprovement: report.modelValidation.brierImprovement,
      modelVersion: report.modelValidation.version,
      panelEnabled: report.modelValidation.panelEnabled,
      panelProbability: report.modelValidation.panelProbability,
      panelWeight: report.modelValidation.panelWeight,
      regimeLogitAdjustment: report.modelValidation.regimeLogitAdjustment,
      technicalState: report.technicalState,
      analogUpRate: report.similarDays.upRate,
      baselineUpRate: report.modelValidation.baselineUpRate,
      baseUpProbability: report.prediction.baseUpProbability,
      ensembleAgreement: report.signal.ensembleAgreement,
      dataSufficiency: report.signal.dataSufficiency,
      modelWeights: report.weights,
      activeRuleCount: report.activeRules.length,
    }];
  });
}

function summarize(records, config) {
  if (!records.length) throw new Error("回测没有生成有效预测记录");
  const accuracy = ratio(records.filter((item) => item.correct).length, records.length);
  const rollingMajorityAccuracy = ratio(records.filter((item) => item.rollingMajorityCorrect).length, records.length);
  const momentum5Accuracy = ratio(records.filter((item) => item.momentum5Correct).length, records.length);
  const alwaysUpAccuracy = ratio(records.filter((item) => item.alwaysUpCorrect).length, records.length);
  const bootstrap = clusterBootstrap(records, config.bootstrapSamples, config.seed ^ 0x9e3779b9);
  const highConfidence = records.filter((item) => Math.abs(item.probability - 0.5) >= config.confidenceEdge);
  const bullish = records.filter((item) => item.probability >= 0.5 + config.confidenceEdge);
  const bearish = records.filter((item) => item.probability <= 0.5 - config.confidenceEdge);
  const byStock = group(records, (item) => item.code).map(([code, items]) => ({
    code,
    name: items[0].name,
    samples: items.length,
    accuracy: ratio(items.filter((item) => item.correct).length, items.length),
    rollingMajorityAccuracy: ratio(items.filter((item) => item.rollingMajorityCorrect).length, items.length),
    brierScore: mean(items.map((item) => (item.probability - Number(item.actualUp)) ** 2)),
    averageProbability: mean(items.map((item) => item.probability)),
    actualUpRate: ratio(items.filter((item) => item.actualUp).length, items.length),
  })).sort((left, right) => right.accuracy - left.accuracy || left.code.localeCompare(right.code));
  const stockAccuracies = byStock.map((item) => item.accuracy).sort((a, b) => a - b);
  const calibration = probabilityBuckets(records);
  return {
    modelVersion: records[0].modelVersion,
    period: {
      first: records.map((item) => item.originDate).sort()[0],
      last: records.map((item) => item.originDate).sort().at(-1),
    },
    overall: {
      samples: records.length,
      stocks: new Set(records.map((item) => item.code)).size,
      accuracy,
      accuracyClusterBootstrap95: bootstrap.accuracy,
      brierScore: mean(records.map((item) => (item.probability - Number(item.actualUp)) ** 2)),
      logLoss: mean(records.map((item) => {
        const p = clamp(item.probability, 1e-6, 1 - 1e-6);
        return -(Number(item.actualUp) * Math.log(p) + Number(!item.actualUp) * Math.log(1 - p));
      })),
      auc: auc(records),
      expectedReturnDirectionAccuracy: ratio(records.filter((item) => item.expectedReturnDirectionCorrect).length, records.length),
      averageProbability: mean(records.map((item) => item.probability)),
      actualUpRate: alwaysUpAccuracy,
      flatRate: ratio(records.filter((item) => item.flat).length, records.length),
      benchmarkCoverage: ratio(records.filter((item) => item.marketAvailable).length, records.length),
      expectedCalibrationError: calibration.reduce((sum, bucket) => {
        if (!bucket.samples) return sum;
        return sum + Math.abs(bucket.averageProbability - bucket.actualUpRate) * bucket.samples / records.length;
      }, 0),
    },
    baselines: {
      alwaysUpAccuracy,
      rollingMajorityAccuracy,
      momentum5Accuracy,
      liftVsRollingMajority: accuracy - rollingMajorityAccuracy,
      liftVsRollingMajorityClusterBootstrap95: bootstrap.lift,
      liftVsAlwaysUp: accuracy - alwaysUpAccuracy,
      liftVsMomentum5: accuracy - momentum5Accuracy,
    },
    highConfidence: summarizeSubset(highConfidence, records.length),
    bullishSignal: summarizeSubset(bullish, records.length),
    bearishSignal: summarizeSubset(bearish, records.length),
    mlGate: groupedSummary(records, (item) => item.mlEnabled ? "enabled" : "disabled"),
    byMarketRegime: groupedSummary(records, (item) => item.marketRegime || "unknown"),
    byGrade: groupedSummary(records, (item) => item.grade),
    calibration,
    stockDistribution: {
      medianAccuracy: quantile(stockAccuracies, 0.5),
      p25Accuracy: quantile(stockAccuracies, 0.25),
      p75Accuracy: quantile(stockAccuracies, 0.75),
      stocksAbove50Pct: byStock.filter((item) => item.accuracy > 0.5).length,
      stocksBeatingRollingMajority: byStock.filter((item) => item.accuracy > item.rollingMajorityAccuracy).length,
      best: byStock.slice(0, 10),
      worst: byStock.slice(-10).reverse(),
      all: byStock,
    },
  };
}

function summarizeSubset(items, total) {
  return {
    samples: items.length,
    coverage: ratio(items.length, total),
    accuracy: ratio(items.filter((item) => item.correct).length, items.length),
    averageProbability: mean(items.map((item) => item.probability)),
    actualUpRate: ratio(items.filter((item) => item.actualUp).length, items.length),
    averageNextDayReturn: mean(items.map((item) => item.actualReturn)),
  };
}

function groupedSummary(records, keyFn) {
  return Object.fromEntries(group(records, keyFn).map(([key, items]) => [key, {
    samples: items.length,
    accuracy: ratio(items.filter((item) => item.correct).length, items.length),
    brierScore: mean(items.map((item) => (item.probability - Number(item.actualUp)) ** 2)),
    averageProbability: mean(items.map((item) => item.probability)),
    actualUpRate: ratio(items.filter((item) => item.actualUp).length, items.length),
  }]));
}

function probabilityBuckets(records) {
  const ranges = [[0, 0.35], [0.35, 0.42], [0.42, 0.5], [0.5, 0.58], [0.58, 0.65], [0.65, 1.000001]];
  return ranges.map(([low, high]) => {
    const items = records.filter((item) => item.probability >= low && item.probability < high);
    return {
      range: `[${low.toFixed(2)}, ${Math.min(high, 1).toFixed(2)}${high > 1 ? "]" : ")"}`,
      samples: items.length,
      averageProbability: mean(items.map((item) => item.probability)),
      actualUpRate: ratio(items.filter((item) => item.actualUp).length, items.length),
      accuracy: ratio(items.filter((item) => item.correct).length, items.length),
    };
  });
}

function clusterBootstrap(records, samples, seed) {
  const clusters = group(records, (item) => item.code).map(([, items]) => ({
    n: items.length,
    correct: items.filter((item) => item.correct).length,
    baselineCorrect: items.filter((item) => item.rollingMajorityCorrect).length,
  }));
  const random = mulberry32(seed);
  const accuracies = [];
  const lifts = [];
  for (let iteration = 0; iteration < samples; iteration += 1) {
    let n = 0;
    let correct = 0;
    let baselineCorrect = 0;
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      n += cluster.n;
      correct += cluster.correct;
      baselineCorrect += cluster.baselineCorrect;
    }
    accuracies.push(correct / n);
    lifts.push((correct - baselineCorrect) / n);
  }
  accuracies.sort((a, b) => a - b);
  lifts.sort((a, b) => a - b);
  return {
    accuracy: [quantile(accuracies, 0.025), quantile(accuracies, 0.975)],
    lift: [quantile(lifts, 0.025), quantile(lifts, 0.975)],
  };
}

function auc(records) {
  const ordered = [...records].sort((left, right) => left.probability - right.probability);
  const positives = ordered.filter((item) => item.actualUp).length;
  const negatives = ordered.length - positives;
  if (!positives || !negatives) return null;
  let positiveRankSum = 0;
  let index = 0;
  while (index < ordered.length) {
    let end = index + 1;
    while (end < ordered.length && ordered[end].probability === ordered[index].probability) end += 1;
    const averageRank = (index + 1 + end) / 2;
    positiveRankSum += ordered.slice(index, end).filter((item) => item.actualUp).length * averageRank;
    index = end;
  }
  return (positiveRankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

async function loadCandles(code, kind, days) {
  const csv = await fetchRemoteMarketCsv({ code, days, kind });
  const dataset = parseMarketCsv(csv);
  return aggregateCandles(dataset.rows, code, "1d");
}

async function readConstituents(path) {
  const content = await readFile(path, "utf8");
  return content.split(/\r?\n/).slice(1).flatMap((line) => {
    if (!line.trim()) return [];
    const cells = parseCsvLine(line);
    const asOf = cells[0]?.trim();
    const code = cells[4]?.trim();
    const name = cells[5]?.trim();
    return /^\d{8}$/.test(asOf) && /^\d{6}$/.test(code) ? [{ asOf, code, name: name || code }] : [];
  });
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value);
  return cells;
}

function parseArguments(args) {
  const config = { ...defaultConfig };
  const numeric = new Set(["stocks", "minimum-stocks", "evaluation-stocks", "days", "origins", "origin-step", "minimum-history", "seed", "workers", "bootstrap-samples"]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, "");
    const value = args[index + 1];
    if (!key || value == null) throw new Error(`参数格式错误：${args[index] ?? ""}`);
    const property = ({
      "origin-step": "originStep",
      "minimum-history": "minimumHistory",
      "minimum-stocks": "minimumStocks",
      "evaluation-stocks": "evaluationStocks",
      "exclude-codes": "excludeCodes",
      "bootstrap-samples": "bootstrapSamples",
    })[key] ?? key;
    config[property] = numeric.has(key) ? Number(value) : value;
  }
  for (const key of ["stocks", "minimumStocks", "days", "origins", "originStep", "minimumHistory", "seed", "workers", "bootstrapSamples"]) {
    if (!Number.isInteger(config[key]) || config[key] <= 0) throw new Error(`参数 --${key} 必须是正整数`);
  }
  if (config.evaluationStocks != null && (!Number.isInteger(config.evaluationStocks) || config.evaluationStocks <= 0)) {
    throw new Error("参数 --evaluation-stocks 必须是正整数");
  }
  if (config.minimumStocks > config.stocks) throw new Error("--minimum-stocks 不能大于 --stocks");
  if (config.evaluationStocks && config.evaluationStocks > config.stocks) throw new Error("--evaluation-stocks 不能大于 --stocks");
  config.workers = Math.min(config.workers, availableParallelism());
  return config;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function seededShuffle(items, seed) {
  const result = [...items];
  const random = mulberry32(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function chunkEvenly(items, count) {
  return Array.from({ length: count }, (_, chunkIndex) => items.filter((_, index) => index % count === chunkIndex));
}

function group(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = String(keyFn(item));
    const values = groups.get(key) ?? [];
    values.push(item);
    groups.set(key, values);
  }
  return [...groups.entries()];
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function quantile(sortedValues, probability) {
  if (!sortedValues.length) return null;
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sortedValues[lower + 1] == null ? sortedValues[lower] : sortedValues[lower] + fraction * (sortedValues[lower + 1] - sortedValues[lower]);
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
