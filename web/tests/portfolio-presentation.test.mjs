import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPortfolioInsights,
  formatCapitalAmount,
  sortPortfolioWatchlist,
} from "../app/lib/portfolioPresentation.ts";

const portfolioSource = readFileSync(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8");

const cnStock = { code: "600519", name: "贵州茅台", addedAt: "2026-08-18T00:00:00.000Z" };
const usStock = { code: "AAPL", name: "Apple", market: "US", currency: "USD", addedAt: "2026-08-17T00:00:00.000Z" };

function quote(overrides = {}) {
  return {
    status: "ready",
    price: 10,
    changePct: 0,
    date: "2026-08-18",
    time: "15:00:00",
    score: null,
    intent: null,
    ...overrides,
  };
}

test("sorts capital and profit across markets by currency-neutral percentages", () => {
  const watchlist = [cnStock, usStock];
  const holdings = {
    "600519": { code: "600519", shares: 1_000, cost: 10, updatedAt: "2026-08-18T00:00:00.000Z" },
    "US:AAPL": { code: "AAPL", market: "US", currency: "USD", shares: 1, cost: 10, updatedAt: "2026-08-18T00:00:00.000Z" },
  };
  const quotes = {
    "600519": quote({ price: 11, intent: { activeNetAmount: 1_000_000_000, activeNetRatio: 2 } }),
    "US:AAPL": quote({ price: 15, intent: { activeNetAmount: 1_000_000, activeNetRatio: 12 } }),
  };

  assert.deepEqual(sortPortfolioWatchlist(watchlist, holdings, quotes, "capital").map((stock) => stock.code), ["AAPL", "600519"]);
  assert.deepEqual(sortPortfolioWatchlist(watchlist, holdings, quotes, "profit").map((stock) => stock.code), ["AAPL", "600519"]);
});

test("keeps portfolio exposure and concentration separate by currency", () => {
  const watchlist = [
    cnStock,
    { code: "000001", name: "平安银行", addedAt: "2026-08-16T00:00:00.000Z" },
    usStock,
  ];
  const holdings = {
    "600519": { code: "600519", shares: 9, cost: 90, updatedAt: "2026-08-18T00:00:00.000Z" },
    "000001": { code: "000001", shares: 10, cost: 9, updatedAt: "2026-08-18T00:00:00.000Z" },
    "US:AAPL": { code: "AAPL", market: "US", currency: "USD", shares: 2, cost: 40, updatedAt: "2026-08-18T00:00:00.000Z" },
  };
  const quotes = {
    "600519": quote({ price: 100, changePct: 1.2 }),
    "000001": quote({ price: 10, changePct: -0.8 }),
    "US:AAPL": quote({ price: 50, changePct: 2.5 }),
  };

  const summary = buildPortfolioInsights(watchlist, holdings, quotes);
  assert.equal(summary.completionPct, 100);
  assert.deepEqual(summary.exposures.map((exposure) => exposure.currency), ["CNY", "USD"]);
  assert.equal(summary.exposures[0].marketValue, 1_000);
  assert.equal(summary.exposures[0].topStockName, "贵州茅台");
  assert.equal(summary.exposures[0].topWeightPct, 90);
  assert.equal(summary.exposures[1].marketValue, 100);
  assert.equal(summary.exposures[1].topWeightPct, 100);
  assert.match(summary.nextAction, /美元子组合/);
});

test("formats estimated capital flow in the security's own currency", () => {
  assert.equal(formatCapitalAmount(1_430_000_000, "CNY"), "¥14.30亿");
  assert.equal(formatCapitalAmount(-1_430_000_000, "USD"), "$14.30亿");
});

test("uses explicit controls instead of a link role containing row buttons", () => {
  const rowSource = portfolioSource.slice(
    portfolioSource.indexOf("function PortfolioRow"),
    portfolioSource.indexOf("function CapitalFlowCell"),
  );
  assert.doesNotMatch(rowSource, /role="link"|tabIndex=\{0\}/);
  assert.match(rowSource, /<button className=\{styles\.stockIdentity\} type="button"/);
  assert.match(rowSource, /aria-label=\{`打开 \$\{stock\.name\}/);
});

test("presents IXIC cash value as primary and labels the ETF or futures proxy separately", () => {
  assert.match(portfolioSource, /value: nasdaq\?\.cashPrice \?\? null/);
  assert.match(portfolioSource, /meta: nasdaq \? `IXIC/);
  assert.match(portfolioSource, /方向参考，非 IXIC 指数点位/);
  assert.match(portfolioSource, /<PortfolioDecisionBrief summary=\{portfolioInsights\}/);
  assert.match(portfolioSource, /不采用隐含汇率/);
});
