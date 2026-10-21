# TrendSight Web 开发指南

这里是应用根目录。产品概览与数据口径见 [仓库 README](../README.md)；AI 开始修改前读 [AGENTS.md](../AGENTS.md) 和 [上下文入口](../docs/ai/README.md)。查代码用 [代码地图](../docs/code-map.md)，理解运行链路用 [技术架构](../docs/architecture.md)。

## 环境与首次启动

- Node.js **22.13+**，推荐按 [.nvmrc](.nvmrc) 选择版本；测试使用 Node 原生 TypeScript 类型剥离与 `node:sqlite`。
- pnpm **10**，精确版本以 [package.json](package.json) 的 `packageManager` 为准。

在仓库根目录执行：

```bash
cd web
pnpm install --frozen-lockfile
pnpm dev
```

打开终端打印的地址。`pnpm dev` 先对项目本地 D1 幂等应用尚未执行的 `drizzle/` 迁移，失败则不启动服务。首次使用个人功能须注册本地账户；访客可使用个股查询。开发、构建与预览实际运行 vinext，配置入口是 [vite.config.ts](vite.config.ts)。

## 日常命令

以下均在 `web/` 执行，脚本真相来源是 [package.json](package.json)。

| 命令 | 用途与副作用 |
| --- | --- |
| `pnpm dev` | 应用本地迁移后启动 vinext 开发服务；写 `.wrangler/` |
| `pnpm build` | 构建 Worker 与静态资源，生成 `dist/`，打包托管配置和迁移 |
| `pnpm start` | 预览已有构建；先运行 `pnpm build` |
| `pnpm lint` | ESLint，忽略 `dist/` 和 `.next/` |
| `pnpm test` | **先 build，再执行全部 `tests/*.test.mjs`**；不必紧邻再跑一次 build |
| `node --experimental-strip-types --test tests/market-parser.test.mjs` | 示例：只跑相关 Node 测试；不自动构建 |
| `pnpm db:generate` | 从 `db/*.ts` 生成 Drizzle 迁移文件；不会应用迁移 |
| `pnpm db:migrate:local` | 幂等应用本地 D1 迁移；不修改远端 D1 |

测试选组、需要构建的测试、迁移验证和研究脚本副作用见 [验证指南](../docs/ai/verification.md)。[CI](../.github/workflows/ci.yml) 执行依赖安装、lint 和 `pnpm test`。

## 目录导航

| 目录 / 文件 | 职责 |
| --- | --- |
| `app/page.tsx` | 组合首页与个股工作台的状态编排 |
| `app/screener/`、`app/global-markets/`、`app/review/` | 选股、全球市场、交易复盘页面 |
| `app/login/`、`app/register/`、`app/account/` | 账户页面 |
| `app/features/` | 个股模型、研究笔记、复盘等功能模块 |
| `app/components/` | 图表、财务、组合、研究面板和共享 UI |
| `app/lib/` | 领域计算、解析器、上游适配、账户状态与导航工具 |
| `app/api/`、`middleware.ts` | 同域接口与访问控制 |
| `db/`、`drizzle/` | D1 连接、两个 schema 文件、SQL 迁移 |
| `worker/`、`plugins/` | Worker 入口与 Sites 构建元数据打包 |
| `tests/` | Node 测试：计算、契约、SQLite、源码约束和构建产物验证 |
| `scripts/`、`reports/` | 本地迁移、模型研究/回测脚本、历史研究报告 |
| `public/` | 图标和社交预览资源 |

## 数据与维护边界

- 行情、财务、新闻经同域 API 获取；A 股与美股端点分开，响应约定见 [数据格式](../docs/data-formats.md)。
- 账户资料、密码哈希、会话和个人工作区数据保存到 D1。`accountStorage` 是内存门面，通过 `/api/account-data` 按用户与数据键持久化；不把私人数据写入 Local Storage。
- `middleware.ts` 与 `accessPolicy.ts` 保护非公开页面和接口。账户数据写入校验用户、逐键版本与幂等请求 ID；冲突不会覆盖其他窗口的保存。
- 历史行情/新闻成功 CSV 可进入浏览器 Cache API，网络异常时使用七天内只读缓存；该机制不覆盖账户保存或财务请求。
- 旧 `research-state` 接口保留兼容清理逻辑；旧浏览器/`local-preview` 数据不自动归属新账户。`ticklens.*` 是仍在使用的兼容标识。
- 预测、评分与回测口径见 [功能研究地图](../docs/feature-research-map.md) 和 [领域约束](../docs/ai/domain-invariants.md)，不要把历史报告结论当成当前模型保证。

## 数据库与托管

默认本地 D1 存储根为 `.wrangler/state`，实际库位于其下 `v3/d1`；`pnpm dev` 和迁移脚本使用同一位置。需要验证全新库时，用临时目录运行迁移，方法见 [验证指南](../docs/ai/verification.md)，无需删除现有账户数据。

`.openai/hosting.json` 声明托管元数据与逻辑绑定；`plugins/sites-vite-plugin.ts` 构建后复制它及 SQL 迁移到 `dist/.openai/`。构建不自动应用远端迁移或发布。Fork / 独立部署需配置自己的托管资源，发布前对目标 D1 应用全部迁移。

不要提交 `.env*`、`.dev.vars*`、`.wrangler/`、`dist/` 或访问凭据。功能完成时在同一变更中 [同步相关文档](../docs/ai/documentation-maintenance.md)，记录新的入口、契约、限制和验证命令。

手机交互改动遵循 [50项产品说明](../docs/mobile-ux-product-spec.md) 与 [测试方案](../docs/mobile-ux-test-plan.md)。新增共享样式层 `app/mobile.css` 在 `layout.tsx` 最后加载，并限于 `max-width: 820px`；组件样式也需守住同一桌面隔离边界。局部导航验证可运行 `node --experimental-strip-types --test tests/mobile-banner-behavior.test.mjs tests/mobile-layout.test.mjs tests/site-banner-layout.test.mjs`。浏览器验收结果见 [验收记录](../docs/mobile-ux-acceptance.md)。
