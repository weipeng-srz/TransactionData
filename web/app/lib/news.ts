import { parseCsvRecords } from "./csv.ts";
import { cnStockCodePattern, usStockSymbolPattern } from "./security.ts";

export type NewsSentiment = "正面" | "中性" | "负面";
export type NewsEventType = "财报与业绩" | "融资与资本动作" | "监管与诉讼" | "并购重组" | "产品与经营" | "分析师观点" | "其他事件";
export type NewsSourceQuality = "高" | "中" | "低";

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
  eventType?: NewsEventType;
  sourceQuality?: NewsSourceQuality;
  sourceQualityScore?: number;
  sourceQualityReason?: string;
  duplicateCount?: number;
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
    if (!(cnStockCodePattern.test(code) || usStockSymbolPattern.test(code)) || !title || !articleUrl || !sentiment) {
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
    const sourceQuality = classifySourceQuality(item.media, item.portal, item.url);
    item.eventType = classifyNewsEvent(`${item.title} ${item.summary}`);
    item.sourceQuality = sourceQuality.label;
    item.sourceQualityScore = sourceQuality.score;
    item.sourceQualityReason = sourceQuality.reason;
    item.duplicateCount = 1;
    items.push(item);
    codes.add(code);
    if (stockName) stockNames[code] = stockName;
    if (portal) portal.split("；").forEach((name) => portals.add(name));
  }

  items.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  const groupedItems = groupRelatedNews(items);
  const positive = groupedItems.filter((item) => item.sentiment === "正面").length;
  const neutral = groupedItems.filter((item) => item.sentiment === "中性").length;
  const negative = groupedItems.filter((item) => item.sentiment === "负面").length;
  const averageScore = groupedItems.length
    ? groupedItems.reduce((sum, item) => sum + item.sentimentScore, 0) / groupedItems.length
    : 0;
  const tone: NewsSentiment = averageScore >= 0.15 ? "正面" : averageScore <= -0.15 ? "负面" : "中性";

  return {
    items: groupedItems,
    codes: [...codes].sort(),
    stockNames,
    skipped,
    summary: {
      total: groupedItems.length,
      positive,
      neutral,
      negative,
      averageScore,
      tone,
      portals: portals.size,
      latestAt: groupedItems[0]?.publishedAt ?? "",
    },
  };
}

function classifyNewsEvent(value: string): NewsEventType {
  const text = value.toLowerCase();
  if (/财报|财季|业绩|营收|净利润|预增|预减|earnings|revenue|guidance/.test(text)) return "财报与业绩";
  if (/回购|增持|减持|分红|派息|发行|融资|定增|可转债|buyback|dividend|offering/.test(text)) return "融资与资本动作";
  if (/监管|调查|处罚|诉讼|仲裁|问询|警示函|召回|antitrust|lawsuit|probe|regulat/.test(text)) return "监管与诉讼";
  if (/并购|收购|重组|合并|要约|acquisition|merger|takeover/.test(text)) return "并购重组";
  if (/中标|订单|获批|发布|推出|产能|产品|合作|签约|launch|approval|contract/.test(text)) return "产品与经营";
  if (/评级|目标价|研报|分析师|上调|下调|upgrade|downgrade|price target|analyst/.test(text)) return "分析师观点";
  return "其他事件";
}

function classifySourceQuality(media: string, portal: string, value: string): { label: NewsSourceQuality; score: number; reason: string } {
  const source = `${media} ${portal}`.toLowerCase();
  let host = "";
  try { host = new URL(value).hostname.toLowerCase(); } catch { /* Invalid URLs are rejected before this point. */ }
  if (
    /公告|交易所|证券时报|上海证券报|中国证券报|sec|公司官网/.test(source)
    || /(?:^|\.)(?:sec\.gov|cninfo\.com\.cn|sse\.com\.cn|szse\.cn)$/.test(host)
  ) return { label: "高", score: 1, reason: "监管披露、公司原始信息或主流证券媒体" };
  if (/新浪|东方财富|财联社|路透|彭博|华尔街日报|央视|中新|证券/.test(source)) return { label: "中", score: 0.75, reason: "具名财经或综合媒体" };
  return { label: "低", score: 0.45, reason: "来源身份或原始出处不足" };
}

function groupRelatedNews(items: NewsItem[]): NewsItem[] {
  const groups: NewsItem[] = [];
  for (const item of items) {
    const date = item.publishedAt.slice(0, 10);
    const titleKey = normalizedNewsTitle(item.title, item.stockName);
    const existingIndex = groups.findIndex((candidate) => (
      candidate.code === item.code
      && candidate.publishedAt.slice(0, 10) === date
      && candidate.eventType === item.eventType
      && titleSimilarity(normalizedNewsTitle(candidate.title, candidate.stockName), titleKey) >= 0.82
    ));
    if (existingIndex < 0) {
      groups.push(item);
      continue;
    }
    const existing = groups[existingIndex];
    const duplicateCount = (existing.duplicateCount ?? 1) + 1;
    if ((item.sourceQualityScore ?? 0) > (existing.sourceQualityScore ?? 0)) groups[existingIndex] = { ...item, duplicateCount };
    else existing.duplicateCount = duplicateCount;
  }
  return groups;
}

function normalizedNewsTitle(title: string, stockName: string): string {
  return title.normalize("NFKC").toLowerCase().replaceAll(stockName.toLowerCase(), "").replace(/[\s\p{P}\p{S}]/gu, "");
}

function titleSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (Math.min(left.length, right.length) >= 8 && (left.includes(right) || right.includes(left))) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const grams = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2)));
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / (a.size + b.size - intersection);
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
