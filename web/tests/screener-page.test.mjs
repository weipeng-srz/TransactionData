import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/screener/page.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../app/screener/screener.module.css", import.meta.url), "utf8");
const bannerSource = readFileSync(new URL("../app/components/SiteBanner.tsx", import.meta.url), "utf8");

test("screener exposes the requested A-share and US strategy surfaces", () => {
  for (const label of ["A股", "美股", "今日精选", "主升扫描", "建仓观察", "昨日涨停", "连板股", "趋势突破", "放量上涨", "Gap Up", "Momentum"]) {
    assert.match(pageSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("screener explains and ranks main-uptrend and accumulation phase signals", () => {
  for (const label of ["行情阶段扫描", "主升行情", "建仓观察", "均线多头", "平台振幅收窄", "非统计概率", "不能证明机构或所谓主力正在买入", "主升与建仓迹象"]) {
    assert.match(pageSource, new RegExp(label));
  }
  assert.match(pageSource, /phaseAnalysis\.mainUptrend\.score/);
  assert.match(pageSource, /phaseAnalysis\.accumulation\.score/);
  assert.match(styleSource, /\.phaseScanner/);
  assert.match(styleSource, /\.phaseAssessmentGrid/);
});

test("screener keeps scores explainable and risk-aware", () => {
  for (const label of ["因子拆解", "为什么进入候选池", "主要风险", "风险失效", "不建议当前位置追高", "信号一致性"]) {
    assert.match(pageSource, new RegExp(label));
  }
});

test("screener exposes a calibrated eight-dimension high-score reference list", () => {
  assert.match(pageSource, /八维高分股票榜/);
  assert.match(pageSource, /highResearchStocks/);
  assert.match(pageSource, /researchScore\.coverage/);
  assert.match(pageSource, /完整八维分析/);
  assert.match(pageSource, /高分表示候选池内证据排序靠前，不是收益率或买入建议/);
  assert.match(styleSource, /researchScoreBoard/);
});

test("screener exposes professional evidence, coverage, sizing, filters, chart and research pool", () => {
  for (const label of ["策略历史表现", "数据覆盖与模型审计", "最高风险", "最低成交额", "最低盈亏比", "建议仓位上限", "相对强弱与交易参数", "研究观察池", "价格结构", "涨停质量"]) {
    assert.match(pageSource, new RegExp(label));
  }
  assert.match(pageSource, /qualityTier === "standard"/);
  assert.match(pageSource, /setMinimumAmount\(0\)/);
  assert.match(pageSource, /expandedQualityCount/);
  assert.match(styleSource, /\.coveragePanel/);
  assert.match(styleSource, /\.evidenceGrid/);
  assert.match(styleSource, /\.miniChart/);
});

test("screener prioritizes candidates and exposes complete professional UX workflows", () => {
  for (const label of [
    "先看候选，再看证据",
    "简洁模式",
    "专业模式",
    "当前条件",
    "恢复默认",
    "更新/重命名",
    "扩展池 · 含高风险证券",
    "候选横向比较",
    "恢复默认筛选",
    "事件次数不是独立证券数",
    "证据与风险",
    "交易计划",
    "撤销",
  ]) assert.match(pageSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(pageSource, /aria-pressed=\{professionalMode\}/);
  assert.match(pageSource, /aria-label=\{`查看\$\{stock\.name\}机会详情`\}/);
  assert.match(pageSource, /prefilterCount/);
  assert.match(styleSource, /\.decisionSticky \{[\s\S]*position: sticky/);
  assert.match(styleSource, /\.mobileOpportunityList/);
  assert.match(styleSource, /\.drawerTabs/);
  assert.match(styleSource, /\.methodDialog/);
  assert.match(styleSource, /--screener-risk-high/);
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

test("screener follows the shared segmented controls, data cards, and touch feedback", () => {
  assert.match(styleSource, /\.marketSwitch \{[\s\S]*background: var\(--apple-fill\)/);
  assert.match(styleSource, /\.marketSwitch \.active \{[\s\S]*background: var\(--apple-surface\)/);
  assert.match(styleSource, /\.strategyTabs \.activeTab \{[\s\S]*box-shadow:/);
  assert.match(styleSource, /\.marketStrip \{[\s\S]*border-radius: var\(--apple-radius-lg\)/);
  assert.match(styleSource, /\.cardMetrics > span \{[\s\S]*background: var\(--screener-raised\)/);
  assert.match(styleSource, /\.tradeDate button \{[\s\S]*min-height: 32px;[\s\S]*border-radius: 999px;[\s\S]*background: var\(--apple-surface\)/);
  assert.match(styleSource, /\.tradeDate button:hover:not\(:disabled\)/);
  assert.match(styleSource, /\.tradeDate button:disabled \{[\s\S]*background: var\(--apple-fill\)/);
  assert.match(styleSource, /\.page :where\(button, a, select, input\):focus-visible/);
  assert.match(styleSource, /\.page button:not\(:disabled\):active/);
  assert.match(styleSource, /@media \(max-width: 760px\)[\s\S]*\.rowAction \{ width: 44px; height: 44px; \}/);
});

test("manual refresh keeps the last verified feed visible while requesting fresh data", () => {
  assert.match(pageSource, /const refreshRequestedRef = useRef<ScreenerMarket \| null>\(null\)/);
  assert.match(pageSource, /const hadFeed = Boolean\(feeds\[market\]\)/);
  assert.match(pageSource, /if \(hadFeed\) setToast\(`\$\{message\}；已保留上次成功数据`\)/);
  assert.match(pageSource, /refreshRequestedRef\.current = market/);
  assert.doesNotMatch(pageSource, /setFeeds\(\(current\) => \(\{ \.\.\.current, \[market\]: undefined \}\)\)/);
  assert.match(pageSource, /刷新中，保留当前快照/);
  assert.match(pageSource, /disabled=\{isRefreshing\}/);
});
