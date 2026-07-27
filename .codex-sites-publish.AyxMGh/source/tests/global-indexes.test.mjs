import assert from "node:assert/strict";
import test from "node:test";

import { GLOBAL_INDEXES, parseGlobalIndexResponse } from "../app/lib/globalIndexes.ts";
import { parseUSMarketResponse, resolveUSMarketPhase, US_INDEXES } from "../app/lib/usMarketIndexes.ts";

test("parses mixed global index quote formats and keeps catalog metadata", () => {
  const body = [
    'var hq_str_int_dji="道琼斯,46247.29,299.97,0.65";',
    'var hq_str_b_DAX="德国DAX指数,25011.3500,164.66,0.66,,,2026-07-21,23:30:00,24922.1000";',
    'var hq_str_b_NKY="日经225指数,67510.9000,1278.71,1.93,,,2026-07-22,10:30:01,66449.2700";',
    'var hq_str_s_sh000001="上证指数,3869.0265,4.6594,0.12,3867183,79683838";',
  ].join("\n");
  const quotes = parseGlobalIndexResponse(body, new Date("2026-07-22T02:00:00.000Z"));

  assert.deepEqual(quotes.map(({ id, price, changePct }) => ({ id, price, changePct })), [
    { id: "dax", price: 25011.35, changePct: 0.66 },
    { id: "shanghai", price: 3869.0265, changePct: 0.12 },
    { id: "nikkei", price: 67510.9, changePct: 1.93 },
  ]);
  assert.equal(quotes.find((quote) => quote.id === "dax")?.date, "2026-07-21");
  assert.equal(quotes.find((quote) => quote.id === "nikkei")?.time, "10:30:01");
  assert.equal(quotes.find((quote) => quote.id === "shanghai")?.marketStatus, "交易中");
});

test("ignores empty or malformed global quotes without losing valid markets", () => {
  const body = [
    'var hq_str_b_GSPTSE="加拿大多伦多S&P/TSX,35357.4100,397.09,1.14,,,2026-07-22,04:00:00";',
    'var hq_str_b_IBOV="";',
    'var hq_str_b_FTSE="富时100指数,not-a-price,61.15,0.58";',
  ].join("\n");
  const quotes = parseGlobalIndexResponse(body, new Date("2026-07-22T04:00:00.000Z"));

  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].id, "tsx");
  assert.ok(GLOBAL_INDEXES.length >= 20);
  assert.ok(GLOBAL_INDEXES.filter((item) => item.region === "A股").length >= 9);
  assert.ok(US_INDEXES.length >= 5);
});

test("resolves pre-market, regular, post-market, overnight and weekend US stages", () => {
  assert.equal(resolveUSMarketPhase(new Date("2026-07-22T12:00:00.000Z")), "盘前");
  assert.equal(resolveUSMarketPhase(new Date("2026-07-22T14:00:00.000Z")), "盘中");
  assert.equal(resolveUSMarketPhase(new Date("2026-07-22T21:00:00.000Z")), "盘后");
  assert.equal(resolveUSMarketPhase(new Date("2026-07-22T03:45:00.000Z")), "夜盘");
  assert.equal(resolveUSMarketPhase(new Date("2026-07-25T14:00:00.000Z")), "周末休市");
});

test("uses ETF extended-hours value while keeping the official cash close", () => {
  const cash = Array(27).fill("");
  Object.assign(cash, { 0: "道琼斯", 1: "52224.64", 2: "0.74", 3: "2026-07-22 04:43:44", 4: "385.38", 25: "Jul 21 04:43PM EDT", 26: "51839.26" });
  const extended = Array(25).fill("");
  Object.assign(extended, { 0: "道指ETF", 1: "521.51", 2: "0.69", 21: "522.20", 22: "0.13", 23: "0.69", 24: "Jul 22 08:00AM EDT" });
  const quotes = parseUSMarketResponse([
    quoteLine("gb_$dji", cash),
    quoteLine("gb_dia", extended),
  ].join("\n"), new Date("2026-07-22T12:00:00.000Z"));

  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].phase, "盘前");
  assert.equal(quotes[0].phaseValue, 522.2);
  assert.equal(quotes[0].phaseInstrument, "DIA ETF 延长时段代理");
  assert.equal(quotes[0].phaseIsProxy, true);
  assert.equal(quotes[0].closePrice, 52224.64);
  assert.equal(quotes[0].closeLabel, "最近现货收盘");
});

test("uses index futures at night and labels the prior cash index close separately", () => {
  const cash = Array(27).fill("");
  Object.assign(cash, { 0: "标普500指数", 1: "7509.20", 2: "0.89", 3: "2026-07-22 04:40:03", 4: "65.92", 25: "Jul 21 04:39PM EDT", 26: "7443.28" });
  const future = Array(14).fill("");
  Object.assign(future, { 0: "7538.573", 6: "11:44:42", 7: "7545.750", 12: "2026-07-22", 13: "标普500指数期货" });
  const quotes = parseUSMarketResponse([
    quoteLine("gb_inx", cash),
    quoteLine("hf_ES", future),
  ].join("\n"), new Date("2026-07-22T03:45:00.000Z"));

  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].phase, "夜盘");
  assert.equal(quotes[0].phaseValue, 7538.573);
  assert.match(quotes[0].phaseInstrument, /ES .*夜盘代理/);
  assert.equal(quotes[0].closePrice, 7509.2);
  assert.equal(quotes[0].closeLabel, "最近现货收盘");
});

function quoteLine(symbol, fields) {
  return `var hq_str_${symbol}="${fields.join(",")}";`;
}
