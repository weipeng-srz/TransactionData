# TickLens Web

这是 TickLens 的 Web 研究工作台，基于 Next.js App Router、React、vinext、Vite 和 Cloudflare Workers。它通过服务端路由访问公开行情、财务与新闻数据，并使用 D1 保存研究状态、价格提醒和匿名聚合遥测。

项目总览、Go 命令和数据口径请先阅读仓库根目录的 [`README.md`](../README.md)。

## 环境要求

- Node.js 22.13+
- pnpm 10

## 本地运行

```bash
pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的本地地址。本地预览使用固定的 `local-preview` 用户键模拟研究状态和提醒存储；不需要登录，也不需要预先构建 Go 命令。

## 常用命令

```bash
pnpm dev          # 启动开发服务
pnpm build        # 生成 Cloudflare Worker 兼容产物
pnpm lint         # ESLint 检查
pnpm test         # 构建并运行全部 Node 测试
pnpm db:generate  # 根据 db/schema.ts 生成 D1 迁移
```

## 目录

```text
web/
├── app/
│   ├── api/          # 行情、财务、新闻、提醒和研究状态 API
│   ├── components/   # 图表与研究界面组件
│   ├── lib/          # 数据解析、指标、存储与远端数据客户端
│   ├── alerts/       # 桌面行情监控页
│   └── page.tsx      # 主工作台
├── db/               # Drizzle/D1 schema 与连接封装
├── drizzle/          # 可部署的 D1 迁移
├── plugins/          # 构建期 Sites 插件
├── public/           # 图标与社交预览图
├── tests/            # Node 测试
└── worker/           # Cloudflare Worker 入口与定时任务
```

## 数据与状态

- 行情、财务和新闻由服务端 API 从公开数据源实时获取。
- 最近查询、部分界面偏好和离线回退保存在浏览器本地。
- D1 中的 `research_states`、`price_alerts`、`telemetry_daily` 分别保存研究状态、价格提醒和按日聚合事件计数。
- 托管环境通过 `oai-authenticated-user-email` 请求头识别用户；数据库中只保存其 SHA-256 派生键，不保存邮箱原文。

## 构建与托管

`.openai/hosting.json` 声明 Sites 项目和逻辑 D1 绑定；`plugins/sites-vite-plugin.ts` 会在构建后把托管元数据与迁移复制到 `dist/.openai/`。Fork 或独立部署时，应使用自己的托管项目、数据库和访问策略，不要假定上游项目资源可复用。

不要提交 `.env*`、`.dev.vars*`、`.wrangler/`、`dist/` 或任何访问凭据。
