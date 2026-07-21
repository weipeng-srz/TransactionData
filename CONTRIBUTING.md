# 贡献指南

感谢你愿意改进 TickLens。项目同时包含 Go 数据工具和 Web 研究工作台；为了让评审可复现，请保持每个 Pull Request 目标明确、改动尽量小，并同步更新测试与文档。

## 开始之前

1. 搜索现有 Issue 和 Pull Request，避免重复工作。
2. 对较大的功能、数据源变更或输出格式变更，先创建 Issue 讨论边界和兼容性。
3. 安全问题不要公开披露，请按照 [`SECURITY.md`](./SECURITY.md) 报告。

## 本地开发

需要 Go 1.21+、Node.js 22.13+、pnpm 10 和 Make：

```bash
git clone https://github.com/weipeng-srz/TransactionData.git
cd TransactionData
make setup
make check
```

常用命令：

```bash
make dev        # 启动 Web 开发服务
make build-go   # 构建两个 Go 命令到 bin/
make build-web  # 构建 Web 应用
make check      # 格式、静态检查、构建和全部测试
```

Windows 用户可以直接运行 README 中列出的 Go 与 pnpm 命令。

## 分支与提交

- 从最新的默认分支创建主题分支。
- 推荐使用 `feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:` 等清晰前缀。
- 不要提交 `node_modules/`、`dist/`、二进制、抓取生成的 CSV、IDE 配置或任何密钥。
- 外部数据响应只能放入测试夹具时，必须最小化并完成脱敏，同时确认允许再分发。

## 代码要求

- Go 代码通过 `gofmt`、`go vet` 和 `go test ./...`。
- Web 代码通过 `pnpm lint` 和 `pnpm test`。
- 变更公开行为、CSV 格式、指标算法或数据源解析时，必须添加回归测试。
- 保持错误信息可操作；不要静默吞掉会造成数据口径错误的异常。
- 不绕过网站访问控制，不增加规避限流、验证码或授权校验的逻辑。

## Pull Request

请在描述中说明：

- 要解决的问题和方案选择；
- 受影响的命令、页面、API 或数据格式；
- 自动化测试与手工验证结果；
- 兼容性、数据来源、隐私或投资风险方面的变化。

提交即表示你同意按本仓库的 MIT License 许可你的贡献。
