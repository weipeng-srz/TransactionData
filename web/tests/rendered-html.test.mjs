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

test("server-renders the TickLens market workbench", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TickLens · 市场研究工作台<\/title>/i);
  assert.match(html, /og-apple\.png/);
  assert.match(html, /TickLens/);
  assert.match(html, /市场研究工作台/);
  assert.match(html, /平安银行/);
  assert.match(html, /股票名称或代码，如 平安银行 \/ 000001/);
  assert.match(html, /行情、基本面与新闻并行更新/);
  assert.match(html, /切换到深色外观/);
  assert.match(html, /输入股票代码或名称后自动获取最新新闻/);
  assert.match(html, /最近查询/);
  assert.match(html, /输入股票名称或代码一键获取舆情/);
  assert.match(html, /K线研判/);
  assert.match(html, /B\/S指引/);
  assert.match(html, /舆情资讯/);
  assert.match(html, /基本面全景/);
  assert.match(html, /输入股票查看 20 项常用基本面指标/);
  assert.match(html, /近三期财报/);
  assert.match(html, /输入股票查看近三期财报/);
  assert.match(html, /财报对比/);
  assert.match(html, /输入股票查看最近 8 个单季度/);
  assert.match(html, /研究记录与数据口径/);
  assert.match(html, /B\/S 信号回测/);
  assert.match(html, /当前交易日 · 分钟 K 线与五档盘口/);
  assert.match(html, /查询股票后显示实时行情/);
  assert.match(html, /行情监控/);
  assert.doesNotMatch(html, /预警队列/);
  assert.match(html, /分享当前研究/);
  assert.match(html, /导出报告/);
  assert.doesNotMatch(html, /aria-label="财报筛选"/);
  assert.match(html, /获取行情 \+ 基本面 \+ 新闻/);
  assert.doesNotMatch(html, /type="file"/i);
  assert.doesNotMatch(html, /导入(?:行情|新闻)/);
  assert.doesNotMatch(html, /\[object Object\]/);
});

test("server-renders the dedicated desktop market monitor", async () => {
  const response = await render("/alerts");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /跨股票预警集中管理/);
  assert.match(html, /创建价格预警/);
  assert.match(html, /预警队列/);
  assert.match(html, /返回当前股票研究/);
  assert.doesNotMatch(html, /K线研判/);
});
