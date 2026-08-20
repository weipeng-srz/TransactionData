import assert from "node:assert/strict";
import test from "node:test";

import { parseFearGaugeQuotes, parseGlobalIndexResponse, parseVixHistoryCsv } from "../app/lib/globalIndexes.ts";

test("parses the official US VIX and labels the A-share proxy transparently", () => {
  const body = [
    'var hq_str_b_VIX="VIX恐慌指数,17.0400,-1.62,-8.68,,,2026-07-22,04:13:01,17.4800";',
    'var hq_str_s_sh000001="上证指数,3869.0265,-4.6594,-0.12,3867183,79683838";',
    'var hq_str_s_sh000300="沪深300,4523.18,-22.61,-0.50,1850000,43900000";',
    'var hq_str_s_sz399001="深证成指,12111.40,38.90,0.32,4100000,62200000";',
  ].join("\n");
  const now = new Date("2026-07-22T02:00:00.000Z");
  const quotes = parseGlobalIndexResponse(body, now);
  const gauges = parseFearGaugeQuotes(body, quotes, now);

  const vix = gauges.find((gauge) => gauge.id === "us-vix");
  const aShare = gauges.find((gauge) => gauge.id === "a-share-fear");

  assert.equal(vix?.value, 17.04);
  assert.equal(vix?.changePct, -8.68);
  assert.equal(vix?.official, true);
  assert.equal(aShare?.official, false);
  assert.match(aShare?.level ?? "", /压力/);
  assert.doesNotMatch(aShare?.level ?? "", /恐慌|平静/);
  assert.equal(aShare?.name, "A股市场压力温度");
  assert.match(aShare?.source ?? "", /代理模型/);
  assert.match(aShare?.description ?? "", /上涨.*下跌/);
  assert.match(aShare?.formula ?? "", /下跌占比/);
  assert.equal(aShare?.historyPercentile, null);
  assert.deepEqual(aShare?.components.map((item) => item.label), ["核心指数下跌占比", "核心指数平均涨跌"]);
  assert.ok((aShare?.value ?? -1) >= 0 && (aShare?.value ?? 101) <= 100);
});

test("parses official CBOE VIX daily OHLC history for the K-line chart", () => {
  const candles = parseVixHistoryCsv([
    "DATE,OPEN,HIGH,LOW,CLOSE",
    "07/20/2026,18.000000,19.200000,17.500000,18.800000",
    "07/21/2026,18.700000,18.900000,16.900000,17.040000",
    "invalid,10,12,9,11",
  ].join("\n"));

  assert.deepEqual(candles, [
    { date: "2026-07-20", open: 18, high: 19.2, low: 17.5, close: 18.8 },
    { date: "2026-07-21", open: 18.7, high: 18.9, low: 16.9, close: 17.04 },
  ]);
});

test("attaches VIX history only to the official fear gauge", () => {
  const body = [
    'var hq_str_b_VIX="VIX恐慌指数,17.0400,-1.62,-8.68,,,2026-07-22,04:13:01,17.4800";',
    'var hq_str_s_sh000001="上证指数,3869.0265,-4.6594,-0.12,3867183,79683838";',
  ].join("\n");
  const quotes = parseGlobalIndexResponse(body, new Date("2026-07-22T02:00:00.000Z"));
  const history = [{ date: "2026-07-21", open: 18.7, high: 18.9, low: 16.9, close: 17.04 }];
  const gauges = parseFearGaugeQuotes(body, quotes, new Date("2026-07-22T02:00:00.000Z"), history);

  assert.deepEqual(gauges.find((gauge) => gauge.id === "us-vix")?.history, history);
  assert.deepEqual(gauges.find((gauge) => gauge.id === "a-share-fear")?.history, []);
});
