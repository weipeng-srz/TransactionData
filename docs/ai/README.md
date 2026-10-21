# AI 上下文入口

用途：在开始任务时找到最小必要上下文。先遵守 [AGENTS.md](../../AGENTS.md)；这里提供导航，不复制各专题正文。

## 一分钟项目上下文

- 产品 **TrendSight**，仓库 **TransactionData**：面向 A 股与美股的市场研究工作台，包含组合观察、个股研究、选股、全球市场和交易复盘。
- 唯一应用目录是 `web/`。UI/API 采用 Next.js App Router 约定，实际构建与运行链为 vinext → Vite → Cloudflare Worker；没有独立 Go/Python 后端。
- UI 编排在 `web/app/page.tsx`、页面目录和 `components/` / `features/` / `hooks/`；领域计算和数据客户端在 `web/app/lib/`；API 在 `web/app/api/`。
- 公共数据由服务端抓取和规范化，浏览器消费同域 API。账户、会话与个人数据进入 D1；schema 在 `web/db/`，迁移在 `web/drizzle/`。
- `TickLens`、`ticklens.*` 和 `X-TickLens-*` 是代码中的历史命名/持久化标识。不要因为产品更名而直接批量替换存储键、缓存键或接口字段。
- 依赖版本与命令以 [package.json](../../web/package.json)、[.nvmrc](../../web/.nvmrc)、[Makefile](../../Makefile) 为准，不从旧聊天或报告推断。

## 任务 → 最小阅读集合

所有路径以本页链接或仓库根目录为准。地图按功能分组，先读对应行/小节，再打开列出的源码与测试。

| 任务关键词 | 必读上下文 | 源码入口提示 |
| --- | --- | --- |
| 启动、构建、D1 迁移、部署产物 | [Web README](../../web/README.md)、[验证指南](verification.md) | `web/package.json`、`web/vite.config.ts`、`web/scripts/migrate-local-d1.mjs` |
| 手机交互、滚动 banner、触控验收 | [手机产品说明](../mobile-ux-product-spec.md)、[测试方案](../mobile-ux-test-plan.md)、[验收记录](../mobile-ux-acceptance.md) | `components/SiteBanner.tsx`、`lib/mobileNavigation.ts`、`app/mobile.css` |
| 页面、导航、基础/专业视图、样式 | [代码地图](../code-map.md)、[架构](../architecture.md) | `web/app/page.tsx`、`web/app/hooks/useWorkspaceView.ts`、`web/app/layout.tsx` |
| 行情、实时轮询、K 线、成交明细 | [研究地图](../feature-research-map.md)、[数据格式](../data-formats.md)、[约束](domain-invariants.md) | `web/app/lib/market.ts`、`remoteMarket.ts`、`realtimeMarket.ts`、`dailyTrades.ts` |
| 财务、新闻、上游失败与缓存 | [研究地图](../feature-research-map.md)、[数据来源](../data-sources.md)、[数据格式](../data-formats.md) | 对应 CN/US 数据客户端、API 与解析器 |
| 持仓、收益、风控、自选 | [代码地图](../code-map.md)、[研究地图](../feature-research-map.md)、[约束](domain-invariants.md) | `holdings.ts`、`portfolioEarnings.ts`、`holdingRisk.ts`、`watchlist.ts` |
| 隔日统计、评分、B/S、回测 | [研究地图](../feature-research-map.md)、[约束](domain-invariants.md)、[验证指南](verification.md) | `nextDayPrediction.ts`、`stockScore.ts`、`market.ts`；历史报告仅按需读 |
| 选股、研究池、全球指数 | [代码地图](../code-map.md)、[研究地图](../feature-research-map.md)、[数据来源](../data-sources.md) | `screener/`、`global-markets/`、`screenerData.ts`、`globalIndexes.ts` |
| 复盘、草稿、策略、规则、导入 | [复盘专题](../trading-review.md)、[研究地图](../feature-research-map.md) | `features/review/`、`tradingJournal.ts`、`accountStorage.ts` |
| 登录、身份、保存失败、跨账户/多窗口冲突 | [架构](../architecture.md)、[数据格式](../data-formats.md)、[约束](domain-invariants.md) | `web/middleware.ts`、`accessPolicy.ts`、`authServer.ts`、`accountStorage.ts`、`api/account-data/route.ts` |
| 纯文档或交付收尾 | [文档目录](../README.md)、[维护矩阵](documentation-maintenance.md) | 确认引用、命令和 Git 差异 |

表格中的裸文件名均位于 `web/app/lib/`，页面目录相对 `web/app/`；不确定时以代码地图的完整链接为准。

## 获取证据的顺序

1. 从用户问题选一条功能链，用 GitNexus `query` 查流程、`context` 查符号；工具方法见根指南。
2. 读路由/组件入口、实际依赖和相关测试。图谱用于导航，动态调用、闭包和外部数据契约仍要从源码验证。
3. 修改已有函数、类、方法前执行 upstream `impact`，向用户说明直接调用方、影响流程和风险；高风险先告知。
4. 按 [验证指南](verification.md) 选择检查，按 [维护矩阵](documentation-maintenance.md) 同步文档。

当任务是线上数据问题，先固定证券/市场、交易日、请求参数、响应和错误，再沿 API → 数据客户端 → 解析器 → UI 排查；缺少线上证据时明确区分代码推断与已验证事实。

## 上下文边界

默认跳过 `node_modules/`、`dist/`、`.wrangler/`、`.gitnexus/` 的内部数据库、`tmp/`、`output/`、`outputs/` 及完整历史回测输出。`.gitnexus/run.cjs` 是工具入口，可按需使用。

不要把临时调试结果、访问凭据、个人账户内容、完整第三方数据或未证实的猜测写进长期上下文。稳定结论写入对应专题，记录源码/测试依据；只在任务确实需要时读取 [历史研究报告](../README.md#历史研究与评审证据按需读取)。
