import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildDailyTradesCsv,
  normalizeDailyTradesRequest,
  parseDailyTradesResponse,
  parseTencentDailyTradePage,
  parseTencentTradeTimeline,
} from "../app/lib/dailyTrades.ts";

test("normalizes single-day trade download requests", () => {
  assert.deepEqual(normalizeDailyTradesRequest({ code: " sz000001 ", date: "2026-08-14", name: "平安银行", previousClose: 11.11 }), {
    code: "000001",
    date: "2026-08-14",
    name: "平安银行",
    previousClose: 11.11,
  });
  assert.throws(() => normalizeDailyTradesRequest({ code: "AAPL", date: "2026-08-14" }), /6 位/);
  assert.throws(() => normalizeDailyTradesRequest({ code: "000001", date: "08\/14\/2026" }), /日期/);
});

test("parses Level-1 slices and excludes zero-trade auction snapshots", () => {
  const parsed = parseDailyTradesResponse(JSON.stringify({
    rc: 0,
    data: {
      code: "000001",
      prePrice: 11.11,
      details: [
        "09:24:57,11.19,16628,0,4",
        "09:25:00,11.20,21048,607,2",
        "09:30:03,11.19,8879,369,1",
        "15:20:15,11.10,18,2,1",
      ],
    },
  }));

  assert.equal(parsed.trades.length, 3);
  assert.deepEqual(parsed.trades[0], { time: "09:25:00", price: 11.2, priceChange: null, volumeLots: 21048, tradeCount: 607, amount: null, sideCode: "2" });
});

test("parses the Tencent timeline and paged fallback rows", () => {
  assert.deepEqual(
    parseTencentTradeTimeline('v_detail_time_sz000001=[20260817,"09:25:00~09:33:24|09:33:27~09:36:54"]'),
    { date: "2026-08-17", pageCount: 2 },
  );
  const trades = parseTencentDailyTradePage('v_detail_data_sz000001=[0,"0/09:25:00/11.20/0.01/21048/23573760/B|1/09:30:03/11.19/-0.01/8879/9942002/S"]');
  assert.deepEqual(trades[0], {
    time: "09:25:00",
    price: 11.2,
    priceChange: 0.01,
    volumeLots: 21048,
    tradeCount: null,
    amount: 23573760,
    sideCode: "B",
  });
});

test("exports every returned trade slice with volume, count, side, and session metadata", () => {
  const request = { code: "000001", date: "2026-08-14", name: "平安银行", previousClose: 11.11 };
  const csv = buildDailyTradesCsv(request, {
    code: "000001",
    previousClose: 11.11,
    trades: [
      { time: "09:25:00", price: 11.2, priceChange: null, volumeLots: 10, tradeCount: 3, amount: null, sideCode: "2" },
      { time: "15:20:15", price: 11.1, priceChange: null, volumeLots: 2, tradeCount: 1, amount: null, sideCode: "1" },
    ],
    source: "东方财富公开Level-1成交明细",
    tradeCountBasis: "单条Level-1时间切片内聚合的成交笔数",
    amountBasis: "成交价×成交量估算",
  });

  assert.match(csv, /^\uFEFF#META,/);
  assert.match(csv, /成交笔数口径=单条Level-1时间切片内聚合的成交笔数/);
  assert.match(csv, /2026-08-14,09:25:00,1,000001,平安银行,11\.200,0\.090,0\.810,10,1000,3,11200\.00,买盘,2,开盘集合竞价/);
  assert.match(csv, /2026-08-14,15:20:15,2,000001,平安银行,11\.100,-0\.100,-0\.090,2,200,1,2220\.00,卖盘,1,盘后交易/);
});

test("single-day K-line panel exposes the Level-1 trade download", async () => {
  const source = await readFile(new URL("../app/components/RealtimeTradingPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/local-stock-trades/);
  assert.match(source, /下载逐笔成交/);
  assert.match(source, /约 3 秒聚合，不是 Level-2 原始订单/);
});

test("single-day download keeps the shared icon-button geometry while status changes", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../app/components/RealtimeTradingPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/apple.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /className="icon-button realtime-download-button"/);
  assert.match(source, /aria-busy=\{download\.phase === "loading"\}/);
  assert.match(source, /<span className="sr-only" role="status">/);
  assert.doesNotMatch(styles, /\.realtime-download-status/);
  assert.match(styles, /\.realtime-header-meta button:not\(\.icon-button\)/);
});
