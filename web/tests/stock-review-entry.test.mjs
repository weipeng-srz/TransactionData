import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as journal from "../app/lib/tradingJournal.ts";

const source = readFileSync(new URL("../app/features/review/StockReviewEntry.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function stockReviews(initialEntries = [], quotes = {}) {
  const data = new Map([[journal.JOURNAL_STORAGE_KEY, JSON.stringify({ ...journal.emptyJournal(), entries: initialEntries })]]);
  const exports = {};
  let quoteEntries;
  vm.runInNewContext(compiled, {
    exports, Intl, Date, Error, URLSearchParams,
    require(name) {
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "react") return { useMemo: (calculate) => calculate(), useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
      if (name === "../../components/AuthProvider") return { useAuth: () => ({ syncStatus: "ready" }) };
      if (name === "../../lib/accountStorage") return { accountStorage: { getItem: (key) => data.get(key) ?? null }, subscribeAccountStorage: () => () => {} };
      if (name === "../../lib/tradingJournal") return journal;
      if (name === "./useReviewQuotes") return { useReviewQuotes: (entries) => { quoteEntries = entries; return { quotes, loading: false, error: "", refresh() {} }; } };
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => key }) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return {
    render: (props = {}) => exports.default({ code: "600519", name: "贵州茅台", market: "CN", active: true, ...props }),
    setRaw: (value, key = journal.JOURNAL_STORAGE_KEY) => data.set(key, value),
    quoteEntries: () => quoteEntries,
    select: exports.selectStockReviewEntries,
  };
}

function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props?.children).flatMap((child) => nodes(child, predicate))];
}

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return React.Children.toArray(node?.props?.children).map(text).join("");
}

function entry(overrides = {}) {
  return { ...journal.createReviewEntry("2026-10-01", { code: "600519", name: "贵州茅台" }), title: "等待确认再入场", operationPrice: 100, lesson: "先确认再执行", ...overrides };
}

test("stock journal isolates both market and symbol and sorts the newest operation first", () => {
  const first = entry({ id: "first" });
  const recent = entry({ id: "recent", date: "2026-10-02", title: "最新复盘" });
  const unrelated = entry({ id: "other", code: "600000", title: "不应显示" });
  const harness = stockReviews([first, unrelated, recent]);
  const tree = harness.render();
  const articles = nodes(tree, (node) => node.type === "article");
  assert.equal(articles.length, 2);
  assert.match(text(articles[0]), /最新复盘/);
  assert.doesNotMatch(text(tree), /不应显示/);
  assert.equal(harness.select([first], "600519", "US").length, 0);
  assert.equal(harness.quoteEntries().length, 2);
  harness.render({ active: false });
  assert.equal(harness.quoteEntries().length, 0, "hidden tab must not start quote requests");
});

test("new and edit links preserve stock identity, prefill names, and use the shared journal", () => {
  const item = entry({ id: "review-specific", market: "US", code: "AAPL", name: "苹果" });
  const tree = stockReviews([item]).render({ code: "AAPL", market: "US", name: "苹果 & Apple" });
  const links = nodes(tree, (node) => node.type === "a");
  const compose = new URL(links.find((node) => text(node).includes("新建复盘")).props.href, "https://test.local");
  assert.equal(compose.searchParams.get("stock"), "US:AAPL");
  assert.equal(compose.searchParams.get("name"), "苹果 & Apple");
  assert.equal(compose.searchParams.get("compose"), "1");
  assert.ok(links.some((node) => node.props.href === "/review?entry=review-specific"));
  assert.ok(links.some((node) => node.props.href === "/review"));
  assert.match(text(tree), /已同步至个人数据库/);
});

test("operation changes show price movement with quote time and suppress future operations", () => {
  const quote = { price: 110, asOfDate: "2026-10-02", updatedAt: "2026-10-02 15:00 北京时间" };
  const tree = stockReviews([entry()], { "CN:600519": quote }).render();
  assert.match(text(tree), /¥100\.00/);
  assert.match(text(tree), /¥110\.00/);
  assert.match(text(tree), /\+10\.00%/);
  assert.match(text(tree), /\+10\.00 CNY/);
  assert.match(text(tree), /2026-10-02 15:00 北京时间/);
  const futureTree = stockReviews([entry({ date: "2099-01-01" })], { "CN:600519": quote }).render();
  assert.doesNotMatch(text(futureTree), /\+10\.00%/);
  assert.match(text(futureTree), /行情日期不足以计算操作后涨跌/);
});

test("all stock records remain reachable and legacy annotations remain readable", () => {
  const harness = stockReviews(Array.from({ length: 8 }, (_, index) => entry({ id: `review-${index}` })));
  const tree = harness.render({ legacyAnnotations: [{ id: "old", date: "2026-09-01", text: "原研究记录", price: 90 }] });
  assert.equal(nodes(tree, (node) => node.type === "article").length, 6);
  const all = nodes(tree, (node) => node.type === "a" && text(node).includes("全部 8 篇复盘"))[0];
  assert.equal(new URL(all.props.href, "https://test.local").searchParams.get("stock"), "600519");
  assert.match(text(tree), /原研究记录/);
  assert.match(text(tree), /¥90\.00/);
  assert.equal(tree.props.id, "research-tools");
});

test("malformed journal is shown as a recoverable error and is never overwritten", () => {
  const harness = stockReviews();
  harness.setRaw("malformed");
  const tree = harness.render();
  const error = nodes(tree, (node) => node.props?.role === "alert")[0];
  assert.ok(error);
  assert.match(text(error), /原始数据已保留/);
  assert.match(text(error), /前往复盘中心处理/);
});

test("saved investment thesis, counter-evidence and completed checks remain accessible", () => {
  const harness = stockReviews();
  harness.setRaw(JSON.stringify({ thesis: "利润率持续改善", counterEvidence: "经营现金流下降", invalidation: "毛利率下滑", reviewDate: "2026-11-01", checks: { source: true, downside: false } }), "ticklens.investment-memo.v1:600519");
  const tree = harness.render();
  assert.match(text(tree), /历史投资备忘录/);
  for (const expected of ["利润率持续改善", "经营现金流下降", "毛利率下滑", "2026-11-01", "已核对原始公告 / SEC 申报"]) assert.ok(text(tree).includes(expected));
  assert.doesNotMatch(text(tree), /已定义最大可承受损失/);
});

test("individual-stock research uses the review entry while preserving legacy routes", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<StockReviewEntry/);
  assert.match(page, /id: "notes", label: "交易复盘"/);
  assert.match(page, /"research-tools": "notes"/);
  assert.doesNotMatch(page, /<ResearchDock/);
  assert.match(page, /ticklens\.annotations\.v1/);
  const css = readFileSync(new URL("../app/features/review/StockReviewEntry.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /(?:^|[;{])\s*(?:max-)?width:\s*\d+(?:px|rem)/);
});
