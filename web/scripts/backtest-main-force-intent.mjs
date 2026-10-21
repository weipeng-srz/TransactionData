import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { calculateDailyFlowProxy } from "../app/lib/market.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, "..");
const featureNames = [
  "intradayClv",
  "cmf5",
  "cmf20",
  "obv20",
  "closeVsTypical",
  "return5",
  "return20",
  "volumeConfirmedClv",
  "flowPriceDivergence",
];
const horizons = [5, 10, 20];
const config = parseArguments(process.argv.slice(2));

await main();

async function main() {
  await mkdir(path.dirname(config.output), { recursive: true });
  const sampleReport = JSON.parse(await readFile(config.sampleReport, "utf8"));
  const sampled = (sampleReport.sampledStocks ?? []).slice(0, config.stocks);
  if (sampled.length < config.stocks) throw new Error(`固定样本只有 ${sampled.length} 只，少于目标 ${config.stocks} 只`);

  const historyFiles = await indexHistoryFiles(config.historyCache);
  const stocks = [];
  for (const stock of sampled) {
    const file = historyFiles.get(stock.symbol);
    if (!file) continue;
    const cached = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(cached.candles) || cached.candles.length < config.minimumHistory) continue;
    stocks.push({ ...stock, candles: cached.candles.map(normalizeCandle) });
  }
  if (stocks.length < config.stocks) throw new Error(`历史缓存只覆盖 ${stocks.length}/${config.stocks} 只股票`);

  const benchmarkFile = path.join(config.historyCache, "sh000300-1500.json");
  const benchmark = JSON.parse(await readFile(benchmarkFile, "utf8")).candles.map(normalizeCandle);
  const benchmarkByDate = new Map(benchmark.map((row, index) => [row.date, index]));
  const observations = [];

  for (let stockIndex = 0; stockIndex < stocks.length; stockIndex += 1) {
    const stock = stocks[stockIndex];
    for (let index = config.minimumLookback; index < stock.candles.length - Math.max(...horizons); index += config.stride) {
      const current = stock.candles[index];
      const benchmarkIndex = benchmarkByDate.get(current.date);
      if (benchmarkIndex == null || benchmarkIndex >= benchmark.length - Math.max(...horizons)) continue;
      const future = futureOutcomes(stock.candles, index, benchmark, benchmarkIndex);
      if (!Number.isFinite(future[config.targetHorizon]?.excess)) continue;
      observations.push({
        code: stock.code,
        name: stock.name,
        board: stock.board,
        date: current.date,
        features: calculateDailyFlowProxy(stock.candles, index).features,
        baselineScore: baselineScore(stock.candles, index),
        future,
      });
    }
    if ((stockIndex + 1) % 100 === 0 || stockIndex + 1 === stocks.length) {
      console.log(`特征进度 ${stockIndex + 1}/${stocks.length}；观测 ${observations.length}`);
    }
  }

  const fit = observations.filter((item) => item.date < config.tuneDate);
  const tune = observations.filter((item) => item.date >= config.tuneDate && item.date < config.holdoutDate);
  const test = observations.filter((item) => item.date >= config.holdoutDate);
  if (!fit.length || !tune.length || !test.length) throw new Error("拟合、调参或留出分区为空，请检查日期参数");

  const standardizer = buildStandardizer(fit.map((item) => item.features));
  const fittedCandidates = config.ridgeGrid.map((ridge) => {
    const weights = fitRidgeDirectionModel(fit, standardizer, ridge, config.targetHorizon);
    const fitScores = fit.map((item) => modelRawScore(item.features, standardizer, weights));
    const scoreScale = standardDeviation(fitScores) || 1;
    return { ridge, weights, scoreScale };
  });

  const optimization = [];
  for (const candidate of fittedCandidates) {
    for (const threshold of config.thresholdGrid) {
      const metrics = analyzeSignals(
        tune,
        (item) => modelRawScore(item.features, standardizer, candidate.weights) / candidate.scoreScale,
        threshold,
      );
      const balanced = metrics.bullishSignals >= config.minimumSignalsPerSide && metrics.bearishSignals >= config.minimumSignalsPerSide;
      const objective = balanced
        ? (metrics.directionalHitRate - 50) + metrics.averageSignedExcess * 2 + metrics.meanMonthlyIc * 12
        : Number.NEGATIVE_INFINITY;
      optimization.push({ ...candidate, threshold, objective, metrics });
    }
  }
  optimization.sort((left, right) => right.objective - left.objective || left.threshold - right.threshold || left.ridge - right.ridge);
  const chosen = optimization[0];
  if (!chosen || !Number.isFinite(chosen.objective)) throw new Error("调参期没有同时覆盖多空方向的有效阈值");

  const candidateScore = (item) => modelRawScore(item.features, standardizer, chosen.weights) / chosen.scoreScale / chosen.threshold;
  observations.forEach((item) => { item.candidateScore = candidateScore(item); });
  const baselineScoreAccessor = (item) => item.baselineScore;
  const candidateScoreAccessor = (item) => item.candidateScore;
  const observationDates = observations.map((item) => item.date).sort();

  const report = {
    generatedAt: new Date().toISOString(),
    modelVersion: "main-force-proxy-v2-candidate",
    methodology: {
      requestedStocks: config.stocks,
      evaluatedStocks: stocks.length,
      observations: observations.length,
      fitObservations: fit.length,
      tuneObservations: tune.length,
      testObservations: test.length,
      sampleSource: "1000 只当前沪深 A 股固定种子样本",
      marketSource: "腾讯证券前复权日 K 缓存；沪深300同期前复权日 K",
      period: [observationDates[0] ?? null, observationDates.at(-1) ?? null],
      fitPeriod: `样本起点至 ${config.tuneDate} 之前`,
      tunePeriod: `${config.tuneDate} 至 ${config.holdoutDate} 之前`,
      holdoutPeriod: `${config.holdoutDate} 及以后`,
      stride: `每只股票每 ${config.stride} 个交易日取一个无前视观察，降低持有期重叠`,
      execution: `信号日收盘后形成结论，下一交易日开盘进入观察，统计 ${horizons.join("/")} 个交易日后的个股相对沪深300超额方向`,
      target: `${config.targetHorizon} 日超额收益方向；只用于检验代理信号的统计相关性，不等于机构账户身份标签`,
      leakageControl: "所有特征只使用信号日及以前的 OHLCV；模型仅用 2024 年前样本拟合，2024 年选择阈值，2025 年后完全留出",
      limitations: [
        "样本来自当前仍上市股票，存在生存者偏差",
        "日 K 不能观测账户身份、委托队列、撤单或真实机构净流入",
        "公开行情缓存中的成交额主要用于量能权重，不等同交易所逐笔成交额审计数据",
        "留出期统计相关性不构成收益承诺，也不能直接外推到盘中逐笔模式",
      ],
    },
    calibration: {
      featureNames,
      means: standardizer.means,
      standardDeviations: standardizer.standardDeviations,
      ridge: chosen.ridge,
      rawWeights: chosen.weights,
      scoreScale: chosen.scoreScale,
      selectedRawThreshold: chosen.threshold,
      productionScale: "候选原始分除以 scoreScale 与 selectedRawThreshold，使产品阈值保持 ±1",
      tuneSweep: optimization.slice(0, 20).map(({ ridge, threshold, objective, metrics }) => ({ ridge, threshold, objective, metrics })),
    },
    baseline: {
      fit: analyzeSignals(fit, baselineScoreAccessor, 1),
      tune: analyzeSignals(tune, baselineScoreAccessor, 1),
      test: analyzeSignals(test, baselineScoreAccessor, 1),
      testHighConfidence: analyzeSignals(test, baselineScoreAccessor, 2.1),
    },
    candidate: {
      fit: analyzeSignals(fit, candidateScoreAccessor, 1),
      tune: analyzeSignals(tune, candidateScoreAccessor, 1),
      test: analyzeSignals(test, candidateScoreAccessor, 1),
      testHighConfidence: analyzeSignals(test, candidateScoreAccessor, 1.75),
    },
    comparison: {
      testHitRateDelta: analyzeSignals(test, candidateScoreAccessor, 1).directionalHitRate - analyzeSignals(test, baselineScoreAccessor, 1).directionalHitRate,
      testSignedExcessDelta: analyzeSignals(test, candidateScoreAccessor, 1).averageSignedExcess - analyzeSignals(test, baselineScoreAccessor, 1).averageSignedExcess,
      stockClusterHitRateDelta95: bootstrapStockDelta(test, baselineScoreAccessor, candidateScoreAccessor, config.bootstrapSamples),
      testByYear: compareGroups(test, (item) => item.date.slice(0, 4), baselineScoreAccessor, candidateScoreAccessor),
      testByBoard: compareGroups(test, (item) => item.board, baselineScoreAccessor, candidateScoreAccessor),
    },
  };
  report.verdict = buildVerdict(report);

  await writeFile(config.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdownOutput = config.output.replace(/\.json$/i, ".md");
  await writeFile(markdownOutput, renderMarkdown(report), "utf8");
  console.log(JSON.stringify({
    output: config.output,
    markdownOutput,
    observations: observations.length,
    chosen: report.calibration,
    baselineTest: report.baseline.test,
    candidateTest: report.candidate.test,
    verdict: report.verdict,
  }, null, 2));
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
    minimumHistory: integer(values["minimum-history"], 320),
    minimumLookback: integer(values["minimum-lookback"], 40),
    stride: integer(values.stride, 5),
    targetHorizon: integer(values.horizon, 5),
    tuneDate: values["tune-date"] ?? "2024-01-01",
    holdoutDate: values["holdout-date"] ?? "2025-01-01",
    minimumSignalsPerSide: integer(values["minimum-signals-per-side"], 500),
    bootstrapSamples: integer(values.bootstrap, 1_000),
    ridgeGrid: [0, .002, .01, .03, .08, .2],
    thresholdGrid: [.4, .55, .7, .85, 1, 1.15, 1.35, 1.6, 1.9],
    sampleReport: path.resolve(webRoot, values.sample ?? "outputs/phase-backtest-optimized-1000-20260827.json"),
    historyCache: path.resolve(webRoot, values.cache ?? ".cache/phase-backtest"),
    output: path.resolve(webRoot, values.output ?? `outputs/main-force-intent-backtest-${stocks}-${stamp}.json`),
  };
}

async function indexHistoryFiles(directory) {
  const result = new Map();
  for (const name of await readdir(directory)) {
    const match = name.match(/^((?:sh|sz|bj)\d{6})-(\d+)x640\.json$/);
    if (!match) continue;
    const chunks = Number(match[2]);
    const existing = result.get(match[1]);
    if (!existing || chunks > existing.chunks) result.set(match[1], { chunks, file: path.join(directory, name) });
  }
  return new Map([...result].map(([symbol, item]) => [symbol, item.file]));
}

function normalizeCandle(row) {
  const open = positive(row.open);
  const high = positive(row.high);
  const low = positive(row.low);
  const close = positive(row.close);
  const volume = Math.max(0, finite(row.volume));
  const amount = positive(row.amount) || ((open + high + low + close) / 4) * volume;
  return { date: String(row.date), open, high, low, close, volume, amount };
}

function baselineScore(candles, index) {
  const candle = candles[index];
  const previous = candles[index - 1];
  const moneyFlow = moneyFlowMultiplier(candle);
  const activeNetRatio = moneyFlow * 100;
  const typical = (candle.open + candle.high + candle.low + candle.close) / 4;
  const closeVsVwapPct = ((candle.close / Math.max(typical, .0001)) - 1) * 100;
  const closeLocationPct = ((candle.close - candle.low) / Math.max(candle.high - candle.low, candle.close * .001)) * 100;
  const returnPct = ((candle.close / previous.close) - 1) * 100;
  const tailNetRatio = ((candle.close / candle.open) - 1) * 100;
  const priorVolumes = candles.slice(Math.max(0, index - 20), index).map((item) => item.volume);
  const medianVolume = median(priorVolumes);
  const volumeRatio20 = priorVolumes.length >= 5 && medianVolume > 0 ? candle.volume / medianVolume : null;
  let score = thresholdScore(activeNetRatio, 16, 42, .7, 1.25)
    + thresholdScore(closeVsVwapPct, .3, 1, .4, .8)
    + thresholdScore(closeLocationPct - 50, 12, 32, .35, .7)
    + thresholdScore(returnPct, .8, 3, .3, .65)
    + thresholdScore(tailNetRatio, .6, 2.5, .25, .45);
  if (volumeRatio20 != null && volumeRatio20 >= 1.2) score += Math.sign(activeNetRatio || returnPct) * Math.min(.6, (volumeRatio20 - 1) * .4);
  return Number(score.toFixed(2));
}

function futureOutcomes(candles, index, benchmark, benchmarkIndex) {
  return Object.fromEntries(horizons.map((horizon) => {
    const entry = candles[index + 1];
    const exit = candles[index + horizon];
    const benchmarkEntry = benchmark[benchmarkIndex + 1];
    const benchmarkExit = benchmark[benchmarkIndex + horizon];
    const stockReturn = entry?.open > 0 && exit?.close > 0 ? ((exit.close / entry.open) - 1) * 100 : null;
    const benchmarkReturn = benchmarkEntry?.open > 0 && benchmarkExit?.close > 0 ? ((benchmarkExit.close / benchmarkEntry.open) - 1) * 100 : null;
    return [horizon, {
      stock: stockReturn,
      benchmark: benchmarkReturn,
      excess: Number.isFinite(stockReturn) && Number.isFinite(benchmarkReturn) ? stockReturn - benchmarkReturn : null,
    }];
  }));
}

function moneyFlowMultiplier(candle) {
  const range = Math.max(candle.high - candle.low, candle.close * .001);
  return clamp(((2 * candle.close) - candle.high - candle.low) / range, -1, 1);
}

function buildStandardizer(rows) {
  const means = featureNames.map((_, index) => average(rows.map((row) => row[index])));
  const standardDeviations = featureNames.map((_, index) => standardDeviation(rows.map((row) => row[index])) || 1);
  return { means, standardDeviations };
}

function fitRidgeDirectionModel(items, standardizer, ridge, horizon) {
  const width = featureNames.length;
  const matrix = Array.from({ length: width }, () => Array(width).fill(0));
  const target = Array(width).fill(0);
  let count = 0;
  for (const item of items) {
    const excess = item.future[horizon]?.excess;
    if (!Number.isFinite(excess)) continue;
    const x = standardize(item.features, standardizer);
    const y = excess > 0 ? 1 : -1;
    count += 1;
    for (let row = 0; row < width; row += 1) {
      target[row] += x[row] * y;
      for (let column = 0; column < width; column += 1) matrix[row][column] += x[row] * x[column];
    }
  }
  for (let index = 0; index < width; index += 1) matrix[index][index] += ridge * count;
  return solveLinearSystem(matrix, target);
}

function solveLinearSystem(matrix, target) {
  const width = target.length;
  const rows = matrix.map((row, index) => [...row, target[index]]);
  for (let column = 0; column < width; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < width; row += 1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    if (Math.abs(divisor) < 1e-12) continue;
    for (let cursor = column; cursor <= width; cursor += 1) rows[column][cursor] /= divisor;
    for (let row = 0; row < width; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let cursor = column; cursor <= width; cursor += 1) rows[row][cursor] -= factor * rows[column][cursor];
    }
  }
  return rows.map((row) => finite(row[width]));
}

function standardize(features, standardizer) {
  return features.map((value, index) => (value - standardizer.means[index]) / standardizer.standardDeviations[index]);
}

function modelRawScore(features, standardizer, weights) {
  return standardize(features, standardizer).reduce((sum, value, index) => sum + value * weights[index], 0);
}

function analyzeSignals(items, scoreAccessor, threshold) {
  const active = items.flatMap((item) => {
    const score = scoreAccessor(item);
    const excess = item.future[config.targetHorizon]?.excess;
    return Number.isFinite(score) && Math.abs(score) >= threshold && Number.isFinite(excess)
      ? [{ ...item, evaluatedScore: score, direction: Math.sign(score), signedExcess: Math.sign(score) * excess }]
      : [];
  });
  const monthlyIcs = monthlyInformationCoefficients(items, scoreAccessor);
  const byHorizon = Object.fromEntries(horizons.map((horizon) => {
    const values = active.flatMap((item) => {
      const excess = item.future[horizon]?.excess;
      return Number.isFinite(excess) ? [item.direction * excess] : [];
    });
    return [horizon, {
      samples: values.length,
      hitRate: ratio(values.filter((value) => value > 0).length, values.length) * 100,
      averageSignedExcess: average(values),
      medianSignedExcess: median(values),
    }];
  }));
  return {
    observations: items.length,
    signals: active.length,
    coverage: ratio(active.length, items.length) * 100,
    bullishSignals: active.filter((item) => item.direction > 0).length,
    bearishSignals: active.filter((item) => item.direction < 0).length,
    directionalHitRate: ratio(active.filter((item) => item.signedExcess > 0).length, active.length) * 100,
    averageSignedExcess: average(active.map((item) => item.signedExcess)),
    medianSignedExcess: median(active.map((item) => item.signedExcess)),
    meanMonthlyIc: average(monthlyIcs),
    positiveMonthlyIcRate: ratio(monthlyIcs.filter((value) => value > 0).length, monthlyIcs.length) * 100,
    monthlyIcCount: monthlyIcs.length,
    byHorizon,
  };
}

function monthlyInformationCoefficients(items, scoreAccessor) {
  const groups = groupBy(items, (item) => item.date.slice(0, 7));
  return [...groups.values()].flatMap((group) => {
    const pairs = group.flatMap((item) => {
      const score = scoreAccessor(item);
      const excess = item.future[config.targetHorizon]?.excess;
      return Number.isFinite(score) && Number.isFinite(excess) ? [[score, excess]] : [];
    });
    return pairs.length >= 100 ? [spearman(pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1]))].filter(Number.isFinite) : [];
  });
}

function bootstrapStockDelta(items, baselineAccessor, candidateAccessor, samples) {
  const grouped = groupBy(items, (item) => item.code);
  const stockMetrics = [...grouped.values()].flatMap((rows) => {
    const baseline = analyzeSignals(rows, baselineAccessor, 1);
    const candidate = analyzeSignals(rows, candidateAccessor, 1);
    return baseline.signals >= 5 && candidate.signals >= 5
      ? [{ baseline: baseline.directionalHitRate, candidate: candidate.directionalHitRate }]
      : [];
  });
  const random = seededRandom(20260827);
  const deltas = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let sum = 0;
    for (let index = 0; index < stockMetrics.length; index += 1) {
      const item = stockMetrics[Math.floor(random() * stockMetrics.length)];
      sum += item.candidate - item.baseline;
    }
    deltas.push(sum / Math.max(stockMetrics.length, 1));
  }
  deltas.sort((left, right) => left - right);
  return {
    stocks: stockMetrics.length,
    meanDelta: average(deltas),
    lower: percentile(deltas, .025),
    upper: percentile(deltas, .975),
  };
}

function compareGroups(items, keyAccessor, baselineAccessor, candidateAccessor) {
  return [...groupBy(items, keyAccessor)].map(([key, rows]) => ({
    key,
    baseline: analyzeSignals(rows, baselineAccessor, 1),
    candidate: analyzeSignals(rows, candidateAccessor, 1),
  }));
}

function buildVerdict(report) {
  const baseline = report.baseline.test;
  const candidate = report.candidate.test;
  const interval = report.comparison.stockClusterHitRateDelta95;
  const passes = {
    positiveIc: candidate.meanMonthlyIc > 0,
    positiveSignedExcess: candidate.averageSignedExcess > 0,
    hitRateAboveChance: candidate.directionalHitRate > 50,
    improvesBaseline: report.comparison.testHitRateDelta > 0 && report.comparison.testSignedExcessDelta > 0,
    clusterDeltaPositive: interval.lower > 0,
    balancedCoverage: candidate.bullishSignals >= 500 && candidate.bearishSignals >= 500,
  };
  const passed = Object.values(passes).filter(Boolean).length;
  const level = passed === Object.keys(passes).length ? "moderate" : passed >= 4 ? "limited" : "unreliable";
  const summary = level === "moderate"
    ? "候选模型在留出期呈现稳定但有限的统计相关性，可作为低置信量价代理；仍不能证明真实机构行为。"
    : level === "limited"
      ? "候选模型仅呈现部分留出期优势，应缩小信号覆盖并降低置信度；不能作为独立交易结论。"
      : "留出期证据不足，主力行为结论不可信；产品应退化为中性量价观察。";
  return { level, summary, passes, baselineHitRate: baseline.directionalHitRate, candidateHitRate: candidate.directionalHitRate };
}

function renderMarkdown(report) {
  const baseline = report.baseline.test;
  const candidate = report.candidate.test;
  const high = report.candidate.testHighConfidence;
  const interval = report.comparison.stockClusterHitRateDelta95;
  const weightRows = featureNames.map((name, index) => `| ${name} | ${fixed(report.calibration.rawWeights[index], 5)} | ${fixed(report.calibration.means[index], 4)} | ${fixed(report.calibration.standardDeviations[index], 4)} |`).join("\n");
  const groupRows = report.comparison.testByYear.map((item) => `| ${item.key} | ${item.baseline.signals} | ${fixed(item.baseline.directionalHitRate, 2)}% | ${item.candidate.signals} | ${fixed(item.candidate.directionalHitRate, 2)}% | ${fixed(item.candidate.averageSignedExcess, 3)}% |`).join("\n");
  return `# 主力行为量价代理：1000 股留出期验证与优化\n\n- 生成时间：${report.generatedAt}\n- 样本：${report.methodology.evaluatedStocks} 只股票，${report.methodology.observations} 个无前视观察\n- 数据：${report.methodology.marketSource}\n- 分区：${report.methodology.fitPeriod}；${report.methodology.tunePeriod}；${report.methodology.holdoutPeriod}\n\n## 结论\n\n**${report.verdict.summary}**\n\n- 原模型留出期：${baseline.signals} 个信号，方向命中率 ${fixed(baseline.directionalHitRate, 2)}%，平均方向超额 ${fixed(baseline.averageSignedExcess, 3)}%，月度 IC ${fixed(baseline.meanMonthlyIc, 4)}。\n- 优化候选留出期：${candidate.signals} 个信号，方向命中率 ${fixed(candidate.directionalHitRate, 2)}%，平均方向超额 ${fixed(candidate.averageSignedExcess, 3)}%，月度 IC ${fixed(candidate.meanMonthlyIc, 4)}。\n- 高置信子集：${high.signals} 个信号，覆盖 ${fixed(high.coverage, 2)}%，方向命中率 ${fixed(high.directionalHitRate, 2)}%，平均方向超额 ${fixed(high.averageSignedExcess, 3)}%。\n- 相对原模型，按股票聚类重采样的命中率差为 ${fixed(interval.meanDelta, 2)} 个百分点，95% 区间 ${fixed(interval.lower, 2)}～${fixed(interval.upper, 2)}。\n\n这里的“命中”只表示信号方向与未来 ${config.targetHorizon} 日相对沪深300超额方向一致，不能识别或证明真实机构账户正在吸筹、拉升或派发。\n\n## 留出期年度稳定性\n\n| 年份 | 原信号 | 原命中 | 优化信号 | 优化命中 | 优化方向超额 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${groupRows}\n\n## 候选模型\n\n- 岭参数：${report.calibration.ridge}\n- 调参期原始阈值：${fixed(report.calibration.selectedRawThreshold, 2)}\n- 产品分数缩放：${report.calibration.productionScale}\n\n| 特征 | 权重 | 训练均值 | 训练标准差 |\n| --- | ---: | ---: | ---: |\n${weightRows}\n\n## 方法与边界\n\n- ${report.methodology.execution}\n- ${report.methodology.leakageControl}\n- ${report.methodology.target}\n${report.methodology.limitations.map((item) => `- ${item}`).join("\n")}\n\n本报告是模型验证，不构成投资建议或收益承诺。\n`;
}

function thresholdScore(value, low, high, lowWeight, highWeight) {
  if (value >= high) return highWeight;
  if (value >= low) return lowWeight;
  if (value <= -high) return -highWeight;
  if (value <= -low) return -lowWeight;
  return 0;
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
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? numerator / denominator : null;
}

function groupBy(items, keyAccessor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyAccessor(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function integer(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function standardDeviation(values) {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function median(values) {
  return percentile(values, .5);
}

function percentile(values, probability) {
  const valid = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!valid.length) return 0;
  const position = (valid.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.min(valid.length - 1, lower + 1);
  return valid[lower] + (valid[upper] - valid[lower]) * (position - lower);
}

function fixed(value, digits) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}
