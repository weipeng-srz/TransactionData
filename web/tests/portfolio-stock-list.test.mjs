import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as market from "../app/lib/market.ts";
import * as holdings from "../app/lib/holdings.ts";
import * as security from "../app/lib/security.ts";
import * as prediction from "../app/lib/portfolioPrediction.ts";
import * as presentation from "../app/lib/portfolioPresentation.ts";
import * as formatting from "../app/features/portfolio/formatting.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/features/portfolio/PortfolioStockList.tsx", import.meta.url), "utf8");
const dependencies = {
  "../../lib/market": market, "../../lib/holdings": holdings, "../../lib/security": security,
  "../../lib/portfolioPrediction": prediction, "../../lib/portfolioPresentation": presentation,
  "./formatting": formatting,
  "./PortfolioStockList.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
};
const sandbox = { exports: {}, require: (name) => dependencies[name] ?? require(name) };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, sandbox);
const PortfolioStockList = sandbox.exports.default;
const stock = { code: "AAPL", name: "Apple", market: "US", currency: "USD", addedAt: "2026-10-08" };
const quote = {
  status: "ready", price: 110, change: -2, changePct: -1.79, marketStatus: "已收盘", date: "2026-10-08", source: "test",
  error: "", candles: [{ key: "2026-10-08", open: 109, high: 112, low: 108, close: 110 }],
  high: 112, low: 108, volume: 1500, turnoverPct: 0.25,
  prediction: null, predictionStatus: "error", score: null,
  intent: { activeNetAmount: -20_000, basis: "level1", confidence: 72, label: "test", date: "2026-10-08" },
};
const props = {
  stocks: [stock], quotes: { "US:AAPL": quote }, holdings: { "US:AAPL": { shares: 10, cost: 100 } }, emptyQuote: quote,
  onOpen() {}, onOpenPrediction() {}, onEdit() {}, onRemove() {}, onRetry() {},
};

test("watchlist prioritizes predictions and capital while retaining position and quote details", () => {
  const html = renderToStaticMarkup(React.createElement(PortfolioStockList, { ...props, view: "watchlist" }));
  const [primary, detail] = html.split('<details class="rowDetails">');
  assert.match(primary, /资金净流（本币）/);
  assert.match(primary, /流出 \$2\.00万/);
  assert.match(primary, /完整预测/);
  assert.match(primary, /aria-label="移除 Apple"/);
  assert.doesNotMatch(primary, /市值 \$1,100\.00/);
  assert.match(detail, /市值 \$1,100\.00/);
  assert.match(detail, /\+\$100\.00/);
  assert.match(detail, /今日持仓 −\$20\.00/);
  assert.match(detail, /112\.00 \/ 108\.00/);
  assert.match(detail, /0\.25%/);
});

test("holdings prioritizes owned shares and independent PnL but retains the research controls", () => {
  const html = renderToStaticMarkup(React.createElement(PortfolioStockList, { ...props, view: "holdings" }));
  const [primary, detail] = html.split('<details class="rowDetails">');
  assert.match(primary, /市值 \$1,100\.00/);
  assert.match(primary, /\+\$100\.00/);
  assert.match(primary, /−\$20\.00/);
  assert.doesNotMatch(primary, /完整预测|aria-label="移除/);
  assert.match(detail, /完整预测/);
  assert.match(detail, /主动买卖估算/);
  assert.match(detail, /近 1 日 K 线/);
  assert.match(detail, /今日行情/);
});

test("row actions retain stock identity and route full prediction separately", () => {
  const calls = [];
  const list = PortfolioStockList({ ...props, view: "watchlist", onOpen: value => calls.push(["open", value]), onOpenPrediction: value => calls.push(["prediction", value]), onRemove: value => calls.push(["remove", value]) });
  const row = list.props.children[1][0];
  row.props.onOpen();
  row.props.onOpenPrediction();
  row.props.onRemove();
  assert.deepEqual(calls, [["open", stock], ["prediction", stock], ["remove", stock]]);
  const heldList = PortfolioStockList({ ...props, view: "holdings" });
  assert.equal(heldList.props.children[1][0].props.onRemove, undefined);
});

test("moved financial formatting preserves currency, sign, precision and share boundaries", () => {
  assert.equal(formatting.formatCurrency(1234.567), "¥1,234.57");
  assert.equal(formatting.formatCurrency(1234.567, "USD"), "$1,234.57");
  assert.equal(formatting.formatCurrency(Number.NaN), "—");
  assert.equal(formatting.signedCurrency(-12.3, "USD"), "−$12.30");
  assert.equal(formatting.signedCurrency(0), "+¥0.00");
  assert.equal(formatting.signedCurrency(Infinity), "—");
  assert.equal(formatting.signedPercent(-1.234), "-1.23%");
  assert.equal(formatting.signedPercent(0), "+0.00%");
  assert.equal(formatting.probabilityPercent(0.567), "57%");
  assert.equal(formatting.probabilityPercent(Number.NaN), "—");
  assert.equal(formatting.formatShares(9_999), "9,999 股");
  assert.equal(formatting.formatShares(10_000), "1.00 万股");
  assert.equal(formatting.formatShares(100_000_000), "1.00 亿股");
  assert.equal(formatting.currencyName("CNY"), "人民币");
  assert.equal(formatting.currencyName("USD"), "美元");
});
