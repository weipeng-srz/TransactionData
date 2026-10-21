# TransactionData / TrendSight — AI 开发指南

本文件适用于整个仓库。目标是让 AI 以最少的必要上下文定位实现，并在修改后保留可复用知识。产品名为 **TrendSight**，仓库与 GitNexus 索引名为 **TransactionData**。

## 开始任务时

1. 阅读 [AI 上下文入口](docs/ai/README.md)，根据任务表只加载相关专题。
2. 用 [代码与功能地图](docs/code-map.md) 定位页面、领域模块、API 和测试；研究行为或排障时读 [功能研究地图](docs/feature-research-map.md) 的对应功能。
3. 修改业务行为前读 [领域约束](docs/ai/domain-invariants.md) 的相关条目；按下面 GitNexus 规则查询调用关系，再核对实际源码。
4. 查看 `git status --short`，保留已有改动。代码、配置与测试是当前事实；文档冲突时先验证，并在本次改动中修正文档。

不要默认读取整个仓库、全部测试或历史报告。优先读取任务命中的入口、直接依赖与对应测试，再沿调用链扩展。

## 仓库速览

- 应用代码在 `web/`，不是 `src/`。`web/app/page.tsx` 是主工作台，独立页面还有 `screener/`、`global-markets/`、`review/` 和认证/账户页。
- React + Next.js App Router，经 vinext/Vite 构建到 Cloudflare Workers；数据库是 Drizzle + D1。运行配置以 `web/package.json`、`web/vite.config.ts`、`web/wrangler.local.jsonc` 为准。
- `web/app/lib/` 同时含纯计算、浏览器状态和服务端上游客户端；导入前确认运行环境，不能把服务端依赖带入客户端。
- 个人数据走数据库会话与 `/api/account-data`；浏览器 Cache API 只作公共行情/新闻的只读回退。不能根据旧测试名中的 `local-only` 推断今天的存储架构。
- A 股/美股证券键、币种、价格复权和交易日均有明确口径，详见领域约束；展示的研究代理不代表真实订单流或收益保证。

## 常用验证入口

从仓库根目录运行 `make setup`、`make dev`、`make lint`、`make test` 或 `make check`；具体定义在 `Makefile` 与 `web/package.json`。Node 版本先核对 `web/.nvmrc` 和 `web/package.json`。

`make test` / `pnpm test` 已包含构建。局部测试、数据库迁移和脚本副作用见 [验证指南](docs/ai/verification.md)。纯文档修改检查链接、路径、命令与差异；不要因此运行联网回测或改写研究产物。交付时明确哪些验证实际执行、哪些没有执行。

## 每次功能修改必须同步文档

- 在同一批改动内按 [文档维护矩阵](docs/ai/documentation-maintenance.md) 更新受影响的功能地图、专题说明及必要的 README。
- 新增/移动/删除页面、API、模块、测试时，更新代码地图的入口和链接；改变行为、公式、数据源、身份、持久化或降级策略时，更新研究地图和对应契约/约束。
- 新发现的稳定约束、非直观兼容行为与有效验证方式应写进对应专题，避免只留在聊天记录。未验证的猜测标为待验证，不写成事实。
- 历史报告保留当时的日期、样本和结论；新增研究结论写新报告，并更新文档目录，不把旧回测当成当前版本保证。
- 最终交付说明列出更新的文档；确实无需更新时，说明检查了哪些文档以及理由。未完成必要的文档同步，任务不算完成。

## GitNexus 与索引维护

下方托管区的规则继续适用。自定义指南放在标记外，重建索引后检查本文件和 `CLAUDE.md` 的差异，避免丢失手写上下文。索引统计是生成快照，不是长期不变量。

优先用 GitNexus MCP；若当前会话未提供 MCP，可从根目录使用已有 runner 的等价 CLI：

```bash
node .gitnexus/run.cjs status
node .gitnexus/run.cjs query "account storage revision" --repo TransactionData --limit 3
node .gitnexus/run.cjs context createAccountDataHandlers --repo TransactionData --file web/app/api/account-data/route.ts
# 替换为本次待修改符号和文件路径，不能只分析示例函数
node .gitnexus/run.cjs impact createAccountDataHandlers --direction upstream --repo TransactionData --file web/app/api/account-data/route.ts
node .gitnexus/run.cjs detect-changes --scope all --repo TransactionData
node .gitnexus/run.cjs detect-changes --scope compare --base-ref main --repo TransactionData
```

新克隆没有 `.gitnexus/` 时按下方说明创建索引；`.gitnexus/` 和 `.claude/` 是本地工具资料，不是版本化上下文的前提。工具不可用时明确记录限制，仍可完成文档与只读核验；修改符号前必须满足下方 impact 要求。`AGENTS.md` 是统一入口，不另建小写 `agent.md` 维护一套重复规则。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **TransactionData** (3772 symbols, 9580 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/TransactionData/context` | Codebase overview, check index freshness |
| `gitnexus://repo/TransactionData/clusters` | All functional areas |
| `gitnexus://repo/TransactionData/processes` | All execution flows |
| `gitnexus://repo/TransactionData/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
