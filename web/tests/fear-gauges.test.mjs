import assert from "node:assert/strict";
import test from "node:test";

import { parseFearGaugeQuotes, parseGlobalIndexResponse } from "../app/lib/globalIndexes.ts";

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
  assert.match(aShare?.source ?? "", /代理模型/);
  assert.ok((aShare?.value ?? -1) >= 0 && (aShare?.value ?? 101) <= 100);
});
