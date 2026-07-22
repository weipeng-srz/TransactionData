import assert from "node:assert/strict";
import test from "node:test";

import { GLOBAL_INDEXES, parseGlobalIndexResponse } from "../app/lib/globalIndexes.ts";

test("parses mixed global index quote formats and keeps catalog metadata", () => {
  const body = [
    'var hq_str_int_dji="道琼斯,46247.29,299.97,0.65";',
    'var hq_str_b_DAX="德国DAX指数,25011.3500,164.66,0.66,,,2026-07-21,23:30:00,24922.1000";',
    'var hq_str_b_NKY="日经225指数,67510.9000,1278.71,1.93,,,2026-07-22,10:30:01,66449.2700";',
    'var hq_str_s_sh000001="上证指数,3869.0265,4.6594,0.12,3867183,79683838";',
  ].join("\n");
  const quotes = parseGlobalIndexResponse(body, new Date("2026-07-22T02:00:00.000Z"));

  assert.deepEqual(quotes.map(({ id, price, changePct }) => ({ id, price, changePct })), [
    { id: "dow", price: 46247.29, changePct: 0.65 },
    { id: "dax", price: 25011.35, changePct: 0.66 },
    { id: "shanghai", price: 3869.0265, changePct: 0.12 },
    { id: "nikkei", price: 67510.9, changePct: 1.93 },
  ]);
  assert.equal(quotes.find((quote) => quote.id === "dax")?.date, "2026-07-21");
  assert.equal(quotes.find((quote) => quote.id === "nikkei")?.time, "10:30:01");
  assert.equal(quotes.find((quote) => quote.id === "shanghai")?.marketStatus, "交易中");
  assert.equal(quotes.find((quote) => quote.id === "dow")?.city, "纽约");
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
  assert.ok(GLOBAL_INDEXES.length >= 15);
});
