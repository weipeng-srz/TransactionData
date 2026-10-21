# 按改动选择验证

本页帮助 AI 选择最小有效验证集。先读 [AGENTS.md](../../AGENTS.md)，修改符号前做影响分析；提交前检查变更范围。命令均在 `web/` 执行，除非另有说明。

## 运行入口与证据边界

```bash
cd web
pnpm lint
pnpm test
```

[package.json](../../web/package.json) 的 `pnpm test` 已包含 `pnpm run build`，随后执行 `node --experimental-strip-types --test tests/*.test.mjs`。[CI](../../.github/workflows/ci.yml) 使用同样的 lint + test 路径。Node 需 22.13+，pnpm 版本跟随 `packageManager`；构建会生成 `dist/` 和 `.wrangler/` 日志/状态。

开发中可以直接运行选定文件，避免每次都构建；完整回归时再运行 `pnpm test`。测试类型应从源码确认，不能仅按文件名推断：

| 类型 | 例子 | 能证明什么 / 不能证明什么 |
| --- | --- | --- |
| 领域计算、解析器 | `market-parser`、`holding-risk`、`stock-score`、`trading-journal` | 直接导入 TS，验证输入输出与边界；不需要先构建 |
| API 与存储 | `api-route-contracts`、`account-data`、`auth`、`review-account-database` | mock 上游请求、注入数据库；SQLite 测试使用内存或临时文件，并非生产 D1 |
| 源码/CSS 静态约束 | `mobile-layout`、`global-layout`、`holdings-local-only` | 检查文件内容或约束；不等于浏览器视觉/交互验收。旧测试名 `local-only` 不表示当前持仓仍用 Local Storage |
| 组件逻辑模拟 | `review-workspace`、`stock-model-lifecycle` | TypeScript 转译 + VM / hooks 模拟，验证状态和竞态；不运行完整浏览器 |
| 构建产物 | `rendered-html` | 导入 `dist/server/index.js`，调用 Worker `fetch` 验证 HTML/重定向/访客拒绝；**必须先构建**，也不是完整浏览器 E2E |

部分文件混合静态断言与运行时测试。网络客户端测试通过 fixtures / mock 验证协议，不证明当前第三方服务在线；真实访问只能作为单独记录的联通性验证。

## 按功能选组

下表省略文件名前缀 `tests/` 与后缀 `.test.mjs`。先跑触及领域，再按影响图增加调用方；不要因为名称相似而机械运行所有组。

| 改动 | 首选测试 | 补充验证 |
| --- | --- | --- |
| A 股行情 / CSV / 交易时段 | `market-parser`、`remote-market`、`realtime-market`、`realtime-daily-candle`、`cn-trading-session`、`closed-market-day` | 触及路由加 `api-route-contracts`；真实行情与合成日 K 口径分开检查 |
| 证券查找 / 美股 | `stock-lookup-route`、`us-stocks`、`us-stock-news`、`api-route-contracts` | CN / US 键隔离、空数据与上游失败 |
| 新闻 / 财务 / 成交下载 | `news-parser`、`financials`、`financial-analysis`、`daily-trades`、`daily-trades-fetch`、`api-route-contracts` | 按实际改动选取；检查 CSV 下载字段与错误响应 |
| 指标 / 评分 / 预测 | `bs-signal-v2`、`research-tools`、`stock-score`、`next-day-prediction`、`stock-model-lifecycle` | 数据时间切片、无未来数据泄漏、空历史、模型降级；研究回测另行选择 |
| 持仓 / 自选 / 组合 | `holdings`、`holdings-independence`、`watchlist`、`portfolio-workbench`、`portfolio-earnings`、`portfolio-prediction`、`portfolio-realtime-poller`、`portfolio-score-popover` | 持久化变化加 `account-data`；账户切换、币种分组、旧持仓清理 |
| 认证 / 账户保存 | `auth`、`auth-client`、`account-access-policy`、`account-data`、`review-account-database` | 加构建后的 `rendered-html`；浏览器验证登录/退出、多窗口冲突和保存失败 |
| 旧研究状态 / schema / 迁移 | `research-state-route`、`research-state-concurrency`、`account-data`、`review-account-database` | 临时新库应用全部迁移，保留旧数据升级场景 |
| 交易复盘 | `trading-journal`、`review-workspace`、`review-editor`、`review-dialog`、`review-strategies`、`review-quotes`、`review-account-database` | 导入/导出、草稿恢复、持仓与复盘独立性、跨账户隔离 |
| 选股 / 全球市场 | `screener-data`、`screener-page`、`screener-security-filter`、`screener-views`、`global-indexes`、`fear-gauges`、`robinson-projection` | 缓存/失败回退、市场口径和列表范围；地图投影变化时选最后一项 |
| 图表 / 页面 / 样式 | `chart-interaction`、`kline-viewport`、`kline-interactions`、`workspace-navigation`、`mobile-layout`、`mobile-banner-behavior`、`ux-release-guardrails` | 按组件补充对应 `*layout` / `*presentation` 测试；浏览器桌面/移动布局、滚动、hover、键盘和减少动效检查 |
| 仅文档 | 相对链接、路径、命令、术语和 `git diff --check` | 核对实际源码，不为文字变动运行全量网络回测或创建实现镜像测试 |

例如只调整账户保存逻辑：

```bash
node --experimental-strip-types --test tests/account-data.test.mjs tests/auth-client.test.mjs tests/review-account-database.test.mjs
```

仅验证构建产物时：

```bash
pnpm build
node --experimental-strip-types --test tests/rendered-html.test.mjs
```

手机 UI 的逐项操作和桌面隔离哨兵见 [手机测试方案](../mobile-ux-test-plan.md)。`mobile-banner-behavior` 用真实组件转译/事件与 hooks 模拟验证滚动阈值、搜索展开关闭、焦点归还、CN/US 路由和生命周期；它不模拟 iOS 虚拟键盘与真机安全区，不能代替浏览器/设备验收。

移动表单样式需要在实际挂载页面检查 `getComputedStyle`，不能只确认子组件媒体规则存在。父组件的后加载样式可用同等优先级覆盖子组件：`PortfolioHome` 的 `.page input { font: inherit; }` 会重设收益月份输入字号，`ReviewWorkspace` 的 `.main textarea` 会重设复盘文本区最小高度。对应手机规则通过月份输入的 `type` 和复盘字段的 `data-field` 提高选择器优先级，并只在 ≤820px 生效；复验时同时检查月份字号 16px、复盘文本区最小高度 132px，以及 >820px 桌面原有样式。

## 数据库与构建验证

- `pnpm db:generate` 读取 `db/*.ts`，会生成迁移文件与元数据；审查生成 SQL 后再应用，不能只改 schema 而漏掉迁移。
- `pnpm db:migrate:local` 通过 Wrangler 的 `--local` 应用全部未执行迁移，默认写 `.wrangler/state/v3/d1`；`pnpm dev` 自动先执行它。
- 用临时库验证新装与重复应用，避免删除已有本地账号数据：

```bash
trendsight_migration_dir=$(mktemp -d)
TRENDSIGHT_D1_PERSIST_PATH="$trendsight_migration_dir" pnpm db:migrate:local
TRENDSIGHT_D1_PERSIST_PATH="$trendsight_migration_dir" pnpm db:migrate:local
```

`TRENDSIGHT_D1_PERSIST_PATH` 是迁移脚本的路径覆盖；它不会自动修改 Vite 开发服务器的持久化目录。`pnpm build` 打包迁移到 `dist/.openai/drizzle`，**不会应用目标 D1 迁移或自动部署**。

## 研究脚本不是日常回归测试

以下入口都在 [web/scripts](../../web/scripts)，用 `node --experimental-strip-types scripts/<脚本>.mjs` 运行；只有 `backtest-main-force-intent` 另有同名 pnpm 脚本。先读参数解析并明确输入、样本、日期切分与输出路径，再执行；不要假定 `--help` 会阻止脚本运行。

| 脚本 | 输入 / 网络 / 输出影响 |
| --- | --- |
| `backtest-next-day-prediction.mjs` | 必需 `--universe` 成分股 CSV 与 `--output`；实时抓取股票/基准日 K，启动 worker threads，写结果 JSON |
| `backtest-screener-phases.mjs` | 获取市场列表与历史行情；默认 1,000 只，写 `.cache/phase-backtest` 和 `outputs/` 的 JSON / Markdown；`--reuse-sample` 仍可能访问网络 |
| `backtest-eight-dimension-score.mjs` | 依赖已有样本报告与历史缓存，缺失财务缓存时请求东方财富；写 `.cache/eight-dimension-backtest` 与结果 JSON / Markdown |
| `backtest-main-force-intent.mjs` | 读取已有样本报告和 `.cache/phase-backtest` 历史缓存，运行本地计算并写 JSON / Markdown；默认输入报告可能不存在 |
| `backtest-bs-portfolio.mjs` | 抓取股票池/日 K/复权因子，默认 1,000 只；默认缓存写系统临时目录，指定 `--output` 才写结果 JSON |
| `validate-bs-holdout.mjs` | 必需 `--input` JSON 或 gzip 样本，排除前 120 只探索股票后验证；本地计算，可用 `--output` 写结果 |
| `train-next-day-panel-model.mjs` | 必需 `--input`、`--output`、`--train-end`、`--validation-end`；本地训练并写模型 JSON，不自动替换应用模型产物 |

回测失败先分辨代码错误、缺少本地样本、上游限流与数据不足。不要通过缩小样本或更换时间区间把失败包装成原计划通过；明确报告实际参数和验证范围。历史 `reports/` 是当时的研究证据，不代替当前测试。

## 完成记录

最终说明改了什么、实际执行哪些验证、结果及未验证边界；不要把“已添加测试”写成“测试已通过”。功能/契约变化同步 [文档维护规则](documentation-maintenance.md) 指定的地图与专题页；命令或测试入口变化同步本页和 [Web README](../../web/README.md)。
