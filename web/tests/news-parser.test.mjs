import assert from "node:assert/strict";
import test from "node:test";

import { looksLikeNewsCsv, parseNewsCsv } from "../app/lib/news.ts";

const header = "股票代码,股票名称,检索入口,频道,媒体来源,发布时间,相关性得分,情绪倾向,情绪得分,正向词,负向词,新闻标题,新闻摘要,原文链接,采集时间";

test("parses news CSV and builds a sentiment summary", () => {
  const csv = [
    header,
    '600000,浦发银行,东方财富,财经/股票,上海证券报,2026-07-17 09:02:22,1.00,正面,1.000,成功,,浦发银行成功发行债券,"认购踊跃, 发行成功",https://example.com/a,2026-07-17 10:24:34',
    "600000,浦发银行,新浪搜索,新闻/财经,市场资讯,2026-07-16 08:00:00,1.00,负面,-1.000,,处罚；违规,浦发银行收到警示函,因违规被处罚,https://example.com/b,2026-07-17 10:24:34",
    "600000,浦发银行,中国新闻网,财经,中国新闻网,2026-07-15 08:00:00,0.85,中性,0.000,,,召开股东大会,审议普通议案,https://example.com/c,2026-07-17 10:24:34",
  ].join("\n");

  assert.equal(looksLikeNewsCsv(csv), true);
  const dataset = parseNewsCsv(csv);
  assert.equal(dataset.items.length, 3);
  assert.equal(dataset.summary.total, 3);
  assert.equal(dataset.summary.positive, 1);
  assert.equal(dataset.summary.neutral, 1);
  assert.equal(dataset.summary.negative, 1);
  assert.equal(dataset.summary.tone, "中性");
  assert.equal(dataset.summary.portals, 3);
  assert.deepEqual(dataset.stockNames, { "600000": "浦发银行" });
  assert.equal(dataset.items[0].summary, "认购踊跃, 发行成功");
});

test("skips unsafe or malformed news rows", () => {
  const csv = [
    header,
    "600000,浦发银行,未知,新闻,未知,2026-07-17,1,正面,1,,,危险链接,摘要,javascript:alert(1),2026-07-17",
    "bad,浦发银行,未知,新闻,未知,2026-07-17,1,正面,1,,,错误代码,摘要,https://example.com,2026-07-17",
  ].join("\n");
  const dataset = parseNewsCsv(csv);
  assert.equal(dataset.items.length, 0);
  assert.equal(dataset.skipped, 2);
});

test("rejects a non-news CSV", () => {
  assert.throws(() => parseNewsCsv("交易日期,成交时间\n2026-07-17,09:30:00"), /缺少字段/);
});
