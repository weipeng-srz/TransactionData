# 文档目录

面向开发者与 AI 的导航。产品使用介绍见 [根 README](../README.md)，执行规则见 [AGENTS.md](../AGENTS.md)。当前实现以源码、配置和测试为准；日期型报告仅描述当时验证结果。

## 从任务开始

| 需要做什么 | 先读 | 再读 |
| --- | --- | --- |
| 首次进入仓库、压缩上下文 | [AI 上下文入口](ai/README.md) | [代码与功能地图](code-map.md) |
| 找到功能实现、调用链与测试 | [代码与功能地图](code-map.md) | [功能研究地图](feature-research-map.md) |
| 理解服务、数据与运行边界 | [架构说明](architecture.md) | [Web 开发说明](../web/README.md) |
| 修改 API、数据解析和计算口径 | [数据格式](data-formats.md) | [领域约束](ai/domain-invariants.md) |
| 接入或排查公开数据源 | [数据来源](data-sources.md) | [功能研究地图](feature-research-map.md) |
| 维护复盘和策略 | [复盘专题](trading-review.md) | [代码与功能地图](code-map.md) |
| 选择检查命令、准备交付 | [验证指南](ai/verification.md) | [文档维护矩阵](ai/documentation-maintenance.md) |

## 当前维护的上下文

| 文档 | 负责内容 | 更新时机 |
| --- | --- | --- |
| [AGENTS.md](../AGENTS.md) | 仓库级规则、最短加载顺序 | 工作约定、构建入口或文档组织变化 |
| [AI 入口](ai/README.md) | 项目事实、按任务加载路径 | 新增领域或入口 |
| [代码地图](code-map.md) | 功能到文件、符号和测试的映射 | 入口、职责、路径变化 |
| [功能研究地图](feature-research-map.md) | 如何追踪行为、验证假设 | 调用链、研究问题和证据变化 |
| [领域约束](ai/domain-invariants.md) | 容易误改的业务和数据规则 | 规则或兼容边界变化 |
| [架构](architecture.md) | 运行时、分层、请求和持久化路径 | 服务边界、认证或存储变化 |
| [数据格式](data-formats.md) / [数据来源](data-sources.md) | 对外契约、单位、来源与降级 | API、上游或数据口径变化 |
| [复盘专题](trading-review.md) | 复盘、策略规则、草稿与备份语义 | 复盘相关行为变化 |
| [验证指南](ai/verification.md) | 检查选择、环境和脚本边界 | 测试/脚本/运行环境变化 |
| [文档维护矩阵](ai/documentation-maintenance.md) | 修改后更新哪些上下文 | 文档职责变化 |

## 历史研究与评审证据（按需读取）

这些文档不参与每次任务的默认加载，也不替代当前实现验证。

| 记录 | 用途 |
| --- | --- |
| [财务验证 2026-08-19](financial-validation-2026-08-19.md) | 当时的财务口径和验证记录 |
| [UX 评审 2026-10-08](ux-review-2026-10-08.md) | 当时的页面体验问题与建议，不代表每项仍未完成 |
| [隔日统计回测 2026-08-18](../web/reports/next-day-prediction-backtest-2026-08-18.md) | 当时数据与模型下的验证 |
| [隔日统计优化 2026-08-18](../web/reports/next-day-prediction-optimization-2026-08-18.md) | 当时优化方案与结果 |
| [主力意图验证 2026-08-27](../web/reports/main-force-intent-validation-2026-08-27.md) | 规则代理的历史验证 |

贡献流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)，漏洞报告见 [SECURITY.md](../SECURITY.md)。
