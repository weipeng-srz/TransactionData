import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStrategyEvidence,
  fetchText,
  isTransientUpstreamStatus,
  normalizeScreenerMarket,
  parseCNDailyResponse,
  parseCNListResponse,
  parseUSListResponse,
  rankPhaseOpportunities,
  scoreScreenerOpportunity,
} from "../app/lib/screenerData.ts";

test("screener normalizes markets and parses Sina A-share quotes", () => {
  assert.equal(normalizeScreenerMarket("us"), "US");
  assert.equal(normalizeScreenerMarket("unknown"), "CN");
  const [quote] = parseCNListResponse(JSON.stringify([{
    symbol: "sh600000", code: "600000", name: "浦发银行", trade: "12.30", changepercent: "1.25",
    settlement: "12.15", open: "12.18", high: "12.40", low: "12.10", volume: "1000000",
    amount: "12300000", mktcap: "1000000", nmc: "800000", turnoverratio: "1.8", ticktime: "15:00:00",
  }]));
  assert.equal(quote.code, "600000");
  assert.equal(quote.price, 12.3);
  assert.equal(quote.marketCap, 10_000_000_000);
});

test("screener parses Sina US JSONP and applies raw quote fields", () => {
  const response = parseUSListResponse(`/*guard*/\nvar trendsight=({"count":"18012","data":[{"symbol":"NVDA","cname":"NVIDIA","market":"NASDAQ","category":"Semiconductors","price":"180","chg":"2.5","preclose":"175.61","open":"177","high":"182","low":"176","volume":"1000000","mktcap":"4400000000000"}]})`);
  assert.equal(response.count, 18012);
  assert.equal(response.quotes[0].symbol, "NVDA");
  assert.equal(response.quotes[0].amount, 180_000_000);
});

test("screener scoring is derived from daily prices and exposes transparent factors", () => {
  const rows = parseCNDailyResponse(JSON.stringify(Array.from({ length: 30 }, (_, index) => ({
    day: `2026-07-${String(index + 1).padStart(2, "0")}`,
    open: 10 + index * .1,
    high: 10.3 + index * .1,
    low: 9.9 + index * .1,
    close: 10.2 + index * .1,
    volume: 1_000_000 + index * 20_000,
  }))));
  const opportunity = scoreScreenerOpportunity({
    market: "CN", symbol: "600000", name: "测试股份", exchange: "沪市", price: 13.3, change: 3.1,
    previousClose: 12.9, open: 13, high: 13.4, low: 12.95, volume: 2_000_000, amount: 26_600_000,
    marketCap: 10_000_000_000, turnover: 3.2, sector: "测试板块", themes: ["测试板块"], streak: 0,
    securityType: "股票", qualityTier: "standard", wasYesterdayLimit: false, isCurrentLimit: false,
  }, rows, 2);
  assert.ok(opportunity.score >= 0 && opportunity.score <= 100);
  assert.ok(opportunity.risk >= 0 && opportunity.risk <= 100);
  assert.ok(opportunity.confidence >= 35 && opportunity.confidence <= 82);
  assert.deepEqual(opportunity.factorScores.map((item) => item.label), ["强度", "趋势", "量价", "动量"]);
  assert.match(opportunity.plan.stop, /^¥/);
  assert.ok(opportunity.plan.stopDistancePercent > 0);
  assert.ok(opportunity.plan.suggestedPositionPercent > 0 && opportunity.plan.suggestedPositionPercent <= 20);
  assert.equal(opportunity.chart.prices.length, 30);
  assert.equal(opportunity.audit.modelVersion, "rules-2026.08.4");
  assert.equal(opportunity.securityType, "股票");
  assert.ok(opportunity.phaseAnalysis.mainUptrend.score >= 0 && opportunity.phaseAnalysis.mainUptrend.score <= 100);
  assert.ok(opportunity.phaseAnalysis.accumulation.score >= 0 && opportunity.phaseAnalysis.accumulation.score <= 100);
  assert.ok(opportunity.phaseAnalysis.mainUptrend.actionable);
  assert.ok(["启动确认", "趋势准备"].includes(opportunity.phaseAnalysis.mainUptrend.stage));
  const [rankedOpportunity] = rankPhaseOpportunities([opportunity]);
  assert.ok(rankedOpportunity.strategies.includes("主升扫描"));
  assert.match(rankedOpportunity.phaseAnalysis.mainUptrend.rankLabel, /前20%/);
  assert.match(opportunity.plan.trailingStop, /1R/);
  assert.match(opportunity.phaseAnalysis.accumulation.warning, /不能识别真实账户/);
});

test("screener identifies a contracting base as an accumulation watch without claiming account identity", () => {
  const rows = Array.from({ length: 90 }, (_, index) => {
    const close = index < 55 ? 12 - index * .03 : 10.38 + (index - 55) * .006 + Math.sin(index) * .025;
    const previousClose = index === 0 ? close : index - 1 < 55 ? 12 - (index - 1) * .03 : 10.38 + (index - 1 - 55) * .006 + Math.sin(index - 1) * .025;
    const volume = close >= previousClose ? 1_350_000 : 850_000;
    return { date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`, open: close - .015, high: close + .07, low: close - .07, close, volume, amount: close * volume };
  });
  const latest = rows.at(-1);
  const opportunity = scoreScreenerOpportunity({
    market: "CN", symbol: "600001", name: "平台样本", exchange: "沪市", price: latest.close, change: .45,
    previousClose: rows.at(-2).close, open: latest.open, high: latest.high, low: latest.low, volume: latest.volume, amount: latest.amount,
    marketCap: 8_000_000_000, turnover: 2.6, sector: "测试板块", themes: ["测试板块"], streak: 0,
    securityType: "股票", qualityTier: "standard", wasYesterdayLimit: false, isCurrentLimit: false,
  }, rows, 0);
  assert.ok(opportunity.phaseAnalysis.accumulation.score >= 50);
  assert.ok(["早期平台", "平台确认", "突破准备"].includes(opportunity.phaseAnalysis.accumulation.stage));
  const baseCandidate = structuredClone(opportunity);
  baseCandidate.phaseAnalysis.accumulation.stage = "平台确认";
  baseCandidate.phaseAnalysis.accumulation.score = 65;
  baseCandidate.phaseAnalysis.accumulation.actionable = true;
  const [rankedOpportunity] = rankPhaseOpportunities([baseCandidate]);
  assert.ok(rankedOpportunity.strategies.includes("建仓观察"));
  const [breakoutCandidate] = rankPhaseOpportunities([opportunity]);
  if (opportunity.phaseAnalysis.accumulation.stage === "突破准备") {
    assert.ok(!breakoutCandidate.strategies.includes("建仓观察"));
    assert.match(breakoutCandidate.phaseAnalysis.accumulation.rankLabel, /有效建仓池/);
  }
  assert.match(opportunity.phaseAnalysis.accumulation.summary, /平台|承接/);
  assert.match(opportunity.phaseAnalysis.accumulation.warning, /不能证明机构|不能识别真实账户/);
});

test("screener builds disclosed rolling evidence from real daily rows without inventing probability", () => {
  const rows = Array.from({ length: 90 }, (_, index) => ({
    date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`,
    open: 10 + index * .08,
    high: 10.3 + index * .08,
    low: 9.8 + index * .08,
    close: 10.2 + index * .08,
    volume: index % 7 === 0 ? 2_200_000 : 1_000_000,
    amount: 20_000_000,
  }));
  const evidence = buildStrategyEvidence("CN", [rows]);
  const breakout = evidence.find((item) => item.strategy === "趋势突破");
  assert.ok(breakout);
  assert.ok(breakout.sampleSize > 10);
  assert.match(breakout.methodology, /不等同全市场回测/);
});

test("screener feed diagnostics disclose the rule prefilter stage", async () => {
  const source = await import("node:fs").then(({ readFileSync }) => readFileSync(new URL("../app/lib/screenerData.ts", import.meta.url), "utf8"));
  assert.match(source, /prefilterCount: selectedCodes\.length/);
  assert.match(source, /prefilterCount: selected\.length/);
});

test("screener retries transient upstream blocks without retrying permanent client errors", async () => {
  assert.equal(isTransientUpstreamStatus(429), true);
  assert.equal(isTransientUpstreamStatus(456), true);
  assert.equal(isTransientUpstreamStatus(503), true);
  assert.equal(isTransientUpstreamStatus(404), false);

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? new Response("blocked", { status: 456 }) : new Response("ok");
  };
  try {
    assert.equal(await fetchText("https://example.com/quotes", 1024), "ok");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
