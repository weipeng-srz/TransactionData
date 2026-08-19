import assert from "node:assert/strict";
import test from "node:test";

import { parseNewsCsv } from "../app/lib/news.ts";
import { fetchUSNewsCsv } from "../app/lib/usStockNews.ts";

function appleLookupResponse() {
  const apple = Buffer.from([0xc6, 0xbb, 0xb9, 0xfb]);
  return Buffer.concat([
    Buffer.from('var trendsight="', "ascii"),
    apple,
    Buffer.from(",41,aapl,aapl,", "ascii"),
    apple,
    Buffer.from(",,", "ascii"),
    apple,
    Buffer.from(',99,1,ESG,,;";', "ascii"),
  ]);
}

function article(title, summary, url, ctime) {
  return { title, searchSummary: summary, url, ctime, media_show: "测试媒体" };
}

async function withAppleNews(items, run) {
  const originalFetch = globalThis.fetch;
  const searchRequests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "suggest3.sinajs.cn") return new Response(appleLookupResponse());
    if (url.hostname === "search.sina.com.cn") {
      searchRequests.push(url);
      return new Response(JSON.stringify({ data: { list: items } }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected request ${url}`);
  };
  try {
    return await run(searchRequests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("disambiguates AAPL from fruit news and scores explicit company or ticker evidence", async () => {
  const items = [
    article("保存苹果不能放冰箱", "水果保鲜方法汇总", "https://example.com/fruit-storage", 1_775_000_001),
    article("动物园大熊猫吃苹果", "今日投喂水果", "https://example.com/panda", 1_775_000_002),
    article("苹果期货培训开班", "分析师讲解农产品交易", "https://example.com/apple-futures", 1_775_000_003),
    article("苹果公司发布新款 iPhone", "新产品将在秋季上市", "https://example.com/apple-company", 1_775_000_004),
    article("AAPL shares rise after earnings", "Revenue beat expectations", "https://example.com/aapl?utm_source=feed", 1_775_000_005),
    article("苹果股价盘前上涨", "分析师上调目标价", "https://example.com/apple-stock", 1_775_000_006),
    article("供应商上调季度指引", "Nasdaq-listed AAPL remains its largest customer", "https://example.com/aapl-supplier", 1_775_000_007),
  ];

  await withAppleNews(items, async (searchRequests) => {
    const dataset = parseNewsCsv(await fetchUSNewsCsv("aapl", 30));
    assert.equal(searchRequests.length, 1);
    assert.equal(searchRequests[0].searchParams.get("q"), "AAPL 苹果公司");
    assert.deepEqual(new Set(dataset.items.map((item) => item.title)), new Set([
      "苹果公司发布新款 iPhone",
      "AAPL shares rise after earnings",
      "苹果股价盘前上涨",
      "供应商上调季度指引",
    ]));
    assert.equal(dataset.items.find((item) => item.title === "AAPL shares rise after earnings")?.relevance, 1);
    assert.equal(dataset.items.find((item) => item.title === "苹果公司发布新款 iPhone")?.relevance, 0.99);
    assert.equal(dataset.items.find((item) => item.title === "苹果股价盘前上涨")?.relevance, 0.95);
    assert.equal(dataset.items.find((item) => item.title === "供应商上调季度指引")?.relevance, 0.94);
  });
});

test("deduplicates AAPL articles by normalized title and canonical URL", async () => {
  const items = [
    article("AAPL shares rise after earnings", "Revenue beat expectations", "https://example.com/aapl?utm_source=feed", 1_775_000_001),
    article("AAPL shares rise — after earnings!", "Duplicate headline", "https://example.com/title-copy", 1_775_000_002),
    article("AAPL analysts lift target", "Duplicate canonical URL", "https://example.com/aapl?utm_source=other", 1_775_000_003),
    article("苹果公司扩大股票回购", "董事会批准新计划", "https://example.com/buyback", 1_775_000_004),
  ];

  await withAppleNews(items, async () => {
    const dataset = parseNewsCsv(await fetchUSNewsCsv("AAPL", 30));
    assert.deepEqual(dataset.items.map((item) => item.title).sort(), [
      "AAPL shares rise after earnings",
      "苹果公司扩大股票回购",
    ].sort());
  });
});
