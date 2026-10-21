# 代码与功能地图

本地图回答“功能在哪里、沿什么路径读、已有哪类回归测试”。行为约束与研究问题见 [功能研究地图](./feature-research-map.md) 和 [领域约束](./ai/domain-invariants.md)。核验日期：2026-10-13；依据当前源码与 GitNexus 调用关系，不代表线上数据源可用性。

## 使用方式

1. 按下面的 F01–F13 找到目标功能，先读页面入口、领域模块、对应测试。
2. 用 GitNexus `query` 查执行流，`context` 查精确符号；同名符号带文件路径消歧。修改函数前按 [AGENTS.md](../AGENTS.md) 执行 `impact`。
3. 再按依赖补读 API 契约、账户同步或数据源模块；不必从大页面头到尾读完。
4. 改变路径、职责、接口或行为后，同步本地图和 [文档同步规则](./ai/documentation-maintenance.md) 中对应文档。

**路径约定**：下文 `app/`、`tests/`、`db/`、`worker/`、`scripts/` 均相对于 [`web/`](../web/)；`/api/...` 是 HTTP 路径，其实现位于 `web/app/api/<名称>/route.ts`。测试表列的是优先入口，不是覆盖率证明。

## 目录与职责

| 仓库路径 | 责任与阅读边界 |
| --- | --- |
| `web/app/page.tsx` | 首页、访客查询、个股工作区的状态与请求编排；含行情/财务/新闻并发加载、导出与动态面板加载。改局部功能先找相应回调和子组件。 |
| `web/app/layout.tsx`、`web/middleware.ts` | 全局 Provider、样式与元数据；请求级账户访问控制。 |
| `web/app/components/` | 图表、财务、组合、导航、认证等可复用面板；目录名不代表所有文件只负责展示。 |
| `web/app/features/` | `stock` 的模型挂载与笔记样式；`portfolio` 列表；`screener` 研究池/证据；`global-markets` 地图/概览；`review` 复盘编辑与策略库。 |
| `web/app/hooks/` | 工作区视图同步、打印生命周期、持仓收益观察记录。 |
| `web/app/lib/` | 同时含领域计算、解析器、浏览器状态和服务端数据客户端；先核对 imports，不能把整个目录当成纯浏览器库。 |
| `web/app/api/` | 请求方法/参数/大小校验、同域响应契约、上游访问与 D1 读写入口。 |
| `web/db/`、`web/drizzle/` | D1 连接、Drizzle schema、按序 SQL 迁移；字段变化必须同时考虑存量数据。 |
| `web/tests/` | Node `node:test` 回归；混合纯函数、模拟网络、受控组件执行、源码约束和构建产物检查。 |
| `web/scripts/`、`web/reports/` | 回测/训练/本地迁移脚本，以及带日期的实验报告；不是线上定时任务。 |
| `web/worker/`、`web/plugins/`、`web/vite.config.ts` | vinext / Vite / Cloudflare Worker 与托管集成。 |
| `docs/`、`.github/`、`Makefile` | 当前技术契约/历史记录、CI/协作模板、仓库级开发命令。 |

## 功能 → 实现 → 回归入口

| ID / 用户功能 | 页面与组件入口 | 领域逻辑、API 与依赖 | 优先查看的测试（`web/tests/`） |
| --- | --- | --- | --- |
| **F01 证券检索与导航** | `app/page.tsx` 的 `resolveStockQuery`；`components/GuestHome.tsx`、`SiteBanner.tsx`、`CommandPalette.tsx`；`hooks/useWorkspaceView.ts` | `lib/security.ts` 统一身份与 URL/存储键；`stockLookup.ts` / `usStockLookup.ts` → `/api/local-stock-lookup` / `/api/us-stock-lookup`；`workspaceNavigation.ts`、`financialNavigation.ts` 管理视图/锚点。 | `stock-lookup-route.test.mjs`、`us-stocks.test.mjs`、`workspace-navigation.test.mjs`、`information-architecture.test.mjs`、`mobile-banner-behavior.test.mjs` |
| **F02 历史行情与 K 线** | `app/page.tsx`；`components/MarketChart.tsx`（日 K 悬浮明细含距今涨跌幅）、`KlineViewportControls.tsx`；`components/StockWorkspace.module.css` 管理行情工作区与技术卡片布局 | `/api/local-stock-data` → `lib/remoteMarket.ts`；`/api/us-stock-data` → `usStockMarket.ts`；`market.ts` 解析 CSV、聚合 K 线、计算指标；`chartInteraction.ts` / `klineViewport.ts` 交互；`browserCache.ts` 只读回退。 | `remote-market.test.mjs`、`market-parser.test.mjs`、`kline-viewport.test.mjs`、`kline-interactions.test.mjs`、`chart-interaction.test.mjs`、`daily-k-hover.test.mjs`；布局另做浏览器桌面/移动验收 |
| **F03 实时行情与成交下载** | `app/page.tsx` 实时轮询；`components/RealtimeTradingPanel.tsx` | `/api/realtime-market` → `lib/realtimeMarket.ts`；`/api/us-stock-realtime` → `usStockRealtime.ts`；`/api/local-stock-trades` → `dailyTrades.ts`；`cnTradingSession.ts`、`realtimeDailyCandle.ts`、`closedMarketDay.ts`、`realtimeSignals.ts` 管理时段、日线合并与盘中信号。 | `realtime-market.test.mjs`、`daily-trades-fetch.test.mjs`、`daily-trades.test.mjs`、`cn-trading-session.test.mjs`、`realtime-daily-candle.test.mjs`、`closed-market-day.test.mjs` |
| **F04 财务诊断** | `app/page.tsx`；`components/FinancialDashboard.tsx`、`FinancialChart.tsx` | `/api/local-stock-financials` → `lib/financials.ts` → `financialAnalysis.ts`；`/api/us-stock-financials` → `usStockFinancials.ts`；后者将 SEC 申报映射到共享分析类型。 | `financials.test.mjs`、`financial-analysis.test.mjs`、`us-stocks.test.mjs` |
| **F05 新闻与情绪** | `app/page.tsx` 的新闻加载/列表；组合新闻输入在 `components/PortfolioHome.tsx` | `/api/local-stock-news` → `lib/remoteNews.ts`；`/api/us-stock-news` → `usStockNews.ts`；`stockNewsFallback.ts` 为检索失败提供回退；`news.ts` 解析、去重、分类与汇总。 | `news-parser.test.mjs`、`us-stock-news.test.mjs`、`api-route-contracts.test.mjs` |
| **F06 自选与持仓组合** | `components/PortfolioHome.tsx`、`PortfolioWorkbenchSummary.tsx`；`features/portfolio/PortfolioStockList.tsx` | `lib/watchlist.ts`、`holdings.ts` 管理身份、数量/成本、CSV 与汇总；`portfolioPresentation.ts`、`portfolioWorkbench.ts`、`portfolioPrediction.ts` 生成展示数据；`portfolioRealtimePoller.ts` 独立处理每个报价；通过 F13 保存。 | `watchlist.test.mjs`、`holdings.test.mjs`、`holdings-independence.test.mjs`、`portfolio-realtime-poller.test.mjs`、`portfolio-workbench.test.mjs`、`portfolio-stock-list.test.mjs`、`portfolio-score-popover.test.mjs` |
| **F07 持仓收益与风控** | `hooks/usePortfolioEarningsRecorder.ts`；`components/PortfolioEarnings.tsx`、`HoldingProfitCard.tsx`、`HoldingRiskSummary.tsx`；`MarketChart.tsx` 风险线 | `lib/portfolioEarnings.ts` 记录已观察日收益并按币种汇总；`holdingRisk.ts` 计算持仓成本/ATR/支撑压力参考；收益记录由组合生命周期驱动，通过 F13 保存。 | `portfolio-earnings.test.mjs`、`portfolio-earnings-recorder.test.mjs`、`holding-risk.test.mjs`、`portfolio-position-cleanup.test.mjs` |
| **F08 评分、信号与隔日统计** | `components/StockScoreCard.tsx`、`NextDayPredictionCard.tsx`、`SignalBacktestCard.tsx`、`AdvancedResearchPanel.tsx`；`features/stock/StockModelContent.tsx` 延迟挂载；`components/StockWorkspace.module.css` 管理模型面板单列布局 | `lib/stockScore.ts`、`market.ts`、`nextDayPrediction.ts`、`nextDayPanelModel.ts` / `nextDayPanelArtifact.json`、`research.ts`、`advancedResearch.ts`；同一预测入口也被组合页调用。 | `stock-score.test.mjs`、`bs-signal-v2.test.mjs`、`next-day-prediction.test.mjs`、`portfolio-prediction.test.mjs`、`research-tools.test.mjs`、`stock-model-lifecycle.test.mjs`；模型布局另做基础/专业视图浏览器验收 |
| **F09 研究记录、历史标注与导出** | `app/page.tsx` 的 `notes` 面板实际挂载 `features/review/StockReviewEntry.tsx`，界面名“交易复盘”；新建/编辑进入 `/review` 的 `ReviewEditor.tsx`。`page.tsx` 保留保存/恢复视图及导出回调；`hooks/useResearchPrint.ts` 打印。 | `StockReviewEntry` 按市场/证券读取共享复盘，展开“研究工具与历史记录”访问工具、旧标注及旧投资备忘录；历史数据由 `accountStorage` 读取。`components/ResearchDock.tsx` 与 `features/stock/ResearchNotes.module.css` 是保留的旧实现，当前页面未挂载；旧 `/api/research-state` 亦独立保留。 | `stock-review-entry.test.mjs` 验证当前挂载与历史读取；`review-editor.test.mjs`、`research-print.test.mjs`、`research-tools.test.mjs`、`research-state-route.test.mjs`、`research-state-concurrency.test.mjs`；`research-notes.test.mjs` 仅验证旧组件，不证明当前可见入口。 |
| **F10 智能选股** | `/screener` → `app/screener/page.tsx`；`features/screener/ResearchPoolView.tsx`、`StrategyEvidenceView.tsx` | `GET /api/screener?market=CN\|US` → `lib/screenerData.ts`；共享契约 `screenerTypes.ts`；页面筛选、研究池、预设和自选通过 F13 保存。 | `screener-data.test.mjs`、`screener-page.test.mjs`、`screener-security-filter.test.mjs`、`screener-views.test.mjs` |
| **F11 全球市场** | `/global-markets` → `app/global-markets/page.tsx`；`features/global-markets/MarketOverview.tsx`、`MarketMap.tsx` | `GET /api/global-indexes` → `lib/globalIndexes.ts` / `usMarketIndexes.ts`；`robinsonProjection.ts` 与 `web/public/world-map-robinson.svg` 支持地图；首页也消费全球指数。 | `global-indexes.test.mjs`、`fear-gauges.test.mjs`、`robinson-projection.test.mjs`、`global-layout.test.mjs` |
| **F12 交易复盘** | `/review` → `app/review/page.tsx` → `features/review/ReviewWorkspace.tsx`；`ReviewWorkspace.module.css` 管理与 banner 对齐的正文宽度及备份操作布局；同目录 `ReviewEditor.tsx`、`ReviewDialog.tsx`、`StrategyLibrary.tsx`、`StockReviewEntry.tsx` | `lib/tradingJournal.ts` 定义记录、规则、策略快照、解析/验证/合并；`features/review/reviewValidation.ts`、`useReviewQuotes.ts` 负责编辑边界与行情补充；草稿/历史通过 F13 保存。 | `trading-journal.test.mjs`、`review-workspace.test.mjs`、`review-editor.test.mjs`、`review-strategies.test.mjs`、`review-account-database.test.mjs`、`review-quotes.test.mjs`；布局验收见 [复盘专题](trading-review.md#验证) |
| **F13 账户与状态同步** | `/login`、`/register`、`/account`；`components/AuthProvider.tsx`、`AuthForm.tsx`、`AccountProfile.tsx`；`web/middleware.ts` | `lib/authClient.ts` / `authServer.ts` / `accessPolicy.ts` / `serverIdentity.ts`；`/api/auth/*`；`lib/accountStorage.ts` / `accountData.ts` → `/api/account-data` → `db/accountSchema.ts`；用户/会话在 `db/schema.ts`。 | `auth.test.mjs`、`auth-client.test.mjs`、`account-access-policy.test.mjs`、`account-data.test.mjs`、`review-account-database.test.mjs` |

## 五条关键调用链

### 个股查询与数据隔离（F01–F05）

```text
app/page.tsx: resolveStockQuery
  → CN/US 身份与端点选择
  → 并发加载历史行情 CSV / 新闻 CSV / 财务 JSON
      → API 路由参数校验 → 对应 lib 服务端客户端 → 公开上游
      → parseMarketCsv / parseNewsCsv / FinancialDataset
  → 各面板独立更新，requestVersion 与 AbortController 阻止旧查询回写
  → 实时快照走独立轮询，再由日线合并模块协调当前交易日
```

`remoteMarket.ts: fetchRemoteMarketCsv` 调用日 K、复权因子、市场概要和名称解析，再输出代理 CSV。`market.ts: aggregateCandles` 是行情转换为图表/研究输入的重要边界。协议细节查 [数据契约](./data-formats.md)。

### 登录、加载与个人数据保存（F13，影响 F06/F07/F09/F10/F12）

```text
layout.tsx → AuthProvider → GET /api/auth/me
  → hydrateAccountStorage(userId) → GET /api/account-data
  → 账户数据就绪后挂载个人界面
  → accountStorage.setItem → 待写队列 → PUT /api/account-data
  → 校验会话用户、数据键、revision、mutationId → D1 account_data
```

`accountStorage` 是页面内存接口，不是 `localStorage`；持久化由服务器负责。数据库主键是 `(user_key, key)`，旧版本写入返回冲突，重试同一 mutation 可幂等确认。不要从历史名称 `holdings-local-only.test.mjs` 推断当前持仓仅在本地。

### 组合报价、收益观察与风险参考（F06/F07）

```text
PortfolioHome → watchlist + holdings → 历史报价/新闻/模型输入
  → createPortfolioRealtimePoller.refresh → 每支证券独立报价成功/失败
  → usePortfolioEarningsRecorder → recordPortfolioEarnings → accountStorage
  → PortfolioEarnings 展示日/月记录
个股持仓 + K 线 → buildHoldingRiskPlan → 风险摘要 + 图表参考线
```

收益观察由工作区拥有，打开收益日历不是开始记录的条件。组合页面、个股图表、复盘记录是不同领域：不要把修改复盘记录当成自动修改持仓。

### 模型、评分与回测（F08）

```text
K 线 + 指标 + 财务/新闻/基准 → buildStockScore
K 线 + 市场/新闻时点 + 实时快照 → buildNextDayPrediction
  → preparePredictionInput / predictNextDayPanelProbability → 统计结果与验证状态
K 线 + guidePoints → backtestGuideSignals → SignalBacktestCard
风险/因子/事件计算 → AdvancedResearchPanel
```

`buildNextDayPrediction` 同时服务 `NextDayPredictionCard` 与 `PortfolioHome`；不能只验证个股卡片。实验重跑入口见 `scripts/backtest-next-day-prediction.mjs`、`train-next-day-panel-model.mjs`、`backtest-bs-portfolio.mjs`；执行条件见 [验证指南](./ai/verification.md)。

### 复盘编辑与持久化（F12/F13）

```text
ReviewWorkspace → readJournal(accountStorage) → 记录/策略/规则视图
  → ReviewEditor + reviewValidation → validateReviewEntry
  → saveJournal / 草稿键 → accountStorage → account-data API
  → API 再次 parseJournal 校验 → D1
备份 JSON → parseJournal / mergeJournal → 用户确认的导入结果
```

编辑草稿、已保存记录和历史规则快照分别处理；同页编辑冲突与数据库 revision 冲突也分别处理。详细行为见 [交易复盘说明](./trading-review.md)。

## 横切基础设施与易遗漏入口

| 任务 | 优先入口 | 回归关注 |
| --- | --- | --- |
| 基础/专业视图、导航状态 | `lib/viewMode.ts`、`hooks/useWorkspaceView.ts`、`components/WorkspaceTabs.tsx`、`WorkspaceTabs.module.css`、`WorkspaceTabIcon.tsx`、`useWorkspaceTabIndicator.ts`、`StockWorkspaceHeader.tsx` | `workspace-navigation.test.mjs`、`workspace-tab-indicator.test.mjs`、`information-architecture.test.mjs`；共享子导航分别适配日夜模式，滑块中断时保留速度，减少动态效果时直接定位；隐藏面板保持挂载，恢复显示和尺寸变化后重新测量。 |
| 主题与全站样式 | `app/layout.tsx`；`components/AppearanceProvider.tsx`、`ThemeIconSync.tsx`；`lib/appearance.ts`；`app/globals.css`、`apple.css`、`apple-refinement.css`、`experience.css`、`mobile.css`；组合通知在 `components/PortfolioHome.module.css` 的 `.toast` | `appearance-continuity.test.mjs`、`mobile-layout.test.mjs`、`ux-release-guardrails.test.mjs`；同时检查 CSS Modules 与全局覆盖；`mobile.css` 及各模块新增手机规则限于 820px 以下。`lib/mobileNavigation.ts` 提供 banner 96/24px 滚动滞回，`SiteBanner` 接收 `trendsight:open-search` 事件，子导航使用 `--mobile-banner-offset`。产品清单/验收入口见 [手机体验说明](mobile-ux-product-spec.md)。通知背景使用 `--portfolio-surface-solid`、正文使用 `--portfolio-text`，不得用文字色覆盖背景；验证日夜两种主题与关闭按钮可读性。 |
| 缓存/失败回退 | `lib/browserCache.ts`、`app/page.tsx` 请求分支、各服务端客户端 | 缓存命中、网络异常、上游状态错误语义不同；旧数据必须保留身份和来源提示。 |
| 匿名聚合遥测 | `lib/telemetry.ts` → `app/api/telemetry/route.ts` → `db/schema.ts: telemetryDaily` | `api-route-contracts.test.mjs`；只接收白名单事件聚合，不扩展成个人研究内容采集。 |
| 旧研究状态兼容 | `app/api/research-state/route.ts`、`db/schema.ts: researchStates` | `research-state-route.test.mjs`、`research-state-concurrency.test.mjs`、`holdings-local-only.test.mjs`；不与账户数据主通道混写。 |
| 构建与本地 D1 | `web/package.json`、`web/vite.config.ts`、`web/worker/index.ts`、`web/scripts/migrate-local-d1.mjs`、`Makefile` | `pnpm test` 先构建；单测按 [验证指南](./ai/verification.md) 区分是否依赖产物。 |

## 本地图的维护边界

- 功能 ID 保持稳定；移动代码时更新路径与调用链，不因展示名称变化随意重新编号。
- 新增页面、API、存储键或跨功能依赖时，在对应行补充入口和验证路径；新增业务口径写入 [功能研究地图](./feature-research-map.md) 与 [领域约束](./ai/domain-invariants.md)。
- `docs/` 和 `web/reports/` 下带日期的验证报告是历史证据，不能覆盖本地图中的当前实现；冲突时重新读源码并记录核验日期。
