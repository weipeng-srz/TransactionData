# 数据格式与计算口径

Web 页面通过同域 API 获取数据。历史行情、成交下载和新闻路由成功时返回 UTF-8 CSV；财务、实时行情、选股、全球市场和账户路由返回 JSON（遥测/退出等响应另见实现）。CSV 路由失败时仍可能返回 JSON 错误，调用端应先检查 HTTP 状态和内容类型。

本页记录接口家族与关键口径，完整字段以链接的 TypeScript 类型、请求规范化函数和路由实现为准。修改契约必须同步解析器、测试及本页，不要把文档当成自动生成的 OpenAPI。

美股接口与 A 股接口相互独立：`/api/us-stock-lookup`、`/api/us-stock-data`、`/api/us-stock-realtime`、`/api/us-stock-news`、`/api/us-stock-financials`。美股行情 CSV 复用现有图表解析字段，并在 `#META` 中明确 `市场=US`、`币种=USD`、`时区=America/New_York`；美股实时源不提供五档或分钟线时返回空数组，不生成模拟盘口。

自选与持仓记录可选带 `market`、`currency` 字段。旧记录缺省为 `CN/CNY`；美股记录使用 `US/USD`，内部键为 `US:<SYMBOL>`。持仓 CSV 只有 A 股时保持旧四列表头；包含美股时追加“市场、币种”两列。

## 历史行情 CSV

`POST /api/local-stock-data` 返回带 BOM 的 UTF-8 CSV。

### 文件结构

1. 第一行 `#META`：股票代码、名称、价格口径、数据级别、时间精度、成交金额口径、数据来源和采集时间。
2. 每个交易日一行 `#DAY`：交易日期和当日前复权因子；最新交易日若取得同日流通 A 股本，会一并写入。
3. 一行表头。
4. 每个交易日由开、高、低、收四个价格点合成的日 K 代理记录。

### 主要字段

| 字段 | 说明 |
| --- | --- |
| `交易日期` | `YYYY-MM-DD` |
| `成交时间` | 用于映射 OHLC 的合成时间点，不代表真实逐笔发生时间 |
| `数据序号` | 文件内单日顺序 |
| `股票代码`、`股票名称` | 标的身份 |
| `原始成交价格(元)` | 上游日 K 返回的未复权价格 |
| `前复权成交价格(元)` | `原始成交价格 ÷ 当日前复权因子` |
| `成交量(股)` | 日成交量在四个合成点之间分配后的代理值 |
| `成交金额估算(元)` | `原始成交价格 × 代理成交量` |
| `数据级别` | 固定标记为 HTTPS 日 K 聚合行情 |

这些记录用于构建 K 线和研究指标，不是逐笔成交，也不应被解释为真实盘中资金流。

换手率不是该 CSV 的独立列。[market.ts](../web/app/lib/market.ts) 聚合时，用 `#DAY` 的同日流通 A 股本计算 `turnoverPct = 成交量(股) ÷ 流通A股本(股) × 100`；缺少股本时为 `null`，不用当前股本反推全部历史。

## 单日成交明细 CSV

`POST /api/local-stock-trades` 为当前交易日分钟 K 线提供独立的下载文件。请求包含股票代码、当前实时快照的交易日期和股票名称；响应是带 BOM 的 UTF-8 CSV。

文件先写入 `#META` 口径，再逐行输出交易日期、成交时间、文件内序号、成交价格、相邻明细价格变动、成交量（手/股）、成交笔数、成交金额、买卖性质、交易时段和数据级别。集合竞价期间成交笔数为 0 的行情快照会被排除，避免把未成交快照当成交易。东方财富主源不可用时会自动降级到腾讯分页明细；备用源不提供切片内成交笔数，因此该列留空，并在 `#META` 中标明口径。

公开 Level-1 明细约按 3 秒切片，一行可能聚合多笔交易所真实成交；`成交笔数` 表示该切片内的聚合笔数。它不是 Level-2 原始逐笔订单，不包含交易所成交序号、买卖方订单号、逐笔委托或撤单。

## 新闻 CSV

`POST /api/local-stock-news` 返回以下字段：

| 字段组 | 字段 |
| --- | --- |
| 标的 | 股票代码、股票名称 |
| 来源 | 检索入口、频道、媒体来源、原文链接 |
| 时间 | 发布时间、采集时间 |
| 相关性 | 相关性得分 |
| 情绪 | 情绪倾向、情绪得分、正向词、负向词 |
| 内容 | 新闻标题、新闻摘要 |

来自网页的文本会防护常见电子表格公式注入前缀。情绪结果来自本地关键词规则，只适合初筛，不能准确理解反讽、否定、语境和事件长期影响。

## JSON 接口

以下方法指有效业务方法；股票检索及数据路由还显式拒绝不支持的 GET。是否允许访客由 [accessPolicy.ts](../web/app/lib/accessPolicy.ts) 与 [middleware.ts](../web/middleware.ts) 统一判断，账户类 handler 还会验证会话。

| 接口 | 方法 | 契约/实现入口 | 访问边界 |
| --- | --- | --- | --- |
| `/api/local-stock-lookup`、`/api/us-stock-lookup` | POST | `{ query }` → 证券身份；[stockLookup.ts](../web/app/lib/stockLookup.ts)、[usStockLookup.ts](../web/app/lib/usStockLookup.ts) | 访客可用 |
| `/api/local-stock-financials`、`/api/us-stock-financials` | POST | 报告期指标、估值和报表；[financials.ts](../web/app/lib/financials.ts)、[usStockFinancials.ts](../web/app/lib/usStockFinancials.ts) | 访客可用 |
| `/api/realtime-market`、`/api/us-stock-realtime` | POST | `{ code }` → 快照；[realtimeMarket.ts](../web/app/lib/realtimeMarket.ts)、[usStockRealtime.ts](../web/app/lib/usStockRealtime.ts) | 访客可用 |
| `/api/screener?market=CN\|US` | GET | [ScreenerFeed](../web/app/lib/screenerTypes.ts)，规范化见 [screenerData.ts](../web/app/lib/screenerData.ts) | 需要账户 |
| `/api/global-indexes` | GET | [GlobalIndexFeed](../web/app/lib/globalIndexes.ts)：`quotes`、`usQuotes`、`fearGauges`、`shanghaiHistory`、`source`、`fetchedAt` | 需要账户 |
| `/api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/password` | POST | [authServer.ts](../web/app/lib/authServer.ts) | 中间件放行 auth 路由，handler 按操作校验身份/同源/限流 |
| `/api/auth/me`；`/api/auth/profile` | GET；PATCH | 会话用户；资料修改；[authServer.ts](../web/app/lib/authServer.ts) | 由 handler 判断会话 |
| `/api/account-data` | GET、PUT | [route.ts](../web/app/api/account-data/route.ts)、[AccountDataWrite](../web/app/lib/accountData.ts) | 会话用户隔离，PUT 同源检查 |
| `/api/research-state` | GET、PUT | [旧研究状态接口](../web/app/api/research-state/route.ts) | 会话用户隔离；不是新个人数据存储入口 |
| `/api/telemetry` | POST | `{ event, durationMs? }`；[白名单与聚合](../web/app/api/telemetry/route.ts) | 需要账户；通过中间件进入 handler 后，内部处理成败均返回 204 |

股票数据接口通常对输入错误返回 400，上游失败返回 502；检索无匹配可能返回 404。不要将所有路由的错误码/限制泛化为同一个值，具体以路由为准。CSV 请求的规范化也分别位于 `remoteMarket.ts`、`usStockMarket.ts`、`remoteNews.ts`、`usStockNews.ts` 和 `dailyTrades.ts`。

## 个人数据同步契约

`GET /api/account-data` 返回 `{ userId, entries }`，每项为 `{ key, value, revision, mutationId }`。可带 `?userId=...` 检测切换账户；真实身份始终来自数据库会话，而不是这个查询参数。

`PUT /api/account-data` 接收 `{ userId, key, value, revision, mutationId }`：

- `key` 必须通过 [accountData.ts](../web/app/lib/accountData.ts) 白名单；`value` 是序列化字符串或 `null`，不是任意对象。单个值上限为 2 MiB，请求总字节上限额外允许 4096 字节。
- 初写用 `revision: 0`，更新使用已读版本，成功版本加一。数据库主键是 `(user_key, key)`；`null` 保留删除后的版本信息，不是绕过并发检查的硬删除。
- `mutationId` 为 16–80 位字母、数字或连字符；相同 mutation 与相同 value 重试可返回已保存结果。
- 成功返回 `{ userId, entry }`；版本冲突返回 `409 / ACCOUNT_DATA_CONFLICT`，不得自动把旧编辑覆盖新值。账户不匹配返回 `401 / ACCOUNT_CHANGED`，服务不可用返回 `503 / ACCOUNT_DATA_UNAVAILABLE`。
- 响应使用 `Cache-Control: private, no-store` 和 `Vary: Cookie`。客户端加载、排队保存和切换账户保护见 [accountStorage.ts](../web/app/lib/accountStorage.ts)，边界见 [领域约束](ai/domain-invariants.md)。

`research-state` 是独立的旧契约：PUT 为 `{ state }`，响应为 `{ state, updatedAt }`；当前清洗为 version 4，移除旧 `holdings`，不具备 `account-data` 的逐键 revision 协议。新增个人状态应使用 `account-data`，不要把两套协议混用。

## 币种与展示折算

个人持仓与证券身份保留 CN/CNY、US/USD，组合基础统计分别核算。首页 [PortfolioHome.tsx](../web/app/components/PortfolioHome.tsx) 的人民币总计使用界面显示、可修改的参考汇率；其折算只影响展示，不改写原始持仓，也不是实时外汇报价。收益日历、复盘与风险约束见 [领域约束](ai/domain-invariants.md)。

## 缓存与兼容性

历史行情和新闻响应成功后会写入浏览器 Cache API。`requestCsv` 在网络请求抛出异常时尝试最多七天内的只读缓存；HTTP 错误响应不会因此自动转为成功。实现见 [page.tsx](../web/app/page.tsx) 和 [browserCache.ts](../web/app/lib/browserCache.ts)。

选股还有服务端内存缓存/请求合并与路由缓存头，与浏览器 CSV 回退不是同一层；账户私有数据不进入公共缓存。服务端返回格式发生变化时，应保持已有字段语义，并同时更新解析器和 [对应回归测试](code-map.md)。
