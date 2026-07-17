# TickLens 行情、基本面与舆情工作台

TickLens 可以输入股票名称或代码，由页面解析沪深 A 股后并行获取最近90个完整交易日、估值与分红、历史财务报表和相关新闻。任一路先完成都会立即更新对应区域，无需等待其他数据源。页面默认用最近 8 个单季度回答增长趋势、利润现金质量、指标改善/恶化和估值匹配四个问题，并在当前浏览器保留最近查询记录。

主图支持 MA5/10/20、EMA12/26、BOLL、VWAP、神奇九转与 B/S 组合指引；副图支持 VOL（含 MV5/MV10）、MACD、KDJ、RSI。右侧 K 线研判会汇总趋势、动量、ATR、量能、近20期支撑压力和最近组合信号。

## Prerequisites

- Node.js `>=22.13.0`
- Go 1.21 或更高版本（使用股票代码自动取数时）

## Quick Start

```bash
cd ..
CGO_ENABLED=0 go build -trimpath -o stock-ticks .
CGO_ENABLED=0 go build -trimpath -o stock-news ./cmd/stock-news
cd web
pnpm install
pnpm dev
```

打开终端显示的本地地址（当前配置通常是 `http://localhost:3000`）。输入股票名称或代码后按回车或点击“获取行情 + 基本面 + 新闻”。名称会先解析为沪深 A 股代码，随后页面并行获取行情、基本面与新闻；每一路完成后都会立即更新对应区域。成功查询过的股票会保存在当前浏览器的“最近查询”列表中，可点击再次查询或清空。行情与新闻自动取数接口在本地开发服务中调用项目根目录的两个二进制文件；基本面通过站点 API 获取公开估值、分红与财务数据。

股息率 TTM 使用估值日向前 12 个月内已经实施的税前现金分红合计除以估值日收盘价，并同时展示每股现金分红金额与实施次数。财报诊断支持最近 8/12 季度、近 5/10 年，支持单季度、累计、TTM 以及绝对值、同比、环比和占营收比例切换。流量指标统一在数据层换算：Q2/Q3/Q4 单季度值由同一会计年度累计值差分，TTM 为最近四个单季度之和；资产负债指标使用报告期末值。页面同时提供收入与利润、盈利能力、现金流质量、资产质量图表，规则异常信号、可展开指标矩阵、CSV 导出和可追溯的四段式结论。

当前详细财报口径为合并报表与正式定期报告。规则引擎只提示需要核查的方向，不据此断言财务造假或给出目标价。

新闻区域会显示正面、中性、负面数量、综合情绪分、检索入口、发布时间、标题、摘要、关键词依据和原文链接，并可按情绪筛选。关键词情绪用于初筛，不理解反讽、否定关系和复杂上下文，请结合原文人工核验。

新版 CSV 会提供原始成交金额、按日股本、原始性质代码和交易时段；旧版 CSV 仍可读取，但资金流会被明确标记为前复权金额代理。

主力行为代理综合主动买卖净额、大额成交净额、收盘相对 VWAP、日内位置、换手、量比和尾盘方向。B/S 指引综合九转、MACD、KDJ、RSI、MA5 与 BOLL 的规则信号。两者都不包含 Level-2 委托、撤单或订单链路，因此仅用于研究，不构成投资建议。

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `pnpm dev`: 启动本地开发服务（含股票代码自动取数）
- `pnpm build`: 验证 vinext 构建产物
- `pnpm test`: 构建并运行解析、指标、接口校验和服务端渲染测试
- `pnpm lint`: 运行 ESLint

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
