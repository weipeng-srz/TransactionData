# TrendSight Web

这是 TrendSight 的 Web 研究工作台，基于 Next.js App Router、React、vinext、Vite 和 Cloudflare Workers。它通过服务端路由访问公开行情、财务与新闻数据，并使用 D1 保存研究状态和匿名聚合遥测。

项目总览和数据口径请先阅读仓库根目录的 [`README.md`](../README.md)。

## 环境要求

- Node.js 22.13+
- pnpm 10

## 本地运行

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 会先对项目内 `.wrangler/state/v3` 的本地 D1 幂等执行 `drizzle/` 中尚未应用的迁移，再启动开发服务。打开终端显示的本地地址即可；本地预览使用固定的 `local-preview` 用户键模拟研究状态存储，不需要登录。

如果需要单独准备或修复本地数据库，可以运行 `pnpm db:migrate:local`。迁移失败时开发服务不会继续启动，避免在缺表状态下静默运行。删除 `.wrangler/state/v3` 后再次运行该命令，可验证全新本地数据库的初始化流程。

## 常用命令

```bash
pnpm dev          # 启动开发服务
pnpm build        # 生成 Cloudflare Worker 兼容产物
pnpm lint         # ESLint 检查
pnpm test         # 构建并运行全部 Node 测试
pnpm db:generate  # 根据 db/schema.ts 生成 D1 迁移
pnpm db:migrate:local # 幂等应用本地 D1 迁移
```

## 目录

```text
web/
├── app/
│   ├── api/          # 行情、财务、新闻和研究状态 API
│   ├── components/   # 图表与研究界面组件
│   ├── lib/          # 数据解析、指标、存储与远端数据客户端
│   └── page.tsx      # 主工作台
├── db/               # Drizzle/D1 schema 与连接封装
├── drizzle/          # 可部署的 D1 迁移
├── plugins/          # 构建期 Sites 插件
├── public/           # 图标与社交预览图
├── tests/            # Node 测试
└── worker/           # Cloudflare Worker 入口
```

## 数据与状态

- 行情、财务和新闻由服务端 API 从公开数据源实时获取。
- 最近查询、部分界面偏好和离线回退保存在浏览器本地。
- D1 中的 `research_states` 和 `telemetry_daily` 分别保存研究状态和按日聚合事件计数。
- 托管环境通过 `oai-authenticated-user-email` 请求头识别用户；数据库中只保存其 SHA-256 派生键，不保存邮箱原文。

## 自适应预测模块

- “预测今日”严格把当前交易日从模型输入中剔除，只使用昨日及以前的完整日 K，并用实时涨跌检验预测与风控纪律。
- “预测明日”合并今天截至当前的 OHLCV；交易中成交量按已完成交易时长投影，A 股午休和美股交易时长分别处理。
- 模型组合规则后验、带时间衰减的历史相似日、Logistic 方向模型和 Ridge 收益区间模型。大盘收益、趋势、波动率与个股相对强弱进入可回测特征；新闻按预测切片过滤后，只做上限为 ±5 个百分点的上下文修正。
- 每次数据更新都会在所选滚动窗口重新训练。ML 只有在 Walk Forward 的 Accuracy、ROC-AUC 与 Brier Score 同时通过门槛时才获得权重，否则自动降级为规则与相似日模型。
- 界面中的胜率、可信度、止盈位和风险位都是统计研究结果，不是收益承诺或自动交易指令。

## 构建与托管

`.openai/hosting.json` 声明 Sites 项目和逻辑 D1 绑定；`plugins/sites-vite-plugin.ts` 会在构建后把托管元数据与迁移复制到 `dist/.openai/`。Fork 或独立部署时，应使用自己的托管项目、数据库和访问策略，不要假定上游项目资源可复用。

不要提交 `.env*`、`.dev.vars*`、`.wrangler/`、`dist/` 或任何访问凭据。
