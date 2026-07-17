import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
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
  assert.match(html, /<title>TickLens · 行情、基本面与舆情工作台<\/title>/i);
  assert.match(html, /og-fundamentals\.png/);
  assert.match(html, /TickLens/);
  assert.match(html, /行情、基本面与舆情工作台/);
  assert.match(html, /平安银行/);
  assert.match(html, /股票名称或代码，如 平安银行 \/ 000001/);
  assert.match(html, /行情、基本面与新闻并行采集 · 浏览器分析/);
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
  assert.match(html, /最近8季度/);
  assert.match(html, /单季度/);
  assert.match(html, /输入股票查看最近 8 个单季度/);
  assert.match(html, /获取行情 \+ 基本面 \+ 新闻/);
  assert.doesNotMatch(html, /type="file"/i);
  assert.doesNotMatch(html, /导入(?:行情|新闻)/);
  assert.doesNotMatch(html, /\[object Object\]/);
});
