# 功能研究与排障地图

这是**现有实现的研究路径**，不是待开发功能清单或产品路线图。功能编号与[代码与功能地图](code-map.md)一致；先用代码地图定位，再按本页收集证据，不必一次加载全部模块。跨功能约束见[领域约束](ai/domain-invariants.md)，开发与验证命令见[贡献指南](../CONTRIBUTING.md)。

路径约定：`app/`、`api/`、`db/` 等入口按 [代码地图](code-map.md) 解析；裸文件名从该功能行定位，测试文件均在 `web/tests/`。本页的证据步骤是建议执行的验证，不代表本次文档整理已运行全部测试。

## 使用方法

1. 明确功能编号、市场、证券键、日期、登录状态和期望行为；生产问题先保存脱敏后的实际请求、响应及错误。
2. 用 GitNexus `query` 找执行流、`context` 看关键符号，然后按下列顺序读源码；修改符号前执行 `impact`，遵守根 [AGENTS.md](../AGENTS.md)。
3. 对照“输入 → 归一化模型 → 计算结果 → 展示/保存”找首次偏差；区分上游缺失、解析失败、模型不可用和 UI 未展示。
4. 测试名表示可复用的验证入口，不表示本次已经运行。修改后记录实际命令、结果与未覆盖边界，并按[同步规则](ai/documentation-maintenance.md)更新相关文档。

## F01 证券检索与导航

- **研究问题**：简称/代码为何找不到、A 股与美股为何串股、链接/返回为何丢失工作区？
- **读取顺序**：[security.ts](../web/app/lib/security.ts) → [workspaceNavigation.ts](../web/app/lib/workspaceNavigation.ts) → `stockLookup.ts` / `usStockLookup.ts` → `app/page.tsx` 查询入口。
- **数据流与口径**：符合格式的 A 股代码直接规范化为 CN 身份并请求行情，名称及美股输入经过检索；A 股规范化为六位代码，美股路由为 `US:<SYMBOL>`。格式通过不等于行情存在，不能仅因字符串像美股 ticker 就确认有效证券。
- **证据**：比较请求市场、规范化代码、API 返回身份和最终路由；运行 `stock-lookup-route.test.mjs`、`us-stocks.test.mjs`、`workspace-navigation.test.mjs`。
- **边界**：未知代码、接口失败、旧 A 股记录分别处理；不要用美股检索结果填充 A 股缓存。
- **手机导航**：≤820px 的搜索由放大镜展开原表单，关闭/遮罩/Escape 后归还焦点；搜索结果与 CN/US 解析仍用原链路。页面滚动超过 96px 显示头像、页面链接与搜索的精简栏，回到 24px 内恢复完整栏，中间区间保持状态。正文占位不随收缩改变，`WorkspaceTabs` 的 sticky 偏移按 banner 状态切换。首次搜索引导通过 `trendsight:open-search` 展开面板，不能直接聚焦隐藏输入框。参见 [50项手机优化](mobile-ux-product-spec.md)、[测试方案](mobile-ux-test-plan.md) 与 [验收记录](mobile-ux-acceptance.md)。

## F02 历史行情与 K 线

- **研究问题**：价格/成交量/换手率为何不同、当天 K 线何时出现、缩放和悬浮位置为何错位？
- **读取顺序**：[数据格式](data-formats.md) → `remoteMarket.ts` / `usStockMarket.ts` → [market.ts](../web/app/lib/market.ts) → `realtimeDailyCandle.ts` / `closedMarketDay.ts` → `MarketChart.tsx`。
- **数据流与口径**：上游日 K → 带 `#META/#DAY` 的 CSV → 解析/聚合 → 指标 → 图表；实时快照补当天数据时必须检查证券、日期、复权因子及是否收盘。
- **证据**：保留 CSV 元数据与异常日期原始行；运行 `remote-market.test.mjs`、`market-parser.test.mjs`、`realtime-daily-candle.test.mjs`、`closed-market-day.test.mjs`；交互再选 `kline-viewport.test.mjs`、`chart-interaction.test.mjs`。
- **边界**：日 K 的四个合成点不是真实逐笔或分钟交易；缺同日流通股本时历史换手率留空。
- **悬浮距今涨跌幅**：`MarketChart.tsx` 日 K 明细显示 `(完整日线序列末根 close / 悬浮日 close - 1) × 100%`，与图表使用相同价格/复权口径；不以当前可视区末根为终点，不混用原始实时报价。显示末根交易日期，盘中已合并日线时随最新价更新；最新根为 `0.00%`，无效或非正价格显示 `—`，分钟 K 不显示此项。`daily-k-hover.test.mjs` 覆盖计算、历史视窗、缺失值与周期边界。
- **布局排障**：行情图表、K 线研判与折叠技术区由 `StockWorkspace.module.css` 的嵌套网格排列；卡片必须在模块内重置 `grid-area`，避免 `globals.css` / `apple.css` 的旧十二列定位产生隐式列。技术区在大于 900px、621–900px、至多 620px 时分别为三列、两列、单列；主力行为卡片仅在多列时跨两列。浏览器核对基础/专业视图、折叠开关及各断点的实际卡片边界，源码断言不能代替布局验收。

## F03 实时行情与成交下载

- **研究问题**：为何盘口为空、行情刷新停顿、午休状态不对、成交下载缺行或降级？
- **读取顺序**：[realtimeMarket.ts](../web/app/lib/realtimeMarket.ts) / `usStockRealtime.ts` → `cnTradingSession.ts` → `dailyTrades.ts` → `RealtimeTradingPanel.tsx`；组合轮询另读 `portfolioRealtimePoller.ts`。
- **数据流与口径**：服务端快照/分钟线 → 市场时段归一化 → 轮询展示；单日明细独立走 `/api/local-stock-trades`，主源失败可降级备用源。
- **证据**：保存 `source/date/time/fetchedAt`、数据级别与降级说明；运行 `realtime-market.test.mjs`、`cn-trading-session.test.mjs`、`daily-trades.test.mjs`、`daily-trades-fetch.test.mjs`。
- **边界**：美股源没有分钟线/五档时返回空数组；Level-1 切片可聚合多笔成交，不能标成 Level-2；抓取时钟不能冒充交易所成交时钟。

## F04 财务诊断

- **研究问题**：累计值与单季值为何不同、TTM/同比为何为空、银行现金流或美股财政年度为何特殊？
- **读取顺序**：[financials.ts](../web/app/lib/financials.ts) / `usStockFinancials.ts` → [financialAnalysis.ts](../web/app/lib/financialAnalysis.ts) → `FinancialDashboard.tsx`；既有校验背景见[财务校验记录](financial-validation-2026-08-19.md)。
- **数据流与口径**：原始报表按报告期对齐 → 流量指标拆单季/合并 TTM → 期末资产负债指标 → 诊断；估值快照、报告期、公告/申报日分别保留。
- **证据**：记录上游字段、财政年度、报告期、公告日、单位与缺失项；运行 `financials.test.mjs`、`financial-analysis.test.mjs`、`us-stocks.test.mjs`。
- **边界**：缺少前季或连续季度不得补零；亏损期现金覆盖率与薄净资产 ROE 不能按普通健康指标解释；SEC 数据不等于实时机构持仓。

## F05 新闻与情绪

- **研究问题**：新闻是否属于当前股票、为何缺失/重复、情绪如何得出、缓存或备用结果来自哪里？
- **读取顺序**：[remoteNews.ts](../web/app/lib/remoteNews.ts) / `usStockNews.ts` → `stockNewsFallback.ts` → `news.ts` → `app/page.tsx` 新闻加载任务。
- **数据流与口径**：公开检索 → 相关性/去重/规则情绪 → CSV → 新闻模型；保留发布时间、采集时间、链接和来源，预测侧另按截止日筛选。
- **证据**：比对原文标题、股票身份、解析结果和降级提示；运行 `news-parser.test.mjs`、`us-stock-news.test.mjs`、`api-route-contracts.test.mjs`。
- **边界**：关键词情绪不是事件理解或收益预测；过期缓存与实时结果必须可区分，第三方失败不能拖垮其他数据区。

## F06 自选与持仓组合

- **研究问题**：删除自选为何仍应保留持仓、导入后少了证券、跨市场人民币合计如何形成？
- **读取顺序**：[holdings.ts](../web/app/lib/holdings.ts) → [watchlist.ts](../web/app/lib/watchlist.ts) → `portfolioPresentation.ts` → `PortfolioHome.tsx` → F13 同步链路。
- **数据流与口径**：账户自选与持仓独立加载 → 证券键并集去重 → 原币汇总 → 按显式汇率额外展示人民币总计；折算不改写原始持仓。
- **证据**：核对存储键、CSV 行、持仓并集、原币金额与汇率来源；运行 `holdings.test.mjs`、`holdings-independence.test.mjs`、`watchlist.test.mjs`、`portfolio-presentation.test.mjs`。
- **边界**：自选 50 条限制不能截断独立持仓；缺行情不应显示成已确认的零盈亏；汇率是可编辑的展示参数，不是自动取得的实时汇率。

## F07 持仓收益与风控

- **研究问题**：收益日历为何空白/失效、刷新为何不应补历史、盘中价格为何不能移动止损参考线？
- **读取顺序**：[portfolioEarnings.ts](../web/app/lib/portfolioEarnings.ts) → `usePortfolioEarningsRecorder.ts` → [holdingRisk.ts](../web/app/lib/holdingRisk.ts) → `PortfolioEarnings.tsx` / `HoldingRiskSummary.tsx`。
- **数据流与口径**：同一市场日有效报价与持仓签名 → 当日估算记录；完整日 K 的 ATR/支撑压力 + 原始成本/复权因子 → 风控参考线。
- **证据**：记录市场时区、行情日、持仓变更时间、`estimated/holdings_changed/incomplete_quotes` 状态；运行 `portfolio-earnings.test.mjs`、`portfolio-earnings-recorder.test.mjs`、`holding-risk.test.mjs`。
- **边界**：这是观察到的持仓日盈亏估算，不是成交账本；不回填未观察日期、不跨币种加总；价格口径不兼容或日线不足时参考线不可用。

## F08 评分、信号与隔日统计

- **研究问题**：B/S 信号何时确认、回测为何跳过/延期退出、今日与明日模式是否混入目标日数据？
- **读取顺序**：[market.ts](../web/app/lib/market.ts) → `research.ts` / `stockScore.ts` → [nextDayPrediction.ts](../web/app/lib/nextDayPrediction.ts) → `nextDayPanelModel.ts` → 对应卡片与 `web/scripts/` 回测/训练脚本。
- **数据流与口径**：已知历史窗口 → 技术特征/信号 → 下一根成交模拟或滚动训练；面板模型与校准各自受训练截止日限制，新闻受预测截止日限制。
- **证据**：固定输入切片、市场、基准、成本、模式、模型版本和训练截止日；运行 `bs-signal-v2.test.mjs`、`research-tools.test.mjs`、`stock-score.test.mjs`、`next-day-prediction.test.mjs`。
- **边界**：追加未来 K 线不应改变已确认历史信号；不删除受阻/亏损退出样本；评分不是上涨概率，历史报告结论不能当成当前版本的已验证表现。
- **布局排障**：`StockModelContent` 直接返回子组件，预测、B/S 回测和高级研究卡是 `StockWorkspace.module.css` 中 `.models` 的直接网格项。面板使用单列并统一重置子项 `grid-area`，间距由 `gap` 管理；不能沿用回测卡在旧页面中的 `1 / 13` 列、第四行定位。基础视图隐藏回测卡，验证必须覆盖专业视图三卡展示、切换标签后恢复、桌面与手机宽度。

## F09 研究记录、历史标注与导出

- **研究问题**：旧标注/投资备忘录是否收在历史记录中，个股复盘是否隔离市场与证券，保存视图/打印为何丢布局，旧研究接口如何兼容？
- **读取顺序**：[page.tsx](../web/app/page.tsx) 的 `WorkspacePanel view="notes"` → [StockReviewEntry.tsx](../web/app/features/review/StockReviewEntry.tsx) → `/review` 的 [ReviewEditor.tsx](../web/app/features/review/ReviewEditor.tsx)；研究工具回调回到 `page.tsx` 的保存/恢复/导出与 `useResearchPrint.ts` → F13。旧接口另读 `api/research-state/route.ts`。
- **当前数据流**：界面中的“交易复盘”展示共享 journal 内本市场/证券的记录；新建/编辑链接进入复盘中心，复盘正文和草稿由 F12/F13 保存。“研究工具与历史记录”内联折叠区展示保存视图、恢复视图、导出报告、打印/PDF，以及已有标注和 `ticklens.investment-memo.v1:${code}` 历史备忘录；折叠不代表数据丢失。
- **旧实现边界**：[ResearchDock.tsx](../web/app/components/ResearchDock.tsx) 和 `features/stock/ResearchNotes.module.css` 仍保留在仓库，但当前 `page.tsx` 未导入或挂载该组件。其编辑/更多菜单源码及 `research-notes.test.mjs` 的独立组件测试是历史实现证据，不能当作当前页面入口或手机优化已生效的证据；先核对实际挂载再修改样式。历史账户键不因界面迁移而批量重命名。
- **证据**：运行 `stock-review-entry.test.mjs` 检查市场/证券隔离、历史备忘录读取及 `page.tsx → StockReviewEntry` 挂载约束；编辑检查 `review-editor.test.mjs`；导出/打印和同步检查 `research-print.test.mjs`、`research-cloud-sync.test.mjs`、`research-state-concurrency.test.mjs`。浏览器展开实际历史工具区，并检查真实复盘 textarea 的计算样式；不能只检测 CSS 文本。
- **移动样式排障**：当前长文编辑规则在 `ReviewEditor.module.css`，工具区规则在 `StockReviewEntry.module.css`。父工作区 CSS Module 的后注入规则可能覆盖同权重声明；使用语义字段选择器限定手机修复，并在浏览器测量最终字号/高度。2026-10-13 修复证据见 [手机验收记录](mobile-ux-acceptance.md) 的 BUG-MOBILE-07/08。
- **兼容边界**：旧 `research_states` 是兼容链路，不能替代当前个人数据入口；旧持仓清理不能覆盖同时发生的新写入，也不能从共享浏览器状态复活删除项。

## F10 智能选股

- **研究问题**：候选为何被过滤、A/美股扫描覆盖是否一致、研究池与策略证据为何不同？
- **读取顺序**：[screenerTypes.ts](../web/app/lib/screenerTypes.ts) → [screenerData.ts](../web/app/lib/screenerData.ts) → `app/screener/page.tsx` → `ResearchPoolView.tsx` / `StrategyEvidenceView.tsx`。
- **数据流与口径**：行情列表 → 质量/规则预筛 → 日 K 丰富与评分 → 候选/滚动证据；研究池和界面偏好经账户保存。
- **证据**：保留市场、扫描/质量/预筛数量、缺失数据及规则原因；运行 `screener-data.test.mjs`、`screener-security-filter.test.mjs`、`screener-views.test.mjs`。
- **边界**：美股输入是涨幅榜样本，不是全市场广度；确定性置信度不是校准概率；“吸筹/主升”等标签是价格行为规则，不能证明账户身份。

## F11 全球市场

- **研究问题**：全球状态是否按当地时间、美股盘后为何显示 ETF/期货、两市成交额/恐慌指数为何不同口径？
- **读取顺序**：[globalIndexes.ts](../web/app/lib/globalIndexes.ts) → `usMarketIndexes.ts` → `app/features/global-markets/` → `/api/global-indexes`。
- **数据流与口径**：指数目录和公开报价 → 各市场时区/交易阶段 → 地图与概览；沪深成交额只按共同交易日求和，扩展时段代理与现货收盘分列。
- **证据**：保存指数 ID、来源、时区、获取时间及现货/代理标记；运行 `global-indexes.test.mjs`、`fear-gauges.test.mjs`、`global-layout.test.mjs`。
- **边界**：不要把 ETF/期货代理写成现货指数新成交，不要把自算压力代理写成官方 VIX；时段规则不等同于完整交易所假日日历。

## F12 交易复盘

- **研究问题**：草稿为何不能完成、操作后涨跌为何不同于实际收益、改策略后历史规则是否改变、导入冲突如何保留？
- **读取顺序**：[交易复盘说明](trading-review.md) → [tradingJournal.ts](../web/app/lib/tradingJournal.ts) → `reviewValidation.ts` / `useReviewQuotes.ts` → `ReviewEditor.tsx` / `ReviewWorkspace.tsx` → F13。
- **数据流与口径**：编辑草稿 → 业务校验 → 复盘/规则/策略快照 → 逐键保存；标的涨跌与手填成交净盈亏独立计算。
- **证据**：记录草稿/完成状态、费用是否已知、策略快照、编辑基线和保存响应；运行 `trading-journal.test.mjs`、`review-quotes.test.mjs`、`review-editor.test.mjs`、`review-strategies.test.mjs`、`review-account-database.test.mjs`。
- **边界**：费用未知不是零，未平仓不是已实现收益；合并导入不清空历史，同 ID 冲突保留现有数据；完成保存要等数据库确认。

## F13 账户与状态同步

- **研究问题**：为何 401/409、换号后旧数据闪回、响应丢失后重试是否重复写、编辑是否真正落库？
- **读取顺序**：[AuthProvider.tsx](../web/app/components/AuthProvider.tsx) → `authServer.ts` / `serverIdentity.ts` → [accountStorage.ts](../web/app/lib/accountStorage.ts) → `api/account-data/route.ts` → `db/accountSchema.ts`。
- **数据流与口径**：数据库会话确认身份 → 账户 hydrate → 内存 facade 待写队列 → `user_key + key + revision` 条件更新；`mutationId` 识别响应丢失后的同一次写入。
- **证据**：只保留脱敏用户标识、数据键、revision、mutationId 和错误码，勿记录密码、cookie、复盘正文；运行 `auth.test.mjs`、`account-data.test.mjs`、`research-cloud-sync.test.mjs`、`account-access-policy.test.mjs`。
- **边界**：请求体 userId 不能授权身份；409 需保留编辑并重新加载合并，不能强制覆盖；晚到的旧账号响应不能写入新账号状态。

## 常见跨功能研究顺序

| 症状 | 优先排查 |
| --- | --- |
| 同一股票多个页面数值不一致 | F01 身份 → F02/F03 日期与价格口径 → F06/F07 汇总，不先修改格式化函数 |
| 股票页正常但预测/风控不可用 | F02 完整日线与复权 → F08 训练条件 / F07 数据门槛 |
| 登录后保存丢失或换设备不一致 | F13 身份/hydrate/冲突 → 对应功能存储键 → UI 保存确认 |
| 回测结果变好但无法解释 | F08 时间切片/成本/受阻成交 → 模型版本 → 重新生成可复现证据 |

新发现应写入对应专题文档或领域约束；本页只保留问题入口和证据路径，避免积累一次性日志、未经证实的根因或重复源码说明。
