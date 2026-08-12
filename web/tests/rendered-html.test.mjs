import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the TrendSight watchlist homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TrendSight · 市场研究工作台<\/title>/i);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /favicon\.png/);
  assert.match(html, /apple-touch-icon\.png/);
  assert.match(html, /trendsight-icon-512\.png/);
  assert.match(html, /TrendSight/);
  assert.match(html, /市场研究工作台/);
  assert.doesNotMatch(html, /自选股，一目了然/);
  assert.doesNotMatch(html, /集中查看行情、持仓与收益/);
  assert.match(html, /平安银行/);
  assert.match(html, /输入股票名称或代码，如 平安银行 \/ 000001/);
  assert.match(html, /切换个股/);
  assert.match(html, /<header[^>]*>[\s\S]*aria-label="快速搜索股票"/);
  assert.match(html, />自选<\/a>/);
  assert.match(html, />全球<\/a>/);
  assert.doesNotMatch(html, />个股研究<\/a>/);
  assert.match(html, /切换到深色外观/);
  assert.match(html, /持仓市值/);
  assert.match(html, /累计收益/);
  assert.match(html, /今日持仓盈亏/);
  assert.match(html, /我的自选股/);
  assert.match(html, /建立你的第一份自选列表/);
  assert.match(html, /迷你 K 线、实时行情、持仓市值与收益/);
  assert.match(html, /全球市场/);
  assert.match(html, /全球市场脉动/);
  assert.match(html, /上证指数/);
  assert.match(html, /创业板指/);
  assert.match(html, /纳斯达克综指/);
  assert.match(html, /A股恐慌指数/);
  assert.match(html, /美股恐慌指数/);
  assert.match(html, /10 秒自动刷新/);
  assert.doesNotMatch(html, /\[object Object\]/);
});

test("server-renders the global realtime index map", async () => {
  const response = await render("/global-markets");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /全球股指脉动/);
  assert.match(html, /全球主要市场板块/);
  assert.match(html, /个市场数值框/);
  assert.match(html, /数值框边缘贴近交易所坐标/);
  assert.match(html, /AMER/);
  assert.match(html, /EMEA/);
  assert.match(html, /APAC/);
  assert.match(html, /A股核心指数/);
  assert.match(html, /A股恐慌指标/);
  assert.match(html, /沪深 300/);
  assert.match(html, /创业板指/);
  assert.match(html, /北证 50/);
  assert.match(html, /标普 500/);
  assert.match(html, /日经 225/);
  assert.match(html, /行情每 10 秒刷新/);
  assert.match(html, /恐慌指数日 K/);
  assert.doesNotMatch(html, /B\/S 信号回测/);
  assert.doesNotMatch(html, /行情监控|\/alerts/);
});
