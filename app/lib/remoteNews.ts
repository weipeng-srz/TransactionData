import { lookupStock } from "./stockLookup.ts";

const endpointBase = "https://search.sina.com.cn/api/news";
const maxResponseBytes = 4 * 1024 * 1024;

type WeightedTerm = { term: string; weight: number };
const positive: WeightedTerm[] = [
  ["超预期", 2], ["创新高", 1.8], ["大幅增长", 1.8], ["业绩预增", 1.8], ["扭亏为盈", 1.8], ["增持", 1.4], ["回购", 1.4],
  ["中标", 1.4], ["获批", 1.4], ["分红", 1.2], ["上涨", 1.2], ["增长", 1], ["盈利", 1], ["突破", 1], ["改善", 1], ["利好", 1.5],
].map(([term, weight]) => ({ term: String(term), weight: Number(weight) }));
const negative: WeightedTerm[] = [
  ["立案调查", 2], ["涉嫌违法", 2], ["重大亏损", 2], ["业绩预减", 1.8], ["退市风险", 2], ["警示函", 1.6], ["问询函", 1.3],
  ["处罚", 1.6], ["违规", 1.5], ["违约", 1.6], ["跌停", 1.6], ["下跌", 1.2], ["亏损", 1.3], ["减持", 1.2], ["终止", 1], ["诉讼", 1.2], ["风险", 0.7],
].map(([term, weight]) => ({ term: String(term), weight: Number(weight) }));

export function normalizeRemoteNewsRequest(value: unknown): { code: string; limit: number } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const input = value as { code?: unknown; limit?: unknown; name?: unknown };
  const code = String(input.code ?? "").trim().replace(/^(?:sh|sz)/i, "").replace(/\.(?:sh|sz)$/i, "");
  const limit = input.limit == null ? 30 : Number(input.limit);
  if (!/^\d{6}$/.test(code)) throw new Error("请输入有效的 6 位沪深股票代码");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("新闻数量必须在 1 到 100 之间");
  return { code, limit };
}

export async function fetchRemoteNewsCsv(code: string, limit: number): Promise<string> {
  let name = code;
  try { name = (await lookupStock(code)).name; } catch { /* use code */ }
  const endpoint = new URL(endpointBase);
  endpoint.searchParams.set("q", name);
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", Referer: "https://search.sina.com.cn/", "User-Agent": "Mozilla/5.0 (compatible; TickLens/2.0)" },
    signal: AbortSignal.timeout(14_000),
  });
  if (!response.ok) throw new Error(`新闻服务请求失败：HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > maxResponseBytes) throw new Error("新闻响应超过安全上限");
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { throw new Error("新闻服务返回了异常内容"); }
  const items = (payload as { data?: { list?: unknown } } | null)?.data?.list;
  const fetchedAt = formatChinaTime(Date.now());
  const seen = new Set<string>();
  const rows = (Array.isArray(items) ? items : []).flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const title = cleanText(String(item.title ?? ""));
    const summary = cleanText(String(item.searchSummary ?? item.intro ?? ""));
    const url = safeUrl(String(item.url ?? ""));
    const folded = title.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
    if (!title || !url || seen.has(folded) || (!title.includes(name) && !summary.includes(name))) return [];
    seen.add(folded);
    const sentiment = analyzeSentiment(title, summary);
    const publishedAt = Number(item.ctime) > 0 ? formatChinaTime(Number(item.ctime) * 1000) : "";
    return [[
      code, name, "新浪搜索", "新闻/财经", cleanText(String(item.media_show ?? "新浪")), publishedAt, title.includes(name) ? "1.00" : "0.85",
      sentiment.label, sentiment.score.toFixed(3), sentiment.positiveTerms.join("；"), sentiment.negativeTerms.join("；"), title, summary, url, fetchedAt,
    ]];
  }).slice(0, limit);
  const header = ["股票代码", "股票名称", "检索入口", "频道", "媒体来源", "发布时间", "相关性得分", "情绪倾向", "情绪得分", "正向词", "负向词", "新闻标题", "新闻摘要", "原文链接", "采集时间"];
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}`;
}

function analyzeSentiment(title: string, summary: string) {
  const scoreTerms = (terms: WeightedTerm[]) => terms.reduce((result, item) => {
    const count = countOf(title, item.term) * 2 + countOf(summary, item.term);
    if (count) { result.score += count * item.weight; result.terms.push(item.term); }
    return result;
  }, { score: 0, terms: [] as string[] });
  const up = scoreTerms(positive);
  const down = scoreTerms(negative);
  const total = up.score + down.score;
  const score = total ? Math.max(-1, Math.min(1, (up.score - down.score) / total)) : 0;
  return { label: score >= 0.2 ? "正面" : score <= -0.2 ? "负面" : "中性", score, positiveTerms: up.terms.sort(), negativeTerms: down.terms.sort() };
}

function countOf(value: string, term: string): number { return value.split(term).length - 1; }
function cleanText(value: string): string { return value.replace(/<[^>]*>/g, "").replaceAll("&nbsp;", " ").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replace(/\s+/g, " ").trim(); }
function safeUrl(value: string): string { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : ""; } catch { return ""; } }
function formatChinaTime(value: number): string { return new Date(value).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false }).replace("T", " "); }
function csvCell(value: string): string { const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; return `"${safe.replaceAll('"', '""')}"`; }
