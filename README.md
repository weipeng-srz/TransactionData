<div align="center">

# TickLens

面向沪深 A 股的开源市场研究工作台与数据导出工具

[![CI](https://github.com/weipeng-srz/TransactionData/actions/workflows/ci.yml/badge.svg)](https://github.com/weipeng-srz/TransactionData/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Go](https://img.shields.io/badge/Go-1.21%2B-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

</div>

![TickLens 市场研究工作台](./web/public/og-apple.png)

TickLens 把行情、基本面、新闻舆情、技术指标、信号回测和价格提醒放进同一个研究界面，并提供两个可独立运行的 Go 命令，用于导出历史 Level-1 分笔成交和股票相关新闻。

> [!WARNING]
> 本项目仅用于学习、数据工程和量化研究，不构成投资建议、收益承诺或交易依据。公开免费数据源可能延迟、限流、变更或出错，请在重要决策前交叉核验。

## 功能

### Web 研究工作台

- 输入股票名称或代码，并行获取行情、估值、分红、财务报表和新闻；任一数据源完成后立即更新对应区域。
- 支持多周期 K 线、MA/EMA/BOLL/VWAP、MACD/KDJ/RSI、神奇九转与组合 B/S 研究信号。
- 展示财务趋势、现金流质量、资产质量、估值匹配和规则异常提示。
- 提供新闻情绪初筛、事件标注、信号回测、风险指标、自选股和价格越界提醒。
- 支持明暗主题、基础/专业视图、研究状态保存、Markdown 报告导出和桌面行情监控页。

### Go 数据工具

- `stock-ticks`：导出最近若干完整交易日的通达信 Level-1 历史分笔，并补充前复权因子与流通 A 股本。
- `stock-news`：聚合东方财富、新浪和中国新闻网的股票相关新闻，去重后进行基础中文情绪分析。
- CSV 均采用临时文件写完再原子替换，避免中断时留下不完整结果。

## 快速开始

### 运行 Web 工作台

需要 Node.js 22.13+、pnpm 10 和 Git：

```bash
git clone https://github.com/weipeng-srz/TransactionData.git
cd TransactionData
make setup
make dev
```

打开终端显示的本地地址。Web 版本通过服务端 API 获取公开行情、财务与新闻数据，本地运行不要求预先构建 Go 命令。

如果系统没有 Make：

```bash
cd web
pnpm install --frozen-lockfile
pnpm dev
```

### 构建 Go 命令

需要 Go 1.21+：

```bash
make build-go
./bin/stock-ticks -code 600000 -days 90 -output ./result/data.csv
./bin/stock-news -code 600000 -limit 30 -output ./result/news.csv
```

Windows PowerShell：

```powershell
$env:CGO_ENABLED=0
go build -trimpath -o bin/stock-ticks.exe ./cmd/stock-ticks
go build -trimpath -o bin/stock-news.exe ./cmd/stock-news
```

两个命令都支持交互输入股票代码；使用 `-h` 查看完整参数。

## 项目结构

```text
.
├── cmd/
│   ├── stock-ticks/       # 历史分笔导出命令
│   └── stock-news/        # 新闻聚合命令
├── internal/              # Go 内部数据源、解析与 CSV 模块
├── web/                   # Next.js/vinext Web 工作台与 Cloudflare Worker
├── docs/                  # 架构、数据格式和数据源说明
├── .github/               # CI、Dependabot、Issue 与 PR 模板
├── Makefile               # 统一开发入口
└── README.md
```

更完整的依赖关系和数据流见 [`docs/architecture.md`](./docs/architecture.md)。

## 数据说明

`stock-ticks` 输出的是免费行情协议提供的 **Level-1 历史分笔**，不是交易所 Level-2 逐笔委托：

- 一行可能聚合多笔真实成交；
- 不包含逐笔委托、撤单、交易所成交序号或买卖双方订单号；
- 买卖性质只能用作方向代理，不能据此识别真实机构行为；
- 历史分笔时间精度为分钟，同一分钟可能有多条记录。

详细字段、计算口径和兼容说明见 [`docs/data-formats.md`](./docs/data-formats.md)。数据来源、限制和合规边界见 [`docs/data-sources.md`](./docs/data-sources.md)。

## 开发与验证

```bash
make check       # Go 格式与静态检查、前端 lint、全部构建和测试
make build       # 构建两个 Go 命令和 Web 应用
make test-go     # 只运行 Go 测试
make test-web    # 只运行 Web 构建与测试
```

所有 Pull Request 都会通过 GitHub Actions 运行相同的核心检查。贡献前请阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/architecture.md`](./docs/architecture.md) | 系统边界、目录职责和主要数据流 |
| [`docs/data-formats.md`](./docs/data-formats.md) | 两类 CSV 的字段与计算口径 |
| [`docs/data-sources.md`](./docs/data-sources.md) | 外部数据源、限制、隐私和合规说明 |
| [`web/README.md`](./web/README.md) | Web 子项目开发、测试与部署约定 |
| [`SECURITY.md`](./SECURITY.md) | 私密漏洞报告方式 |
| [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) | 第三方实现归属与许可证 |

## 贡献

Bug 报告、功能建议、文档改进和测试补充都很欢迎。较大的数据源、格式或架构变更请先创建 Issue 讨论，以便保持兼容性和数据口径一致。

请遵守 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)，安全问题请不要公开披露。

## License

本项目按 [MIT License](./LICENSE) 开源。第三方归属见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
