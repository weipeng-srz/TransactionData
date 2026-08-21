import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/screener/page.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../app/screener/screener.module.css", import.meta.url), "utf8");
const bannerSource = readFileSync(new URL("../app/components/SiteBanner.tsx", import.meta.url), "utf8");

test("screener exposes the requested A-share and US strategy surfaces", () => {
  for (const label of ["A股", "美股", "今日精选", "昨日涨停", "连板股", "趋势突破", "放量上涨", "Gap Up", "Momentum"]) {
    assert.match(pageSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("screener keeps scores explainable and risk-aware", () => {
  for (const label of ["因子拆解", "为什么进入候选池", "主要风险", "风险失效", "不建议当前位置追高", "模型置信度"]) {
    assert.match(pageSource, new RegExp(label));
  }
});

test("screener loads same-origin real market data and labels model-derived values", () => {
  assert.match(pageSource, /fetch\(`\/api\/screener\?market=\$\{market\}`/);
  assert.match(pageSource, /真实市场行情/);
  assert.match(pageSource, /公开免费行情可能延时/);
  assert.doesNotMatch(pageSource, /const opportunities:/);
  assert.doesNotMatch(pageSource, /产品演示样本|上涨样本概率/);
});

test("screener is linked from the shared site banner and supports responsive layouts", () => {
  assert.match(bannerSource, /href="\/screener"/);
  assert.match(bannerSource, /activePage === "screener"/);
  assert.match(styleSource, /@media \(max-width: 980px\)/);
  assert.match(styleSource, /@media \(max-width: 760px\)/);
  assert.match(styleSource, /@media \(max-width: 480px\)/);
});
