import { parseCsvRecords } from "./csv.ts";

export type Timeframe = "1d" | "60m" | "30m" | "15m" | "5m" | "1m";
export type LowerIndicator = "VOL" | "MACD" | "KDJ" | "RSI";
export type TradeSession = "开盘集合竞价" | "连续竞价" | "收盘集合竞价" | "盘后交易" | "其他时段";

export type DailyContext = {
  date: string;
  adjustmentFactor?: number;
  listedAShares?: number;
  shareCapitalDate?: string;
};

export type TickRow = {
  date: string;
  time: string;
  code: string;
  price: number;
  rawPrice: number;
  volume: number;
  amount: number;
  adjustedAmount: number;
  status: string;
  rawStatus: string;
  sequence: number;
  session: TradeSession;
  level: string;
  adjustmentFactor?: number;
  listedAShares?: number;
  shareCapitalDate?: string;
};

export type Candle = {
  key: string;
  label: string;
  date: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  adjustedAmount: number;
  vwap: number;
  turnoverPct: number | null;
  listedAShares?: number;
  change: number;
  changePct: number;
};

export type IndicatorSet = {
  ma5: Array<number | null>;
  ma10: Array<number | null>;
  ma20: Array<number | null>;
  ema12: number[];
  ema26: number[];
  bollUpper: Array<number | null>;
  bollMid: Array<number | null>;
  bollLower: Array<number | null>;
  macdDif: number[];
  macdDea: number[];
  macdHist: number[];
  rsi: Array<number | null>;
  k: number[];
  d: number[];
  j: number[];
  vwap: number[];
  volumeMa5: Array<number | null>;
  volumeMa10: Array<number | null>;
  atr14: Array<number | null>;
  nineTurn: Array<NineTurnMark | null>;
  guidePoints: Array<GuidePoint | null>;
};

export type NineTurnMark = {
  count: number;
  direction: "buy" | "sell";
  completed: boolean;
};

export type GuidePoint = {
  type: "buy" | "sell";
  score: number;
  reasons: string[];
};

export type KlineConclusion = {
  label: string;
  tone: "up" | "down" | "neutral";
  summary: string;
  trend: string;
  momentum: string;
  volatility: string;
  support: number;
  resistance: number;
  atr: number | null;
  nineTurn: NineTurnMark | null;
  latestGuide: GuidePoint | null;
  points: string[];
};

export type ParsedDataset = {
  rows: TickRow[];
  codes: string[];
  stockNames: Record<string, string>;
  skipped: number;
  dataLevel: string;
  dailyContexts: Record<string, DailyContext>;
  amountBasis: string;
  timePrecision: string;
  quality: DataQuality;
  listedAShares?: number;
  shareCapitalDate?: string;
  priceBasis?: string;
};

export type DataQuality = {
  ambiguousDuplicates: number;
  duplicateRate: number;
  zeroVolumeRows: number;
  sideCoverage: number;
  dailyContextCoverage: number;
  warnings: string[];
};

export type IntentAnalysis = {
  date: string;
  basis: "level1" | "daily-price-volume";
  label: string;
  tone: "up" | "down" | "neutral";
  confidence: number;
  score: number;
  activeNetAmount: number;
  activeNetRatio: number;
  largeNetAmount: number;
  largeNetRatio: number;
  largeThreshold: number;
  closeVsVwapPct: number;
  closeLocationPct: number;
  turnoverPct: number | null;
  volumeRatio20: number | null;
  tailNetRatio: number;
  evidence: string[];
  warnings: string[];
};

const baseRequiredHeaders = ["交易日期", "成交时间", "成交量(股)"];

export function parseMarketCsv(content: string): ParsedDataset {
  const records = parseCsvRecords(content.replace(/^\uFEFF/, ""));
  if (records.length < 2) {
    throw new Error("CSV 中没有可用的成交记录");
  }

  const metadata = new Map<string, string>();
  const dailyContexts = new Map<string, DailyContext>();
  let headerRowIndex = -1;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const marker = record[0]?.trim();
    if (marker === "#META") {
      parseKeyValueCells(record).forEach((value, key) => metadata.set(key, value));
      continue;
    }
    if (marker === "#DAY") {
      const values = parseKeyValueCells(record);
      const date = values.get("交易日期") ?? "";
      if (date) {
        const factor = Number(values.get("前复权因子"));
        const shares = Number(values.get("流通A股本(股)"));
        dailyContexts.set(date, {
          date,
          adjustmentFactor: Number.isFinite(factor) && factor > 0 ? factor : undefined,
          listedAShares: Number.isFinite(shares) && shares > 0 ? shares : undefined,
          shareCapitalDate: values.get("流通股本生效日") || undefined,
        });
      }
      continue;
    }
    if (record.length === 1 && marker === "") continue;
    headerRowIndex = index;
    break;
  }
  if (headerRowIndex < 0) {
    throw new Error("CSV 中缺少成交表头");
  }

  const headers = records[headerRowIndex].map((header) => header.trim());
  for (const required of baseRequiredHeaders) {
    if (!headers.includes(required)) {
      throw new Error(`缺少必要字段：${required}`);
    }
  }
  if (!headers.includes("前复权成交价格(元)") && !headers.includes("成交价格(元)")) {
    throw new Error("缺少必要字段：前复权成交价格(元) 或 成交价格(元)");
  }

  const column = (name: string) => headers.indexOf(name);
  const dateIndex = column("交易日期");
  const timeIndex = column("成交时间");
  const codeIndex = column("股票代码");
  const nameIndex = column("股票名称");
  const legacyPriceIndex = column("成交价格(元)");
  const adjustedPriceIndex = column("前复权成交价格(元)") >= 0 ? column("前复权成交价格(元)") : legacyPriceIndex;
  const rawPriceIndex = column("原始成交价格(元)");
  const volumeIndex = column("成交量(股)");
  const amountIndex = ["成交金额(元)", "原始成交金额估算(元)", "成交金额估算(元)"]
    .map(column)
    .find((index) => index >= 0) ?? -1;
  const statusIndex = column("性质");
  const rawStatusIndex = column("原始性质代码");
  const sequenceIndex = column("数据序号");
  const sessionIndex = column("交易时段");
  const levelIndex = column("数据级别");
  const metadataCode = metadata.get("股票代码") ?? "";
  const metadataName = metadata.get("股票名称")?.trim() ?? "";
  const globalShares = Number(metadata.get("流通A股本(股)"));

  const rows: TickRow[] = [];
  const codes = new Set<string>();
  const stockNames: Record<string, string> = {};
  let skipped = 0;
  const priceBasis = metadata.get("价格口径") ?? "";
  let dataLevel = metadata.get("成交数据级别") ?? "Level-1历史分笔";
  if (priceBasis) dataLevel += ` · ${priceBasis}`;

  for (let index = headerRowIndex + 1; index < records.length; index += 1) {
    const record = records[index];
    if (record.length === 1 && record[0].trim() === "") continue;

    const price = Number(record[adjustedPriceIndex]);
    const volume = Number(record[volumeIndex]);
    const date = record[dateIndex]?.trim();
    const time = normalizeTime(record[timeIndex]?.trim());
    const code = codeIndex >= 0 ? record[codeIndex]?.trim() : metadataCode;
    if (!date || !time || !code || !Number.isFinite(price) || price <= 0 || !Number.isFinite(volume) || volume < 0) {
      skipped += 1;
      continue;
    }

    const daily = dailyContexts.get(date);
    const rawPriceFromFile = rawPriceIndex >= 0 ? Number(record[rawPriceIndex]) : Number.NaN;
    const rawPrice = Number.isFinite(rawPriceFromFile) && rawPriceFromFile > 0
      ? rawPriceFromFile
      : daily?.adjustmentFactor
        ? price * daily.adjustmentFactor
        : price;
    const amountFromFile = amountIndex >= 0 ? Number(record[amountIndex]) : Number.NaN;
    const amount = Number.isFinite(amountFromFile) && amountFromFile >= 0 ? amountFromFile : rawPrice * volume;
    const level = levelIndex >= 0 ? record[levelIndex]?.trim() : "";
    if (level) dataLevel = level;
    const rawStatus = rawStatusIndex >= 0 ? record[rawStatusIndex]?.trim() : "";
    const status = statusIndex >= 0 ? record[statusIndex]?.trim() : sideFromRawStatus(rawStatus);
    const parsedSequence = sequenceIndex >= 0 ? Number(record[sequenceIndex]) : index - headerRowIndex;
    const listedAShares = daily?.listedAShares ?? (Number.isFinite(globalShares) && globalShares > 0 ? globalShares : undefined);
    rows.push({
      date,
      time,
      code,
      price,
      rawPrice,
      volume,
      amount,
      adjustedAmount: price * volume,
      status,
      rawStatus,
      sequence: Number.isFinite(parsedSequence) && parsedSequence > 0 ? Math.trunc(parsedSequence) : index - headerRowIndex,
      session: sessionIndex >= 0 ? normalizeSession(record[sessionIndex]?.trim(), time) : sessionFromTime(time),
      level: level || dataLevel,
      adjustmentFactor: daily?.adjustmentFactor,
      listedAShares,
      shareCapitalDate: daily?.shareCapitalDate ?? (metadata.get("流通股本生效日") || undefined),
    });
    codes.add(code);
    const rowName = nameIndex >= 0 ? record[nameIndex]?.trim() : "";
    if (rowName) stockNames[code] = rowName;
    else if (metadataName && code === metadataCode) stockNames[code] = metadataName;
  }

  if (rows.length === 0) {
    throw new Error("CSV 字段存在，但没有解析到有效的成交记录");
  }

  rows.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || a.sequence - b.sequence);
  const listedAShares = globalShares;
  const amountBasis = metadata.get("成交金额口径")
    ?? (amountIndex >= 0 || rawPriceIndex >= 0 || dailyContexts.size > 0 ? "原始成交价×成交量" : "前复权价×成交量代理");
  const timePrecision = metadata.get("成交时间精度") ?? "分钟";
  const contexts = Object.fromEntries(dailyContexts);
  return {
    rows,
    codes: [...codes].sort(),
    stockNames,
    skipped,
    dataLevel,
    dailyContexts: contexts,
    amountBasis,
    timePrecision,
    quality: calculateDataQuality(rows, contexts, amountBasis, timePrecision),
    listedAShares: Number.isFinite(listedAShares) && listedAShares > 0 ? listedAShares : undefined,
    shareCapitalDate: metadata.get("流通股本生效日") || undefined,
    priceBasis: priceBasis || undefined,
  };
}

function parseKeyValueCells(record: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 1; index < record.length; index += 1) {
    const cell = record[index].trim();
    const separator = cell.indexOf("=");
    if (separator > 0) values.set(cell.slice(0, separator).trim(), cell.slice(separator + 1).trim());
  }
  return values;
}

function sideFromRawStatus(value: string): string {
  if (value === "0") return "买盘";
  if (value === "1") return "卖盘";
  if (value === "2") return "中性盘";
  return value ? "其他" : "";
}

function normalizeSession(value: string | undefined, time: string): TradeSession {
  const allowed: TradeSession[] = ["开盘集合竞价", "连续竞价", "收盘集合竞价", "盘后交易", "其他时段"];
  return allowed.includes(value as TradeSession) ? value as TradeSession : sessionFromTime(time);
}

function sessionFromTime(time: string): TradeSession {
  const [hour, minute] = time.split(":").map(Number);
  const minuteOfDay = hour * 60 + minute;
  if (minuteOfDay >= 9 * 60 + 15 && minuteOfDay <= 9 * 60 + 25) return "开盘集合竞价";
  if (minuteOfDay >= 9 * 60 + 30 && minuteOfDay <= 11 * 60 + 30) return "连续竞价";
  if (minuteOfDay >= 13 * 60 && minuteOfDay <= 14 * 60 + 56) return "连续竞价";
  if (minuteOfDay >= 14 * 60 + 57 && minuteOfDay <= 15 * 60) return "收盘集合竞价";
  if (minuteOfDay > 15 * 60 && minuteOfDay <= 15 * 60 + 30) return "盘后交易";
  return "其他时段";
}

function calculateDataQuality(
  rows: TickRow[],
  dailyContexts: Record<string, DailyContext>,
  amountBasis: string,
  timePrecision: string,
): DataQuality {
  let ambiguousDuplicates = 0;
  let zeroVolumeRows = 0;
  let sideRows = 0;
  let contextRows = 0;
  let currentDate = "";
  let seen = new Set<string>();
  for (const row of rows) {
    if (row.date !== currentDate) {
      currentDate = row.date;
      seen = new Set<string>();
    }
    const visibleKey = `${row.time}|${row.rawPrice}|${row.volume}|${row.status}`;
    if (seen.has(visibleKey)) ambiguousDuplicates += 1;
    else seen.add(visibleKey);
    if (row.volume === 0) zeroVolumeRows += 1;
    if (["买盘", "卖盘", "中性盘"].includes(row.status) || row.session === "盘后交易") sideRows += 1;
    if (dailyContexts[row.date]?.adjustmentFactor && row.listedAShares) contextRows += 1;
  }
  const denominator = Math.max(rows.length, 1);
  const duplicateRate = ambiguousDuplicates / denominator;
  const sideCoverage = sideRows / denominator;
  const dailyContextCoverage = contextRows / denominator;
  const warnings = ["Level-1分钟分笔不含委托、撤单和订单号，意图结论只能作为代理信号。"];
  if (timePrecision.includes("分钟")) warnings.push("时间精度为分钟，无法识别秒内顺序与拆单链路。");
  if (duplicateRate > 0.01) warnings.push(`${(duplicateRate * 100).toFixed(2)}%记录在可见字段上重复，缺少交易所序号时不能安全去重。`);
  if (sideCoverage < 0.95) warnings.push(`买卖性质覆盖率仅${(sideCoverage * 100).toFixed(1)}%。`);
  if (dailyContextCoverage < 0.99) warnings.push(`按日股本与复权上下文覆盖率为${(dailyContextCoverage * 100).toFixed(1)}%。`);
  if (amountBasis.includes("代理")) warnings.push("成交额由前复权价格估算，不能直接当作真实资金流。");
  if (zeroVolumeRows > 0) warnings.push(`存在${zeroVolumeRows}条零成交量记录。`);
  return { ambiguousDuplicates, duplicateRate, zeroVolumeRows, sideCoverage, dailyContextCoverage, warnings };
}

function normalizeTime(value: string | undefined): string {
  if (!value) return "";
  const parts = value.split(":");
  if (parts.length < 2) return "";
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  const second = Number(parts[2] ?? 0);
  if (![hour, minute, second].every(Number.isFinite)) return "";
  return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function pad(value: number): string {
  return String(Math.trunc(value)).padStart(2, "0");
}

export function aggregateCandles(rows: TickRow[], code: string, timeframe: Timeframe): Candle[] {
  const buckets = new Map<string, Omit<Candle, "change" | "changePct">>();

  for (const row of rows) {
    if (row.code !== code) continue;
    const { key, label, time } = candleBucket(row, timeframe);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        key,
        label,
        date: row.date,
        time,
        open: row.price,
        high: row.price,
        low: row.price,
        close: row.price,
        volume: row.volume,
        amount: row.amount,
        adjustedAmount: row.adjustedAmount,
        vwap: row.volume ? row.adjustedAmount / row.volume : row.price,
        turnoverPct: row.listedAShares ? (row.volume / row.listedAShares) * 100 : null,
        listedAShares: row.listedAShares,
      });
    } else {
      existing.high = Math.max(existing.high, row.price);
      existing.low = Math.min(existing.low, row.price);
      existing.close = row.price;
      existing.volume += row.volume;
      existing.amount += row.amount;
      existing.adjustedAmount += row.adjustedAmount;
      existing.vwap = existing.volume ? existing.adjustedAmount / existing.volume : existing.close;
      existing.turnoverPct = existing.listedAShares ? (existing.volume / existing.listedAShares) * 100 : null;
    }
  }

  const candles = [...buckets.values()];
  return candles.map((candle, index) => {
    const previousClose = index > 0 ? candles[index - 1].close : candle.open;
    const change = candle.close - previousClose;
    return {
      ...candle,
      vwap: candle.volume ? candle.adjustedAmount / candle.volume : candle.close,
      turnoverPct: candle.listedAShares ? (candle.volume / candle.listedAShares) * 100 : null,
      change,
      changePct: previousClose ? (change / previousClose) * 100 : 0,
    };
  });
}

export function analyzeMarketIntent(dataset: ParsedDataset, code: string, date: string): IntentAnalysis | null {
  const dayRows = dataset.rows.filter(
    (row) => row.code === code && row.date === date && row.session !== "盘后交易" && row.session !== "其他时段",
  );
  if (dayRows.length === 0) return null;

  const dailyCandles = aggregateCandles(dataset.rows, code, "1d");
  const dayIndex = dailyCandles.findIndex((candle) => candle.date === date);
  if (dayIndex < 0) return null;
  const candle = dailyCandles[dayIndex];
  const previousClose = dayIndex > 0 ? dailyCandles[dayIndex - 1].close : candle.open;
  const returnPct = previousClose ? ((candle.close / previousClose) - 1) * 100 : 0;
  if (dataset.dataLevel.includes("日K聚合") || dataset.quality.sideCoverage < 0.5) {
    return analyzeDailyMarketIntent(dataset, dailyCandles, dayIndex, candle, returnPct);
  }

  const buyAmount = sumAmount(dayRows, "买盘");
  const sellAmount = sumAmount(dayRows, "卖盘");
  const activeAmount = buyAmount + sellAmount;
  const activeNetAmount = buyAmount - sellAmount;
  const activeNetRatio = activeAmount ? (activeNetAmount / activeAmount) * 100 : 0;

  const positiveAmounts = dayRows.map((row) => row.amount).filter((amount) => amount > 0);
  const largeThreshold = percentile(positiveAmounts, 0.95);
  const largeRows = dayRows.filter((row) => row.amount >= largeThreshold && row.amount > 0);
  const largeBuy = sumAmount(largeRows, "买盘");
  const largeSell = sumAmount(largeRows, "卖盘");
  const largeActive = largeBuy + largeSell;
  const largeNetAmount = largeBuy - largeSell;
  const largeNetRatio = largeActive ? (largeNetAmount / largeActive) * 100 : 0;

  const tailRows = dayRows.filter((row) => row.time >= "14:30:00");
  const tailBuy = sumAmount(tailRows, "买盘");
  const tailSell = sumAmount(tailRows, "卖盘");
  const tailNetRatio = tailBuy + tailSell ? ((tailBuy - tailSell) / (tailBuy + tailSell)) * 100 : 0;

  const closeVsVwapPct = candle.vwap ? ((candle.close / candle.vwap) - 1) * 100 : 0;
  const closeLocationPct = candle.high > candle.low ? ((candle.close - candle.low) / (candle.high - candle.low)) * 100 : 50;
  const priorVolumes = dailyCandles.slice(Math.max(0, dayIndex - 20), dayIndex).map((item) => item.volume);
  const medianVolume = median(priorVolumes);
  const volumeRatio20 = priorVolumes.length >= 5 && medianVolume > 0 ? candle.volume / medianVolume : null;

  let score = thresholdScore(activeNetRatio, 3, 8, 0.6, 1.2)
    + thresholdScore(largeNetRatio, 3, 10, 0.6, 1.2)
    + thresholdScore(closeVsVwapPct, 0.3, 1, 0.5, 1)
    + thresholdScore(closeLocationPct - 50, 10, 25, 0.4, 0.8)
    + thresholdScore(returnPct, 0.5, 3, 0.2, 0.6)
    + thresholdScore(tailNetRatio, 5, 12, 0.25, 0.5);
  score = Number(score.toFixed(2));

  let label = "中性 / 分歧观察";
  let tone: IntentAnalysis["tone"] = "neutral";
  if (volumeRatio20 !== null && volumeRatio20 >= 1.5 && Math.abs(returnPct) < 2 && Math.abs(activeNetRatio) < 5) {
    label = "高换手分歧";
  } else if (returnPct > 1 && activeNetRatio < -3 && largeNetRatio < -5) {
    label = "偏派发（代理）";
    tone = "down";
  } else if (returnPct < -2 && activeNetRatio > 3 && largeNetRatio > 3) {
    label = "偏洗盘 / 承接（代理）";
    tone = "up";
  } else if (score >= 2.4 && returnPct >= 1) {
    label = "偏主动拉升（代理）";
    tone = "up";
  } else if (score >= 1.2) {
    label = "偏吸筹 / 承接（代理）";
    tone = "up";
  } else if (score <= -2.4 && returnPct <= -1) {
    label = "偏主动压制（代理）";
    tone = "down";
  } else if (score <= -1.2) {
    label = "偏派发（代理）";
    tone = "down";
  }

  let dataConfidence = 30;
  if (dayRows.length >= 500) dataConfidence += 5;
  if (dailyCandles.length >= 20) dataConfidence += 5;
  if (!dataset.amountBasis.includes("代理")) dataConfidence += 10;
  if (dataset.quality.dailyContextCoverage >= 0.99) dataConfidence += 10;
  if (dataset.quality.sideCoverage >= 0.95) dataConfidence += 10;
  if (dayRows.some((row) => row.rawStatus !== "" && row.sequence > 0)) dataConfidence += 5;
  dataConfidence -= Math.min(10, Math.round(dataset.quality.duplicateRate * 100));
  dataConfidence = Math.min(68, Math.max(20, dataConfidence));
  const signalConfidence = Math.min(68, 35 + Math.abs(score) * 9);
  const confidence = Math.round(Math.min(dataConfidence, signalConfidence));

  const evidence = [
    `主动净比 ${signedPercent(activeNetRatio)}，金额 ${signedCompact(activeNetAmount)}`,
    `大额阈值 ${compactNumber(largeThreshold)}，大额净比 ${signedPercent(largeNetRatio)}`,
    `收盘相对VWAP ${signedPercent(closeVsVwapPct)}，日内位置 ${formatNumber(closeLocationPct, 1)}%`,
  ];
  if (candle.turnoverPct !== null) evidence.push(`换手率 ${formatNumber(candle.turnoverPct, 2)}%`);
  if (volumeRatio20 !== null) evidence.push(`成交量为近20日中位数的 ${formatNumber(volumeRatio20, 2)} 倍`);
  evidence.push(`尾盘主动净比 ${signedPercent(tailNetRatio)}`);

  const warnings = [...dataset.quality.warnings];
  warnings.push("尚未接入行业/大盘相对强度、盘口队列和逐笔委托撤单数据。");
  if (Math.abs(returnPct) >= 9.5) warnings.push("当日接近涨跌停，买卖性质容易受单边队列机制影响。");

  return {
    date,
    basis: "level1",
    label,
    tone,
    confidence,
    score,
    activeNetAmount,
    activeNetRatio,
    largeNetAmount,
    largeNetRatio,
    largeThreshold,
    closeVsVwapPct,
    closeLocationPct,
    turnoverPct: candle.turnoverPct,
    volumeRatio20,
    tailNetRatio,
    evidence,
    warnings,
  };
}

function analyzeDailyMarketIntent(
  dataset: ParsedDataset,
  dailyCandles: Candle[],
  dayIndex: number,
  candle: Candle,
  returnPct: number,
): IntentAnalysis {
  const priceRange = Math.max(candle.high - candle.low, candle.close * 0.001);
  const moneyFlowMultiplier = Math.max(-1, Math.min(1, ((2 * candle.close) - candle.high - candle.low) / priceRange));
  const activeNetRatio = moneyFlowMultiplier * 100;
  const activeNetAmount = candle.amount * moneyFlowMultiplier;
  const closeLocationPct = ((candle.close - candle.low) / priceRange) * 100;
  const closeVsVwapPct = candle.vwap ? ((candle.close / candle.vwap) - 1) * 100 : 0;
  const tailNetRatio = candle.open ? ((candle.close / candle.open) - 1) * 100 : 0;
  const priorVolumes = dailyCandles.slice(Math.max(0, dayIndex - 20), dayIndex).map((item) => item.volume);
  const medianVolume = median(priorVolumes);
  const volumeRatio20 = priorVolumes.length >= 5 && medianVolume > 0 ? candle.volume / medianVolume : null;
  const volumeWeight = volumeRatio20 == null ? 0.5 : Math.max(0.35, Math.min(1.25, volumeRatio20 / 1.5));
  const largeNetAmount = activeNetAmount * volumeWeight;
  const largeNetRatio = activeNetRatio * volumeWeight;

  let score = thresholdScore(activeNetRatio, 16, 42, 0.7, 1.25)
    + thresholdScore(closeVsVwapPct, 0.3, 1, 0.4, 0.8)
    + thresholdScore(closeLocationPct - 50, 12, 32, 0.35, 0.7)
    + thresholdScore(returnPct, 0.8, 3, 0.3, 0.65)
    + thresholdScore(tailNetRatio, 0.6, 2.5, 0.25, 0.45);
  if (volumeRatio20 != null && volumeRatio20 >= 1.2) score += Math.sign(activeNetRatio || returnPct) * Math.min(0.6, (volumeRatio20 - 1) * 0.4);
  score = Number(score.toFixed(2));

  let label = "量价中性 / 分歧";
  let tone: IntentAnalysis["tone"] = "neutral";
  if (volumeRatio20 != null && volumeRatio20 >= 1.6 && Math.abs(returnPct) < 1.2) {
    label = "放量换手 / 分歧";
  } else if (score >= 2.1) {
    label = returnPct >= 1 ? "偏拉升（量价代理）" : "偏承接（量价代理）";
    tone = "up";
  } else if (score >= 1) {
    label = "偏吸筹 / 承接（量价代理）";
    tone = "up";
  } else if (score <= -2.1) {
    label = returnPct <= -1 ? "偏压制（量价代理）" : "偏派发（量价代理）";
    tone = "down";
  } else if (score <= -1) {
    label = "偏派发（量价代理）";
    tone = "down";
  }

  const sampleConfidence = dailyCandles.length >= 60 ? 42 : dailyCandles.length >= 20 ? 36 : 28;
  const signalConfidence = 32 + Math.min(18, Math.abs(score) * 7);
  const confidence = Math.round(Math.min(54, sampleConfidence, signalConfidence));
  const evidence = [
    `日线资金强度 ${signedPercent(activeNetRatio)}，量价方向额 ${signedCompact(activeNetAmount)}`,
    `收盘相对VWAP ${signedPercent(closeVsVwapPct)}，日内收盘位置 ${formatNumber(closeLocationPct, 1)}%`,
    `收盘相对开盘 ${signedPercent(tailNetRatio)}，当日涨跌 ${signedPercent(returnPct)}`,
  ];
  if (volumeRatio20 !== null) evidence.push(`成交量为近20日中位数的 ${formatNumber(volumeRatio20, 2)} 倍`);

  return {
    date: candle.date,
    basis: "daily-price-volume",
    label,
    tone,
    confidence,
    score,
    activeNetAmount,
    activeNetRatio,
    largeNetAmount,
    largeNetRatio,
    largeThreshold: 0,
    closeVsVwapPct,
    closeLocationPct,
    turnoverPct: candle.turnoverPct,
    volumeRatio20,
    tailNetRatio,
    evidence,
    warnings: [
      ...dataset.quality.warnings,
      "当前使用日K OHLC、成交额和近20日量能构建量价代理，不含逐笔买卖方向、盘口队列或撤单数据。",
      "量价方向额是可解释估算值，不等于真实主力净流入，也不能识别机构账户。",
    ],
  };
}

function sumAmount(rows: TickRow[], side: string): number {
  return rows.reduce((sum, row) => sum + (row.status === side ? row.amount : 0), 0);
}

function percentile(values: number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function thresholdScore(value: number, low: number, high: number, lowWeight: number, highWeight: number): number {
  if (value >= high) return highWeight;
  if (value >= low) return lowWeight;
  if (value <= -high) return -highWeight;
  if (value <= -low) return -lowWeight;
  return 0;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function signedCompact(value: number): string {
  return `${value >= 0 ? "+" : "-"}${compactNumber(Math.abs(value))}`;
}

function candleBucket(row: TickRow, timeframe: Timeframe): { key: string; label: string; time: string } {
  if (timeframe === "1d") {
    return { key: row.date, label: row.date.slice(5), time: "" };
  }

  const interval = Number(timeframe.slice(0, -1));
  const [hour, minute] = row.time.split(":").map(Number);
  const minuteOfDay = hour * 60 + minute;
  let base = 0;
  if (minuteOfDay < 570) {
    base = 565;
  } else if (minuteOfDay <= 690) {
    base = 570;
  } else if (minuteOfDay < 780) {
    base = 690;
  } else if (minuteOfDay <= 900) {
    base = 780;
  } else {
    base = 900;
  }
  const bucketMinute = base + Math.floor(Math.max(0, minuteOfDay - base) / interval) * interval;
  const time = `${pad(Math.floor(bucketMinute / 60))}:${pad(bucketMinute % 60)}`;
  return {
    key: `${row.date} ${time}`,
    label: `${row.date.slice(5)} ${time}`,
    time,
  };
}

export function calculateIndicators(candles: Candle[]): IndicatorSet {
  const closes = candles.map((candle) => candle.close);
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdDif = closes.map((_, index) => ema12[index] - ema26[index]);
  const macdDea = ema(macdDif, 9);
  const macdHist = macdDif.map((value, index) => (value - macdDea[index]) * 2);
  const { upper: bollUpper, mid: bollMid, lower: bollLower } = boll(closes, 20, 2);
  const { k, d, j } = kdj(candles, 9);
  const rsi14 = rsi(closes, 14);
  const nineTurn = calculateNineTurn(candles);
  const atr14 = atr(candles, 14);
  const volumeMa5 = sma(candles.map((candle) => candle.volume), 5);
  const volumeMa10 = sma(candles.map((candle) => candle.volume), 10);
  const guidePoints = calculateGuidePoints(
    candles,
    { ma5, bollUpper, bollLower, macdHist, rsi: rsi14, k, d, nineTurn },
  );

  return {
    ma5,
    ma10,
    ma20,
    ema12,
    ema26,
    bollUpper,
    bollMid,
    bollLower,
    macdDif,
    macdDea,
    macdHist,
    rsi: rsi14,
    k,
    d,
    j,
    vwap: candles.map((candle) => candle.vwap),
    volumeMa5,
    volumeMa10,
    atr14,
    nineTurn,
    guidePoints,
  };
}

export function analyzeKlineConclusion(
  candles: Candle[],
  indicators: IndicatorSet,
  index: number,
): KlineConclusion | null {
  const candle = candles[index];
  if (!candle) return null;
  const ma5 = indicators.ma5[index];
  const ma10 = indicators.ma10[index];
  const ma20 = indicators.ma20[index];
  const rsiValue = indicators.rsi[index];
  const atrValue = indicators.atr14[index];
  const recent = candles.slice(Math.max(0, index - 19), index + 1);
  const support = Math.min(...recent.map((item) => item.low));
  const resistance = Math.max(...recent.map((item) => item.high));
  const volumeAverage = indicators.volumeMa10[index];
  const volumeRatio = volumeAverage ? candle.volume / volumeAverage : null;

  let trend = "均线尚未形成稳定结构";
  let trendScore = 0;
  if (ma5 !== null && ma10 !== null && ma20 !== null) {
    if (candle.close > ma5 && ma5 > ma10 && ma10 > ma20) {
      trend = "MA5/10/20 多头排列，价格位于短中期均线上方";
      trendScore = 2;
    } else if (candle.close < ma5 && ma5 < ma10 && ma10 < ma20) {
      trend = "MA5/10/20 空头排列，价格位于短中期均线下方";
      trendScore = -2;
    } else if (candle.close > ma20) {
      trend = "价格仍在 MA20 上方，但均线结构处于整理";
      trendScore = 0.5;
    } else {
      trend = "价格位于 MA20 下方，短线结构偏弱或震荡";
      trendScore = -0.5;
    }
  }

  const macdBullish = indicators.macdDif[index] >= indicators.macdDea[index];
  const kdjBullish = indicators.k[index] >= indicators.d[index];
  const momentumScore = (macdBullish ? 1 : -1) + (kdjBullish ? 0.5 : -0.5)
    + (rsiValue == null ? 0 : rsiValue >= 55 ? 0.5 : rsiValue <= 45 ? -0.5 : 0);
  const momentum = `MACD ${macdBullish ? "多方" : "空方"}、KDJ ${kdjBullish ? "金叉侧" : "死叉侧"}${rsiValue == null ? "" : `，RSI ${formatNumber(rsiValue, 1)}`}`;
  const volatility = atrValue == null
    ? "ATR 样本不足"
    : `ATR14 ${formatNumber(atrValue, 3)}（约占收盘 ${formatNumber((atrValue / candle.close) * 100, 2)}%）${volumeRatio == null ? "" : `，量能 ${formatNumber(volumeRatio, 2)} 倍于10期均量`}`;

  const currentGuide = indicators.guidePoints[index];
  let latestGuide = currentGuide;
  if (!latestGuide) {
    for (let offset = 1; offset <= 3 && index - offset >= 0; offset += 1) {
      if (indicators.guidePoints[index - offset]) {
        latestGuide = indicators.guidePoints[index - offset];
        break;
      }
    }
  }
  const nineTurn = indicators.nineTurn[index];
  const totalScore = trendScore + momentumScore + (latestGuide?.type === "buy" ? 1 : latestGuide?.type === "sell" ? -1 : 0);
  const tone: KlineConclusion["tone"] = totalScore >= 2 ? "up" : totalScore <= -2 ? "down" : "neutral";
  const label = tone === "up" ? "结构偏强" : tone === "down" ? "结构偏弱" : "震荡 / 信号分歧";

  const points = [trend, momentum, volatility];
  if (nineTurn) points.push(`神奇九转处于${nineTurn.direction === "buy" ? "下跌序列" : "上涨序列"}第 ${nineTurn.count} 阶段${nineTurn.completed ? "，已完成九转" : ""}`);
  if (latestGuide) points.push(`${latestGuide.type === "buy" ? "B买入" : "S卖出"}指引评分 ${latestGuide.score}：${latestGuide.reasons.join("、")}`);
  points.push(`近20期观察区间：支撑 ${formatNumber(support, 3)}，压力 ${formatNumber(resistance, 3)}`);

  return {
    label,
    tone,
    summary: `${label}；${trend}。${momentum}。`,
    trend,
    momentum,
    volatility,
    support,
    resistance,
    atr: atrValue,
    nineTurn,
    latestGuide,
    points,
  };
}

function sma(values: number[], period: number): Array<number | null> {
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= period) sum -= values[index - period];
    return index >= period - 1 ? sum / period : null;
  });
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const multiplier = 2 / (period + 1);
  const result = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result.push(values[index] * multiplier + result[index - 1] * (1 - multiplier));
  }
  return result;
}

function boll(values: number[], period: number, multiplier: number) {
  const mid = sma(values, period);
  const upper: Array<number | null> = [];
  const lower: Array<number | null> = [];
  for (let index = 0; index < values.length; index += 1) {
    if (index < period - 1 || mid[index] === null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const slice = values.slice(index - period + 1, index + 1);
    const mean = mid[index] as number;
    const deviation = Math.sqrt(slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period);
    upper.push(mean + multiplier * deviation);
    lower.push(mean - multiplier * deviation);
  }
  return { upper, mid, lower };
}

function rsi(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= period) return result;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let averageGain = gain / period;
  let averageLoss = loss / period;
  result[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period;
    result[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return result;
}

function kdj(candles: Candle[], period: number) {
  const k: number[] = [];
  const d: number[] = [];
  const j: number[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    const slice = candles.slice(Math.max(0, index - period + 1), index + 1);
    const low = Math.min(...slice.map((candle) => candle.low));
    const high = Math.max(...slice.map((candle) => candle.high));
    const rsv = high === low ? 50 : ((candles[index].close - low) / (high - low)) * 100;
    const currentK = ((index ? k[index - 1] : 50) * 2 + rsv) / 3;
    const currentD = ((index ? d[index - 1] : 50) * 2 + currentK) / 3;
    k.push(currentK);
    d.push(currentD);
    j.push(currentK * 3 - currentD * 2);
  }
  return { k, d, j };
}

function calculateNineTurn(candles: Candle[]): Array<NineTurnMark | null> {
  const result: Array<NineTurnMark | null> = Array(candles.length).fill(null);
  let risingCount = 0;
  let fallingCount = 0;
  for (let index = 4; index < candles.length; index += 1) {
    if (candles[index].close > candles[index - 4].close) {
      risingCount += 1;
      fallingCount = 0;
      result[index] = { count: risingCount, direction: "sell", completed: risingCount === 9 };
      if (risingCount === 9) risingCount = 0;
    } else if (candles[index].close < candles[index - 4].close) {
      fallingCount += 1;
      risingCount = 0;
      result[index] = { count: fallingCount, direction: "buy", completed: fallingCount === 9 };
      if (fallingCount === 9) fallingCount = 0;
    } else {
      risingCount = 0;
      fallingCount = 0;
    }
  }
  return result;
}

function atr(candles: Candle[], period: number): Array<number | null> {
  const trueRanges = candles.map((candle, index) => {
    const previousClose = index > 0 ? candles[index - 1].close : candle.open;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  return sma(trueRanges, period);
}

function calculateGuidePoints(
  candles: Candle[],
  values: {
    ma5: Array<number | null>;
    bollUpper: Array<number | null>;
    bollLower: Array<number | null>;
    macdHist: number[];
    rsi: Array<number | null>;
    k: number[];
    d: number[];
    nineTurn: Array<NineTurnMark | null>;
  },
): Array<GuidePoint | null> {
  const result: Array<GuidePoint | null> = Array(candles.length).fill(null);
  let lastSignalIndex = -10;
  for (let index = 1; index < candles.length; index += 1) {
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];
    let buyScore = 0;
    let sellScore = 0;
    const nine = values.nineTurn[index];
    if (nine?.completed && nine.direction === "buy") { buyScore += 3; buyReasons.push("下跌九转完成"); }
    if (nine?.completed && nine.direction === "sell") { sellScore += 3; sellReasons.push("上涨九转完成"); }
    if (values.macdHist[index - 1] <= 0 && values.macdHist[index] > 0) { buyScore += 1; buyReasons.push("MACD翻红"); }
    if (values.macdHist[index - 1] >= 0 && values.macdHist[index] < 0) { sellScore += 1; sellReasons.push("MACD翻绿"); }
    if (values.k[index - 1] <= values.d[index - 1] && values.k[index] > values.d[index] && values.k[index] < 45) { buyScore += 1; buyReasons.push("KDJ低位金叉"); }
    if (values.k[index - 1] >= values.d[index - 1] && values.k[index] < values.d[index] && values.k[index] > 55) { sellScore += 1; sellReasons.push("KDJ高位死叉"); }
    const currentRsi = values.rsi[index];
    const previousRsi = values.rsi[index - 1];
    if (currentRsi !== null && previousRsi !== null && previousRsi <= 35 && currentRsi > previousRsi) { buyScore += 1; buyReasons.push("RSI超卖回升"); }
    if (currentRsi !== null && previousRsi !== null && previousRsi >= 70 && currentRsi < previousRsi) { sellScore += 1; sellReasons.push("RSI超买回落"); }
    const ma5 = values.ma5[index];
    const previousMa5 = values.ma5[index - 1];
    if (ma5 !== null && previousMa5 !== null && candles[index - 1].close <= previousMa5 && candles[index].close > ma5) { buyScore += 1; buyReasons.push("站回MA5"); }
    if (ma5 !== null && previousMa5 !== null && candles[index - 1].close >= previousMa5 && candles[index].close < ma5) { sellScore += 1; sellReasons.push("跌破MA5"); }
    if (values.bollLower[index] !== null && candles[index].low <= (values.bollLower[index] as number) && candles[index].close > candles[index].open) { buyScore += 1; buyReasons.push("BOLL下轨承接"); }
    if (values.bollUpper[index] !== null && candles[index].high >= (values.bollUpper[index] as number) && candles[index].close < candles[index].open) { sellScore += 1; sellReasons.push("BOLL上轨受压"); }

    if (index - lastSignalIndex < 3) continue;
    if (buyScore >= 2 && buyScore > sellScore) {
      result[index] = { type: "buy", score: buyScore, reasons: buyReasons };
      lastSignalIndex = index;
    } else if (sellScore >= 2 && sellScore > buyScore) {
      result[index] = { type: "sell", score: sellScore, reasons: sellReasons };
      lastSignalIndex = index;
    }
  }
  return result;
}

export function createDemoDataset(): ParsedDataset {
  const rows: TickRow[] = [];
  const dailyContexts: Record<string, DailyContext> = {};
  let price = 10.18;
  let seed = 41;
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const start = new Date(2026, 4, 4);
  let businessDays = 0;
  for (let dayOffset = 0; businessDays < 42; dayOffset += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + dayOffset);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    businessDays += 1;
    const dateText = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    dailyContexts[dateText] = { date: dateText, adjustmentFactor: 1, listedAShares: 1_000_000_000, shareCapitalDate: "2026-01-01" };
    const intradayTimes = ["09:30:00", "10:00:00", "10:30:00", "11:00:00", "11:30:00", "13:00:00", "13:30:00", "14:00:00", "14:30:00", "15:00:00"];
    for (const [timeIndex, time] of intradayTimes.entries()) {
      price = Math.max(7, price + (random() - 0.47) * 0.16);
      const volume = Math.round(18000 + random() * 130000);
      const status = random() > 0.5 ? "买盘" : "卖盘";
      const roundedPrice = Number(price.toFixed(3));
      rows.push({
        date: dateText,
        time,
        code: "000001",
        price: roundedPrice,
        rawPrice: roundedPrice,
        volume,
        amount: roundedPrice * volume,
        adjustedAmount: roundedPrice * volume,
        status,
        rawStatus: status === "买盘" ? "0" : "1",
        sequence: timeIndex + 1,
        session: sessionFromTime(time),
        level: "演示数据",
        adjustmentFactor: 1,
        listedAShares: 1_000_000_000,
        shareCapitalDate: "2026-01-01",
      });
    }
  }
  const amountBasis = "原始成交价×成交量";
  const timePrecision = "分钟";
  return {
    rows,
    codes: ["000001"],
    stockNames: { "000001": "平安银行" },
    skipped: 0,
    dataLevel: "演示数据",
    dailyContexts,
    amountBasis,
    timePrecision,
    quality: calculateDataQuality(rows, dailyContexts, amountBasis, timePrecision),
    listedAShares: 1_000_000_000,
    shareCapitalDate: "2026-01-01",
    priceBasis: "不复权",
  };
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100_000_000) return `${formatNumber(value / 100_000_000, 2)}亿`;
  if (Math.abs(value) >= 10_000) return `${formatNumber(value / 10_000, 2)}万`;
  return formatNumber(value, 0);
}
