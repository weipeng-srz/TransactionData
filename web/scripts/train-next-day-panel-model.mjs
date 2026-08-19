import { readFile, writeFile } from "node:fs/promises";

import {
  buildNextDayPanelFeatures,
  nextDayPanelFeatureNames,
} from "../app/lib/nextDayPanelModel.ts";

const options = parseArguments(process.argv.slice(2));
if (!options.input || !options.output) throw new Error("需要 --input <回测JSON> 和 --output <模型JSON>");
if (!options.trainEnd || !options.validationEnd) throw new Error("需要 --train-end 和 --validation-end");

const source = JSON.parse(await readFile(options.input, "utf8"));
const rows = source.records.flatMap((record) => {
  if (!record.technicalState?.benchmarkAvailable) return [];
  const features = buildNextDayPanelFeatures({
    technicalState: record.technicalState,
    baselineUpRate: record.baselineUpRate,
    analogUpRate: record.analogUpRate,
    baseUpProbability: record.baseUpProbability,
    ensembleAgreement: record.ensembleAgreement,
    dataSufficiency: record.dataSufficiency,
    activeRuleCount: record.activeRuleCount,
  });
  if (!features.every(Number.isFinite)) return [];
  return [{
    date: record.originDate,
    code: record.code,
    features,
    label: Number(record.actualUp),
    rawProbability: record.probability,
    rollingMajorityProbability: record.baselineUpRate,
  }];
});
const trainRows = rows.filter((row) => row.date <= options.trainEnd);
const validationRows = rows.filter((row) => row.date > options.trainEnd && row.date <= options.validationEnd);
const testRows = rows.filter((row) => row.date > options.validationEnd);
if (Math.min(trainRows.length, validationRows.length, testRows.length) < 200) {
  throw new Error(`时间切分样本不足：${trainRows.length}/${validationRows.length}/${testRows.length}`);
}

const lambdas = [0.001, 0.01, 0.03, 0.1, 0.3];
const developmentStandardizer = fitStandardizer(trainRows);
const development = lambdas.map((lambda) => {
  const model = trainLogistic(trainRows, developmentStandardizer, lambda, 500);
  return {
    lambda,
    model,
    validation: score(validationRows, model, developmentStandardizer),
  };
}).sort((left, right) => left.validation.brierScore - right.validation.brierScore
  || right.validation.accuracy - left.validation.accuracy);
const selected = development[0];
const finalTrainingRows = [...trainRows, ...validationRows];
const finalStandardizer = fitStandardizer(finalTrainingRows);
const finalModel = trainLogistic(finalTrainingRows, finalStandardizer, selected.lambda, 650);
const testScore = score(testRows, finalModel, finalStandardizer);
const testRawScore = scoreRaw(testRows, (row) => row.rawProbability);
const testRollingScore = scoreRaw(testRows, (row) => row.rollingMajorityProbability);
const trainingUpRate = mean(finalTrainingRows.map((row) => row.label));
const testConstantScore = scoreRaw(testRows, () => trainingUpRate);

const artifact = {
  version: `panel-logistic-v1-${options.validationEnd.replaceAll("-", "")}`,
  featureNames: nextDayPanelFeatureNames,
  means: finalStandardizer.means,
  scales: finalStandardizer.scales,
  coefficients: finalModel.coefficients,
  intercept: finalModel.intercept,
  trainedThrough: options.validationEnd,
  validation: {
    samples: testRows.length,
    accuracy: testScore.accuracy,
    brierScore: testScore.brierScore,
    baselineAccuracy: testConstantScore.accuracy,
    baselineBrierScore: testConstantScore.brierScore,
  },
};
const result = {
  artifact,
  data: {
    input: options.input,
    trainEnd: options.trainEnd,
    validationEnd: options.validationEnd,
    trainSamples: trainRows.length,
    validationSamples: validationRows.length,
    testSamples: testRows.length,
    stocks: new Set(rows.map((row) => row.code)).size,
  },
  selection: development.map(({ lambda, validation }) => ({ lambda, validation })),
  holdout: {
    panel: testScore,
    currentModel: testRawScore,
    rollingProbability: testRollingScore,
    constantProbability: testConstantScore,
  },
};
await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));

function trainLogistic(rows, standardizer, lambda, epochs) {
  const featureCount = standardizer.means.length;
  const coefficients = Array(featureCount).fill(0);
  let intercept = logit(mean(rows.map((row) => row.label)));
  const learningRate = 0.055;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const coefficientGradient = Array(featureCount).fill(0);
    let interceptGradient = 0;
    for (const row of rows) {
      const features = standardize(row.features, standardizer);
      let score = intercept;
      for (let index = 0; index < featureCount; index += 1) score += coefficients[index] * features[index];
      const error = sigmoid(score) - row.label;
      interceptGradient += error;
      for (let index = 0; index < featureCount; index += 1) coefficientGradient[index] += error * features[index];
    }
    intercept -= learningRate * interceptGradient / rows.length;
    for (let index = 0; index < featureCount; index += 1) {
      coefficients[index] -= learningRate * (coefficientGradient[index] / rows.length + lambda * coefficients[index]);
    }
  }
  return { intercept, coefficients };
}

function score(rows, model, standardizer) {
  return scoreRaw(rows, (row) => predict(model, standardizer, row.features));
}

function scoreRaw(rows, probabilityOf) {
  const predictions = rows.map((row) => ({ probability: probabilityOf(row), label: row.label }));
  const positives = predictions.filter((item) => item.label === 1).length;
  return {
    samples: rows.length,
    accuracy: predictions.filter((item) => Number(item.probability >= 0.5) === item.label).length / rows.length,
    brierScore: mean(predictions.map((item) => (item.probability - item.label) ** 2)),
    logLoss: mean(predictions.map((item) => {
      const probability = clamp(item.probability, 1e-6, 1 - 1e-6);
      return -(item.label * Math.log(probability) + (1 - item.label) * Math.log(1 - probability));
    })),
    averageProbability: mean(predictions.map((item) => item.probability)),
    actualUpRate: positives / rows.length,
    auc: auc(predictions),
  };
}

function predict(model, standardizer, features) {
  const values = standardize(features, standardizer);
  let score = model.intercept;
  for (let index = 0; index < values.length; index += 1) score += model.coefficients[index] * values[index];
  return sigmoid(score);
}

function fitStandardizer(rows) {
  const featureCount = rows[0].features.length;
  const means = Array.from({ length: featureCount }, (_, index) => mean(rows.map((row) => row.features[index])));
  const scales = Array.from({ length: featureCount }, (_, index) => {
    const variance = mean(rows.map((row) => (row.features[index] - means[index]) ** 2));
    return Math.sqrt(variance) || 1;
  });
  return { means, scales };
}

function standardize(features, standardizer) {
  return features.map((value, index) => (value - standardizer.means[index]) / standardizer.scales[index]);
}

function auc(items) {
  const ordered = [...items].sort((left, right) => left.probability - right.probability);
  const positives = ordered.filter((item) => item.label === 1).length;
  const negatives = ordered.length - positives;
  if (!positives || !negatives) return null;
  let positiveRankSum = 0;
  for (let index = 0; index < ordered.length;) {
    let end = index + 1;
    while (end < ordered.length && ordered[end].probability === ordered[index].probability) end += 1;
    const averageRank = (index + 1 + end) / 2;
    positiveRankSum += ordered.slice(index, end).filter((item) => item.label === 1).length * averageRank;
    index = end;
  }
  return (positiveRankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, "");
    const value = args[index + 1];
    if (!key || value == null) throw new Error(`参数格式错误：${args[index] ?? ""}`);
    result[({ "train-end": "trainEnd", "validation-end": "validationEnd" })[key] ?? key] = value;
  }
  return result;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function logit(value) {
  const probability = clamp(value, 0.01, 0.99);
  return Math.log(probability / (1 - probability));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-clamp(value, -30, 30)));
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
