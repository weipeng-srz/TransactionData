# 交易复盘与策略管理

入口为 `/review`，全站导航及个股研究记录均可进入。

## 使用流程

1. 新建交易复盘或观察记录，填写操作日期、买卖/加减仓/观察类型、股票与操作时价格。
2. 记录市场背景、决策依据、计划和实际成交、情绪、错误、经验、下一次行动与复核日期。允许先保存草稿。
3. 在复盘中选择交易策略，自动加入策略当前可用的规则；逐条记录遵守、违反或不适用，违反时填写原因。
4. 在复盘中自定义规则，或从经验提炼规则。填写触发条件、具体动作与失效条件，保存后返回本次检查。
5. 在交易策略页新增、搜索、编辑或停用策略，配置规则清单。规则库支持编辑、待验证、使用中、停用状态。
6. 在历史记录按股票、日期、状态、标签及到期复核筛选，回看操作后标的变化、实际交易结果与下一步计划。

## 数据与计算

- `operationPrice` 单独保留操作/观察时价格，与实际入场、平仓均价独立。
- 操作后涨跌 = 最新价 / 操作时价格 - 1。卖出后的上涨仍显示为标的上涨，不反转成做空收益。
- A 股与美股分别复用 `/api/realtime-market`、`/api/us-stock-realtime`。行情缺失、未来操作日期或行情日期早于操作日时，不计算操作后涨跌。
- 行情按未复权价格比较，不包含分红、拆股调整或交易费用。美股延时报价注明获取时间，不将抓取时钟包装成交易所报价时间。
- 实际净盈亏仅按手动录入的完整平仓数据及已确认费用计算。费用未知时不按零估算，未平仓不计已实现盈亏。CNY 与 USD 分开统计。
- 规则执行率只包括已完成复盘中的“遵守”和“违反”；待评价和不适用不进入分母。未评价样本显示为空，不展示虚假胜率。
- 复盘保留策略名称和规则文字/版本快照，后续策略改名或规则编辑不修改历史记录。

## 保存与恢复

- 完整复盘、策略及规则通过 `/api/account-data` 保存到 D1 `account_data` 表，键为 `trendsight.trading-journal.v1`，以真实登录用户的 `user_key` 隔离。跨设备登录同一账户可读取。
- 未提交的复盘编辑自动同步到当前账户的 `trendsight.review-draft.v1`，刷新后恢复中间输入状态。编辑采用独立弹卡，提交时自动定位首个错误并以红色边框标识；正式保存等待数据库响应后才关闭，失败保留编辑。
- 保存前检查编辑基线，并由服务端 revision 条件更新防止并发覆盖；mutationId 支持响应丢失后的幂等重试。检测到冲突时提示并保留编辑，不覆盖更新记录。
- 个股的「交易复盘」页签展示当前股票的记录、操作价及后续涨跌，并可直接新建或编辑复盘。原研究工具与历史标注保留在折叠区。
- 页面和弹卡均随视口宽度变化，没有固定内容宽度上限。沿用平台主题、字体及卡片样式。
- 支持 JSON 完整备份及合并导入。相同 ID 的冲突保留当前账户数据并提示，导入不会清空原有记录。
- 停用策略、停用规则均保留历史。已作为规则来源的复盘禁止删除，便于追溯。
- 旧版 v1 备份缺少策略字段时自动补为空列表；未知结构和损坏数据明确报错，不静默丢弃历史。

## 功能参考

实现借鉴功能流程，界面沿用 TrendSight 现有设计，不复制第三方品牌或资产。

- [TradeZella 交易详情](https://help.tradezella.com/en/articles/5860216-understanding-the-trade-detail-page)：交易笔记、行为标签和策略规则检查。
- [TradeZella 标签统计](https://help.tradezella.com/en/articles/11595729-reports-tags)：从策略和错误标签中观察重复模式。
- [TraderSync 策略检查](https://tradersync.com/software-updates/new-strategy-checker/)：策略规则与执行评价。
- [TraderSync 计划跟踪](https://tradersync.com/support/how-can-i-see-whether-im-following-my-plan-on-the-dashboard/)：规则遵守率。
- [TradingView 历史回放](https://www.tradingview.com/support/solutions/43000691889-learn-to-trade-on-historical-data/)：历史检验与交易统计。本次未实现独立行情回放引擎。

## 验证

领域与交互回归见 `web/tests/trading-journal.test.mjs`、`review-quotes.test.mjs`、`review-editor.test.mjs` 与 `review-strategies.test.mjs`、`review-workspace.test.mjs`。覆盖持久化、导入冲突、币种隔离、多空计算、未来日期、编辑恢复、策略快照及行情失败隔离。

账户数据库回归见 `review-account-database.test.mjs`：真实 cookie 身份、文件数据库重新连接、用户隔离、版本冲突、无效内容和数据库错误重试。
