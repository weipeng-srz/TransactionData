import { isUSStockSymbol, normalizeUSSymbol } from "./security.ts";
import { lookupUSStock } from "./usStockLookup.ts";

const newsEndpoint = "https://search.sina.com.cn/api/news";
const maxResponseBytes = 4 * 1024 * 1024;
type WeightedTerm = { term: string; weight: number };
type EntityProfile = {
  ambiguousAliases: string[];
  strongAliases: string[];
  excludedContexts: string[];
};

const companyContexts = [
  "公司", "股价", "股票", "美股", "纳斯达克", "纽交所", "财报", "财季", "营收", "净利润", "市值", "投资者", "分析师", "评级", "目标价",
  "盘前", "盘后", "交易", "证券", "股份", "董事会", "高管", "首席执行官", "回购", "分红", "反垄断", "监管", "发布", "推出",
  "company", "corporation", "earnings", "shares", "stock", "nasdaq", "nyse", "revenue", "profit", "investor", "analyst", "rating", "price target",
  "chief executive", "ceo", "buyback", "dividend", "antitrust",
];

const entityProfiles: Record<string, EntityProfile> = {
  AAPL: {
    ambiguousAliases: ["苹果", "apple"],
    strongAliases: [
      "苹果公司", "apple inc", "apple computer", "苹果手机", "iphone", "ipad", "macbook", "apple watch", "airpods", "vision pro", "app store",
      "ios", "macos", "蒂姆库克", "蒂姆·库克", "tim cook",
    ],
    excludedContexts: [
      "水果", "果农", "果园", "果树", "苹果树", "果汁", "苹果汁", "果肉", "果品", "农产品", "种植", "采摘", "冷藏", "冰箱", "红富士",
      "期货", "食谱", "菜谱", "猪排", "apple fruit", "apple orchard", "apple juice", "apple cider", "apple pie", "apple recipe", "apple futures",
    ],
  },
};
const positive: WeightedTerm[] = toTerms([
  ["超预期", 2], ["增长", 1], ["回购", 1.4], ["分红", 1.2], ["获批", 1.4], ["创新高", 1.8],
  ["beat", 2], ["growth", 1], ["record", 1.3], ["upgrade", 1.5], ["buyback", 1.4], ["dividend", 1.2], ["profit", 1], ["approval", 1.4], ["rally", 1.2],
]);
const negative: WeightedTerm[] = toTerms([
  ["亏损", 1.4], ["调查", 1.5], ["诉讼", 1.3], ["下跌", 1.2], ["裁员", 1.3], ["处罚", 1.6],
  ["miss", 1.8], ["downgrade", 1.5], ["lawsuit", 1.4], ["probe", 1.5], ["recall", 1.4], ["decline", 1.1], ["loss", 1.3], ["antitrust", 1.4], ["layoff", 1.3],
]);

export function normalizeUSNewsRequest(value: unknown): { code: string; limit: number } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const input = value as { code?: unknown; limit?: unknown };
  const code = normalizeUSSymbol(input.code);
  const limit = input.limit == null ? 30 : Number(input.limit);
  if (!isUSStockSymbol(code)) throw new Error("请输入有效的美股代码，例如 AAPL 或 BRK.B");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("新闻数量必须在 1 到 100 之间");
  return { code, limit };
}

export async function fetchUSNewsCsv(code: string, limit: number): Promise<string> {
  const request = normalizeUSNewsRequest({ code, limit });
  const identity = await lookupUSStock(request.code).catch(() => ({ code: request.code, name: request.code, market: "US" as const, currency: "USD" as const }));
  const endpoint = new URL(newsEndpoint);
  endpoint.searchParams.set("q", buildNewsSearchQuery(request.code, identity.name));
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", Referer: "https://search.sina.com.cn/", "User-Agent": "Mozilla/5.0 (compatible; TrendSight/2.0)" },
    signal: AbortSignal.timeout(14_000),
  });
  if (!response.ok) throw new Error(`美股新闻服务请求失败：HTTP ${response.status}`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxResponseBytes) throw new Error("美股新闻响应超过安全上限");
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { throw new Error("美股新闻服务返回了异常内容"); }
  const items = (payload as { data?: { list?: unknown } } | null)?.data?.list;
  const fetchedAt = formatNewYorkTime(Date.now());
  const seenTitles = new Set<string>();
  const seenUrls = new Set<string>();
  const rows = (Array.isArray(items) ? items : []).flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const title = cleanText(String(item.title ?? ""));
    const summary = cleanText(String(item.searchSummary ?? item.intro ?? ""));
    const url = safeUrl(String(item.url ?? ""));
    const titleKey = normalizeTitleKey(title);
    const urlKey = normalizeArticleUrl(url);
    const relevance = matchEntityRelevance(request.code, identity.name, title, summary);
    if (!title || !url || !relevance || seenTitles.has(titleKey) || seenUrls.has(urlKey)) return [];
    seenTitles.add(titleKey);
    seenUrls.add(urlKey);
    const sentiment = analyzeSentiment(title, summary);
    const publishedAt = Number(item.ctime) > 0 ? formatNewYorkTime(Number(item.ctime) * 1000) : "";
    return [[
      request.code, identity.name, "新浪搜索", "美股/财经", cleanText(String(item.media_show ?? "新浪")), publishedAt,
      relevance.toFixed(2),
      sentiment.label, sentiment.score.toFixed(3), sentiment.positiveTerms.join("；"), sentiment.negativeTerms.join("；"), title, summary, url, fetchedAt,
    ]];
  }).slice(0, request.limit);
  const header = ["股票代码", "股票名称", "检索入口", "频道", "媒体来源", "发布时间", "相关性得分", "情绪倾向", "情绪得分", "正向词", "负向词", "新闻标题", "新闻摘要", "原文链接", "采集时间"];
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}`;
}

function buildNewsSearchQuery(code: string, name: string): string {
  if (name === code) return code;
  const profile = entityProfiles[code];
  const normalizedName = normalizeMatchText(name);
  const ambiguous = profile?.ambiguousAliases.some((alias) => containsEntityTerm(normalizedName, alias));
  return ambiguous ? `${code} ${name}公司` : `${code} ${name}`;
}

function matchEntityRelevance(code: string, name: string, title: string, summary: string): number | null {
  const titleText = normalizeMatchText(title);
  const summaryText = normalizeMatchText(summary);
  if (containsTicker(titleText, code)) return 1;
  if (containsTicker(summaryText, code)) return 0.94;

  const profile = entityProfiles[code];
  if (profile) {
    if (profile.strongAliases.some((alias) => containsEntityTerm(titleText, alias))) return 0.99;
    if (profile.strongAliases.some((alias) => containsEntityTerm(summaryText, alias))) return 0.92;

    const aliasInTitle = profile.ambiguousAliases.some((alias) => containsEntityTerm(titleText, alias));
    const aliasInSummary = profile.ambiguousAliases.some((alias) => containsEntityTerm(summaryText, alias));
    const combinedText = `${titleText} ${summaryText}`;
    const excluded = profile.excludedContexts.some((term) => containsEntityTerm(combinedText, term));
    const companyContext = companyContexts.some((term) => containsEntityTerm(combinedText, term));
    if (excluded || !companyContext) return null;
    if (aliasInTitle) return 0.95;
    if (aliasInSummary) return 0.88;
    return null;
  }

  const normalizedName = normalizeMatchText(name);
  if (normalizedName.length <= 1 || normalizedName === normalizeMatchText(code)) return null;
  if (containsEntityTerm(titleText, normalizedName)) return 0.96;
  if (containsEntityTerm(summaryText, normalizedName)) return 0.86;
  return null;
}

function normalizeMatchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function containsTicker(value: string, code: string): boolean {
  const escaped = normalizeMatchText(code).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(value);
}

function containsEntityTerm(value: string, term: string): boolean {
  const normalizedTerm = normalizeMatchText(term);
  if (!normalizedTerm) return false;
  if (/^[a-z0-9][a-z0-9 .&-]*$/i.test(normalizedTerm)) {
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(value);
  }
  return value.includes(normalizedTerm);
}

function normalizeTitleKey(value: string): string {
  return normalizeMatchText(value).replace(/[\s\p{P}\p{S}]/gu, "");
}

function normalizeArticleUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_.+|from|source|spm|ref)$/i.test(key)) url.searchParams.delete(key);
    });
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value;
  }
}

function analyzeSentiment(title: string, summary: string) {
  const textTitle = title.toLowerCase();
  const textSummary = summary.toLowerCase();
  const scoreTerms = (terms: WeightedTerm[]) => terms.reduce((result, item) => {
    const count = countOf(textTitle, item.term) * 2 + countOf(textSummary, item.term);
    if (count) { result.score += count * item.weight; result.terms.push(item.term); }
    return result;
  }, { score: 0, terms: [] as string[] });
  const up = scoreTerms(positive);
  const down = scoreTerms(negative);
  const total = up.score + down.score;
  const score = total ? Math.max(-1, Math.min(1, (up.score - down.score) / total)) : 0;
  return { label: score >= 0.2 ? "正面" : score <= -0.2 ? "负面" : "中性", score, positiveTerms: up.terms.sort(), negativeTerms: down.terms.sort() };
}

function toTerms(items: Array<[string, number]>): WeightedTerm[] { return items.map(([term, weight]) => ({ term: term.toLowerCase(), weight })); }
function countOf(value: string, term: string): number { return value.split(term).length - 1; }
function cleanText(value: string): string { return value.replace(/<[^>]*>/g, "").replaceAll("&nbsp;", " ").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replace(/\s+/g, " ").trim(); }
function safeUrl(value: string): string { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : ""; } catch { return ""; } }
function formatNewYorkTime(value: number): string { return new Date(value).toLocaleString("sv-SE", { timeZone: "America/New_York", hour12: false }).replace("T", " "); }
function csvCell(value: string): string { const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; return `"${safe.replaceAll('"', '""')}"`; }
