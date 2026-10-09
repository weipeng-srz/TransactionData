import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPortfolioSignalAvailability,
  buildPortfolioWorkbenchDigest,
  selectPortfolioDiscoveryIdeas,
} from "../app/lib/portfolioWorkbench.ts";

const cnStock = { code: "600519", name: "贵州茅台", addedAt: "2026-08-25T00:00:00.000Z" };
const bankStock = { code: "000001", name: "平安银行", addedAt: "2026-08-25T00:00:00.000Z" };
const batteryStock = { code: "300750", name: "宁德时代", addedAt: "2026-08-25T00:00:00.000Z" };
const usStock = { code: "AAPL", name: "Apple", market: "US", currency: "USD", addedAt: "2026-08-25T00:00:00.000Z" };

function score(tone, value) {
  return {
    score: value,
    coverage: 82,
    signal: { tone, action: "测试", headline: tone === "buy" ? "多维证据偏强" : "风险证据偏多", description: "测试" },
    dimensions: [],
  };
}

function prediction(action, tone = "risk", confidence = 70) {
  return {
    signal: { decisionConfidence: confidence },
    prediction: { upProbability: tone === "positive" ? .64 : .41 },
    decisionSupport: {
      action,
      tone,
      summary: `${action}测试结论`,
      referencePrice: 100,
      riskReference: 94,
      takeProfitReference: 108,
    },
  };
}

function quote(overrides = {}) {
  return {
    status: "ready",
    partial: false,
    price: 100,
    change: -2,
    changePct: -2,
    date: "2026-08-25",
    time: "15:00:00",
    score: null,
    prediction: prediction("持有观察", "neutral"),
    technicalSignal: null,
    newsItems: [],
    newsStatus: "ready",
    newsError: "",
    ...overrides,
  };
}

function equalWeightHoldings() {
  return {
    "600519": { code: "600519", shares: 10, cost: 100, updatedAt: "2026-08-25T00:00:00.000Z" },
    "000001": { code: "000001", shares: 10, cost: 100, updatedAt: "2026-08-25T00:00:00.000Z" },
    "300750": { code: "300750", shares: 10, cost: 100, updatedAt: "2026-08-25T00:00:00.000Z" },
  };
}

test("puts concentration risk ahead of single-day model actions", (context) => {
  context.mock.method(Date, "now", () => Date.parse("2026-08-25T08:00:00.000Z"));
  const holdings = {
    "600519": { code: "600519", shares: 10, cost: 110, updatedAt: "2026-08-25T00:00:00.000Z" },
  };
  const digest = buildPortfolioWorkbenchDigest([cnStock], holdings, {
    "600519": quote({ score: score("sell", 34), prediction: prediction("收紧止损") }),
  });

  assert.equal(digest.totals.positioned, 1);
  assert.equal(digest.actions[0].action, "集中度复核");
  assert.equal(digest.actions[0].source, "组合风控");
  assert.equal(digest.actions[0].referencePrice, null);
  assert.match(digest.actions[0].reason, /100\.0%/);
  assert.ok(digest.actions[0].secondaryReasons.some((reason) => reason.includes("止损候选")));
});

test("summarizes gated model candidates, technical triggers, evidence and news", (context) => {
  context.mock.method(Date, "now", () => Date.parse("2026-08-25T08:00:00.000Z"));
  const news = [{
    title: "公司收到监管问询",
    summary: "风险事件",
    url: "https://example.com/risk",
    media: "交易所公告",
    portal: "公告",
    publishedAt: "2026-08-25 10:00:00",
    sentiment: "负面",
    eventType: "监管与诉讼",
    sourceQuality: "高",
  }];
  const quotes = {
    "600519": quote({
      score: score("sell", 34),
      prediction: prediction("收紧止损"),
      technicalSignal: { side: "B", date: "2026-08-25", price: 99, score: 4, reasons: ["放量突破"] },
      newsItems: news,
    }),
    "000001": quote({ change: 3, changePct: 3, score: score("buy", 79), prediction: prediction("持有观察", "positive", 74) }),
    "300750": quote(),
  };

  const digest = buildPortfolioWorkbenchDigest([cnStock, bankStock, batteryStock], equalWeightHoldings(), quotes);
  assert.deepEqual(digest.actions.map((item) => item.action), ["止损候选", "加仓条件复核", "继续观察"]);
  assert.equal(digest.actionableCount, 2);
  assert.equal(digest.observeCount, 1);
  assert.equal(digest.technicalSignalCount, 1);
  assert.equal(digest.evidenceSignalCount, 2);
  assert.equal(digest.bsSignals.find((item) => item.kind === "technical")?.occurredAt, "2026-08-25");
  assert.equal(digest.signalConflictCount, 1);
  assert.equal(digest.holdingConflictCount, 1);
  assert.match(digest.conflicts[0].summary, /技术 B 点/);
  assert.equal(digest.negativeNewsCount, 1);
  assert.equal(digest.attentionNews[0].eventType, "监管与诉讼");
});

test("gates low-confidence actions and failed news as data review", (context) => {
  context.mock.method(Date, "now", () => Date.parse("2026-08-25T08:00:00.000Z"));
  const quotes = {
    "600519": quote({ prediction: prediction("收紧止损", "risk", 54) }),
    "000001": quote({ score: score("buy", 78), prediction: prediction("持有观察", "positive", 74), newsStatus: "error", newsError: "消息面获取失败" }),
    "300750": quote({ partial: true }),
  };
  const digest = buildPortfolioWorkbenchDigest([cnStock, bankStock, batteryStock], equalWeightHoldings(), quotes);

  assert.equal(digest.actions.find((item) => item.code === "600519")?.action, "数据待核验");
  assert.match(digest.actions.find((item) => item.code === "600519")?.reason ?? "", /54\/100.*65\/100/);
  assert.equal(digest.actions.find((item) => item.code === "000001")?.action, "数据待核验");
  assert.equal(digest.actions.find((item) => item.code === "300750")?.action, "数据待核验");
  assert.equal(digest.newsCoverage.ready, 2);
  assert.equal(digest.newsCoverage.failed, 1);
  assert.deepEqual(digest.newsCoverage.failedKeys, ["000001"]);
});

test("gates a low-confidence hold conclusion instead of hiding it as continue observing", (context) => {
  context.mock.method(Date, "now", () => Date.parse("2026-08-25T08:00:00.000Z"));
  const quotes = {
    "600519": quote({ prediction: prediction("持有观察", "neutral", 40) }),
    "000001": quote(),
    "300750": quote(),
  };
  const digest = buildPortfolioWorkbenchDigest([cnStock, bankStock, batteryStock], equalWeightHoldings(), quotes);
  const action = digest.actions.find((item) => item.code === "600519");

  assert.equal(action?.action, "数据待核验");
  assert.equal(action?.actionable, true);
  assert.match(action?.reason ?? "", /持有观察.*40\/100/);
});

test("gates a ready but stale same-market quote and exposes its own quote date", () => {
  const digest = buildPortfolioWorkbenchDigest([cnStock, bankStock, batteryStock], equalWeightHoldings(), {
    "600519": quote({ date: "2026-01-01", prediction: prediction("收紧止损", "risk", 80) }),
    "000001": quote({ date: "2026-08-25" }),
    "300750": quote({ date: "2026-08-25" }),
  });
  const action = digest.actions.find((item) => item.code === "600519");

  assert.equal(action?.action, "数据待核验");
  assert.equal(action?.quoteDate, "2026-01-01");
  assert.match(action?.reason ?? "", /落后同市场最新时点 2026-08-25/);
});

test("reports partial quote coverage without treating pending or failed data as ready", () => {
  const digest = buildPortfolioWorkbenchDigest([cnStock, bankStock, batteryStock, usStock], {}, {
    "600519": quote({ date: "2026-08-25", time: "15:00:00" }),
    "000001": quote({ partial: true, date: "2026-08-22", time: "15:00:00" }),
    "300750": quote({ status: "loading", date: "", time: "", newsStatus: "loading" }),
    "US:AAPL": quote({ status: "error", price: null, date: "", time: "", newsStatus: "error" }),
  });

  assert.deepEqual(
    { ready: digest.quoteCoverage.ready, partial: digest.quoteCoverage.partial, loading: digest.quoteCoverage.loading, failed: digest.quoteCoverage.failed, lagging: digest.quoteCoverage.lagging },
    { ready: 1, partial: 1, loading: 1, failed: 1, lagging: 1 },
  );
  assert.equal(digest.quoteCoverage.latestUpdate, "2026-08-25 15:00:00");
});

test("counts explicit idle quotes as pending coverage", () => {
  const digest = buildPortfolioWorkbenchDigest([cnStock], {}, {
    "600519": quote({ status: "idle", date: "", time: "", newsStatus: "idle" }),
  });

  assert.deepEqual(
    { tracked: digest.quoteCoverage.tracked, ready: digest.quoteCoverage.ready, partial: digest.quoteCoverage.partial, loading: digest.quoteCoverage.loading, failed: digest.quoteCoverage.failed },
    { tracked: 1, ready: 0, partial: 0, loading: 1, failed: 0 },
  );
});

test("keeps shared news associated with each stock and removes stale items", () => {
  const shared = {
    title: "产业链联合公告",
    summary: "同一新闻关联多只股票",
    url: "https://example.com/shared",
    media: "公告",
    portal: "公告",
    sentiment: "中性",
    eventType: "业务动态",
    sourceQuality: "高",
  };
  const stale = { ...shared, title: "过期新闻", url: "https://example.com/old", publishedAt: "2026-07-01 09:00:00" };
  const recent = { ...shared, publishedAt: "2026-08-25 09:00:00" };
  const digest = buildPortfolioWorkbenchDigest([cnStock, bankStock], {}, {
    "600519": quote({ newsItems: [recent, stale] }),
    "000001": quote({ newsItems: [recent] }),
  });

  assert.equal(digest.attentionNews.length, 2);
  assert.deepEqual(digest.attentionNews.map((item) => item.stockName).sort(), ["平安银行", "贵州茅台"].sort());
  assert.ok(digest.attentionNews.every((item) => item.title !== "过期新闻"));
});

test("filters an all-stale news set against the latest quote date", () => {
  const stale = {
    title: "历史公告",
    summary: "已超出关注窗口",
    url: "https://example.com/stale-only",
    media: "公告",
    portal: "公告",
    publishedAt: "2026-06-01 09:00:00",
    sentiment: "负面",
    eventType: "监管与诉讼",
    sourceQuality: "高",
  };
  const digest = buildPortfolioWorkbenchDigest([cnStock], {}, { "600519": quote({ newsItems: [stale] }) });

  assert.equal(digest.newsCoverage.totalItems, 1);
  assert.equal(digest.attentionNews.length, 0);
  assert.equal(digest.negativeNewsCount, 0);
});

test("selects balanced new ideas and excludes current watchlist and high-risk names", () => {
  const opportunity = (market, symbol, scoreValue, risk) => ({
    market,
    symbol,
    name: symbol,
    recommendation: "值得关注",
    score: scoreValue,
    risk,
    confidence: 70,
    qualityTier: "standard",
    plan: { rewardRisk: 1.8 },
  });
  const feeds = {
    CN: { opportunities: [opportunity("CN", "600519", 92, 40), opportunity("CN", "000001", 82, 45), opportunity("CN", "300750", 99, 88)] },
    US: { opportunities: [opportunity("US", "MSFT", 88, 42), opportunity("US", "NVDA", 86, 48)] },
  };

  const ideas = selectPortfolioDiscoveryIdeas(feeds, [cnStock], 4);
  assert.deepEqual(ideas.map((item) => item.symbol).sort(), ["000001", "MSFT", "NVDA"].sort());
  assert.ok(ideas.some((item) => item.market === "CN"));
  assert.ok(ideas.some((item) => item.market === "US"));
});

test("uses a profit color that meets normal-text contrast on the light workbench surface", () => {
  const css = readFileSync(new URL("../app/components/PortfolioWorkbenchSummary.module.css", import.meta.url), "utf8");
  const match = css.match(/--workbench-positive:\s*(#[0-9a-f]{6})/i);
  assert.ok(match);
  assert.ok(contrastRatio(match[1], "#f8f8fa") >= 4.5);
});

test("rounds the workbench KPI strip into the bottom of the summary card", () => {
  const css = readFileSync(new URL("../app/components/PortfolioWorkbenchSummary.module.css", import.meta.url), "utf8");
  assert.match(css, /\.header \{[\s\S]*?border-radius: var\(--platform-panel-radius\) var\(--platform-panel-radius\) 0 0;/);
  assert.match(css, /\.kpis \{[\s\S]*?overflow: hidden;[\s\S]*?border-radius: 0 0 var\(--platform-panel-radius\) var\(--platform-panel-radius\);/);
});

test("keeps large holding sets searchable, filterable and incrementally rendered", () => {
  const component = readFileSync(new URL("../app/components/PortfolioWorkbenchSummary.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/components/PortfolioWorkbenchSummary.module.css", import.meta.url), "utf8");

  assert.match(component, /const holdingPageSize = 8/);
  assert.match(component, /aria-label="持仓筛选"/);
  assert.match(component, /aria-label="搜索持仓股票"/);
  assert.match(component, /aria-label="持仓排序"/);
  assert.match(component, /仓位从高到低/);
  assert.match(component, /再显示 \{Math\.min\(holdingPageSize/);
  assert.match(component, /包含 \$\{digest\.observeCount\} 只继续观察/);
  assert.match(css, /\.positionViewport\s*\{[^}]*max-height:/s);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /\.positionQuickFilters button,[\s\S]*?min-height:\s*44px/);
});

test("keeps B/S loading, partial, error and verified-zero states distinct", () => {
  const coverage = (overrides) => ({ tracked: 2, ready: 0, partial: 0, loading: 0, failed: 0, lagging: 0, latestUpdate: "", failedKeys: [], ...overrides });
  const loading = buildPortfolioSignalAvailability(coverage({ ready: 1, loading: 1 }), 0, 0);
  const partial = buildPortfolioSignalAvailability(coverage({ ready: 1, partial: 1 }), 0, 0);
  const lagging = buildPortfolioSignalAvailability(coverage({ ready: 2, lagging: 1 }), 0, 0);
  const error = buildPortfolioSignalAvailability(coverage({ failed: 2 }), 0, 0);
  const empty = buildPortfolioSignalAvailability(coverage({ ready: 2 }), 0, 0);

  assert.deepEqual([loading.state, partial.state, lagging.state, error.state, empty.state], ["loading", "partial", "partial", "error", "empty"]);
  assert.equal(loading.value, "计算中");
  assert.equal(partial.value, "部分可用");
  assert.match(lagging.detail, /完整且新鲜 1\/2/);
  assert.equal(error.value, "不可用");
  assert.equal(empty.value, "0 个");
  assert.doesNotMatch(`${loading.emptyText}${partial.emptyText}${error.emptyText}`, /未发现近期技术 B\/S/);
});

function contrastRatio(left, right) {
  const first = relativeLuminance(left);
  const second = relativeLuminance(right);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * red + .7152 * green + .0722 * blue;
}
