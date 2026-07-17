import { parseCsvRecords } from "./csv.ts";

export type NewsSentiment = "正面" | "中性" | "负面";

export type NewsItem = {
  code: string;
  stockName: string;
  portal: string;
  channel: string;
  media: string;
  publishedAt: string;
  relevance: number;
  sentiment: NewsSentiment;
  sentimentScore: number;
  positiveTerms: string[];
  negativeTerms: string[];
  title: string;
  summary: string;
  url: string;
  fetchedAt: string;
};

export type NewsSummary = {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  averageScore: number;
  tone: NewsSentiment;
  portals: number;
  latestAt: string;
};

export type ParsedNewsDataset = {
  items: NewsItem[];
  codes: string[];
  stockNames: Record<string, string>;
  skipped: number;
  summary: NewsSummary;
};

const requiredHeaders = ["股票代码", "情绪倾向", "新闻标题", "原文链接"];

export function emptyNewsDataset(): ParsedNewsDataset {
  return {
    items: [],
    codes: [],
    stockNames: {},
    skipped: 0,
    summary: {
      total: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      averageScore: 0,
      tone: "中性",
      portals: 0,
      latestAt: "",
    },
  };
}

export function looksLikeNewsCsv(content: string): boolean {
  const firstRecord = parseCsvRecords(content.replace(/^\uFEFF/, ""))[0] ?? [];
  return firstRecord.includes("新闻标题") && firstRecord.includes("情绪倾向");
}

export function parseNewsCsv(content: string): ParsedNewsDataset {
  const records = parseCsvRecords(content.replace(/^\uFEFF/, ""));
  if (records.length === 0) throw new Error("新闻 CSV 是空文件");
  const headers = records[0].map((value) => value.trim());
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) throw new Error(`新闻 CSV 缺少字段：${missing.join("、")}`);

  const index = new Map(headers.map((header, position) => [header, position]));
  const value = (record: string[], header: string) => cleanCell(record[index.get(header) ?? -1] ?? "");
  const items: NewsItem[] = [];
  const codes = new Set<string>();
  const portals = new Set<string>();
  const stockNames: Record<string, string> = {};
  let skipped = 0;

  for (const record of records.slice(1)) {
    if (record.length === 1 && record[0].trim() === "") continue;
    const code = value(record, "股票代码");
    const title = value(record, "新闻标题");
    const articleUrl = safeArticleUrl(value(record, "原文链接"));
    const sentiment = normalizeSentiment(value(record, "情绪倾向"));
    if (!/^\d{6}$/.test(code) || !title || !articleUrl || !sentiment) {
      skipped += 1;
      continue;
    }
    const stockName = value(record, "股票名称");
    const portal = value(record, "检索入口");
    const score = clampNumber(value(record, "情绪得分"), -1, 1, 0);
    const item: NewsItem = {
      code,
      stockName,
      portal,
      channel: value(record, "频道"),
      media: value(record, "媒体来源"),
      publishedAt: value(record, "发布时间"),
      relevance: clampNumber(value(record, "相关性得分"), 0, 1, 0),
      sentiment,
      sentimentScore: score,
      positiveTerms: splitTerms(value(record, "正向词")),
      negativeTerms: splitTerms(value(record, "负向词")),
      title,
      summary: value(record, "新闻摘要"),
      url: articleUrl,
      fetchedAt: value(record, "采集时间"),
    };
    items.push(item);
    codes.add(code);
    if (stockName) stockNames[code] = stockName;
    if (portal) portal.split("；").forEach((name) => portals.add(name));
  }

  items.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  const positive = items.filter((item) => item.sentiment === "正面").length;
  const neutral = items.filter((item) => item.sentiment === "中性").length;
  const negative = items.filter((item) => item.sentiment === "负面").length;
  const averageScore = items.length
    ? items.reduce((sum, item) => sum + item.sentimentScore, 0) / items.length
    : 0;
  const tone: NewsSentiment = averageScore >= 0.15 ? "正面" : averageScore <= -0.15 ? "负面" : "中性";

  return {
    items,
    codes: [...codes].sort(),
    stockNames,
    skipped,
    summary: {
      total: items.length,
      positive,
      neutral,
      negative,
      averageScore,
      tone,
      portals: portals.size,
      latestAt: items[0]?.publishedAt ?? "",
    },
  };
}

function normalizeSentiment(value: string): NewsSentiment | null {
  if (value === "正面" || value === "中性" || value === "负面") return value;
  return null;
}

function cleanCell(value: string): string {
  const cleaned = value.trim();
  return /^'[=+\-@]/.test(cleaned) ? cleaned.slice(1) : cleaned;
}

function splitTerms(value: string): string[] {
  return value.split(/[；;,]/).map((term) => term.trim()).filter(Boolean).slice(0, 12);
}

function clampNumber(value: string, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function safeArticleUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}
