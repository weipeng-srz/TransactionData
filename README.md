# A 股 Level-1 历史分笔导出工具

这是一个纯 Go 命令行应用。输入一只沪深 A 股代码后，它会从通达信免费行情服务器下载最近 90 个**已经结束的交易日**的 Level-1 分笔成交，同时保留原始成交价格与前复权价格，并写入每个交易日适用的复权因子和流通 A 股本。北京时间16:00后会包含当天，否则从前一个完整交易日开始。

## 构建

需要 Go 1.21 或更高版本：

```bash
CGO_ENABLED=0 go build -trimpath -o stock-ticks .
```

Windows：

```powershell
$env:CGO_ENABLED=0
go build -trimpath -o stock-ticks.exe .
```

也可以在 macOS 或 Linux 上交叉编译：

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o stock-ticks-linux-amd64 .
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -o stock-ticks-windows-amd64.exe .
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -o stock-ticks-darwin-arm64 .
```

## 使用

交互方式：

```bash
./stock-ticks
```

也可以直接传入股票代码：

```bash
./stock-ticks 600000
./stock-ticks -code 000001.SZ
```

默认抓取90个完整交易日，并写入当前执行目录的 `data.csv`。可通过参数调整：

```bash
./stock-ticks -code 600000 -days 90 -output ./result/data.csv
```

通过 `./stock-ticks -h` 查看全部选项。程序只有在数据完整下载并写完后才会替换目标 CSV；下载中断不会留下半份文件。

## CSV 字段

CSV 使用 UTF-8 编码。第一行是只出现一次的文件元数据：

- 股票代码
- 股票名称（东方财富证券简称）
- 最新交易日适用的流通 A 股本及其生效日
- 价格口径、成交数据级别、时间精度、数据序号口径和成交金额口径

随后每个交易日有一行 `#DAY` 上下文，包含交易日期、当天适用的前复权因子、流通 A 股本及股本生效日。这样可以按日正确计算换手率，又不必在每笔成交中重复股本数据。

成交明细表包含：

- 交易日期、成交时间、文件内单日数据序号
- 原始成交价格、前复权成交价格、成交量、按原始价格计算的成交金额
- 解析后的性质、原始性质代码、交易时段

程序使用新浪前复权因子，按 `前复权成交价 = 原始成交价 ÷ 前复权因子` 输出；资金流和大额成交分析应使用原始成交金额，前复权价格用于连续 K 线。流通 A 股本来自东方财富历史股本结构。

通达信历史分笔只提供分钟级时间，同一分钟可能存在多条记录。`数据序号` 仅表示数据源返回后在文件中的单日顺序，不是交易所成交序号或订单号。程序将原始性质代码转换为买盘、卖盘、中性盘或其他，并同时保留原始代码供校验。15:00 后的记录会单独标记为盘后交易。

## 数据口径与限制

本程序使用通达信 7709 免费行情协议，只支持沪深市场。它提供的是 **Level-1 历史分笔成交**，不是真正的交易所 Level-2 数据：

- 一行数据可能汇总多笔真实成交，不能理解为一张交易所原始订单。
- 不包含逐笔委托、撤单、成交序号、买方订单号和卖方订单号。
- 买卖性质来自通达信行情标记，只适合做大单倾向代理分析。
- “主力行为”只能表达为概率代理和置信度，不能仅凭主动净额认定真实机构意图。
- 股票名称取自东方财富股本结构响应中的证券简称；旧版 CSV 没有名称时，Web 页面会继续只显示股票代码。
- 北交所历史分笔暂不可靠支持，程序会明确拒绝北交所代码。
- 免费服务器可能变更、限流或临时不可用，也没有服务等级保证。
- 新浪和东方财富的公开接口并非带服务等级保证的正式数据 API；前复权或流通股本数据缺失时程序会停止导出，避免生成口径不完整的 CSV。

如果业务要求真正 Level-2 逐笔成交和逐笔委托，需要以后接入有权限的券商 QMT 或持牌数据服务商。

项目仅用于学习和研究，不构成投资建议。使用前请确认符合数据提供方条款以及当地法律法规。TDX 协议实现的开源归属说明见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

## 舆情新闻采集模块

`stock-news` 是一个可独立打包、独立运行的纯 Go 命令。输入沪深北股票代码后，它会先查询证券简称，再并行检索东方财富财经/股票内容、新浪新闻/财经内容和中国新闻网全站内容，过滤与目标股票无关的结果、按标题去重，并输出基础中文情绪倾向。

构建：

```bash
CGO_ENABLED=0 go build -trimpath -o stock-news ./cmd/stock-news
```

Windows：

```powershell
$env:CGO_ENABLED=0
go build -trimpath -o stock-news.exe ./cmd/stock-news
```

使用股票代码运行：

```bash
./stock-news 600000
./stock-news -code 000001.SZ
```

默认每个检索入口最多读取 20 条新闻，并写入当前执行目录的 `news.csv`。可调整上限、超时和输出路径：

```bash
./stock-news -code 600000 -limit 30 -timeout 15s -output ./result/news.csv
```

证券简称接口不可用时，可以手工指定简称后继续运行：

```bash
./stock-news -code 600000 -name 浦发银行
```

`news.csv` 包含股票代码、股票名称、检索入口、频道、媒体来源、发布时间、相关性得分、情绪倾向、情绪得分、命中的正负向词、标题、摘要、原文链接和采集时间。只有全部检索入口都失败时程序才会终止；单个入口临时不可用会输出警告并保存其他入口的结果。CSV 采用临时文件写完后再替换，采集中断不会留下半份文件。

情绪分析是本地关键词规则模型，适合快速初筛，不理解反讽、否定关系和复杂上下文，也不能替代人工研判或专业 NLP 模型。各公开检索入口可能调整接口、限流或要求验证，程序不会绕过网站访问控制；请控制运行频率，并遵守各站点条款和 robots 规则。

## Web 行情工作台

先构建根目录的两个命令，再启动 Web：

```bash
CGO_ENABLED=0 go build -trimpath -o stock-ticks .
CGO_ENABLED=0 go build -trimpath -o stock-news ./cmd/stock-news
cd web
pnpm install
pnpm dev
```

打开终端提示的本地地址。页面可直接输入股票代码，并行调用两个后台应用获取最近90个完整交易日和相关新闻；任一路完成后都会立即更新对应页面区域。页面展示多周期 K 线、神奇九转、B/S 组合指引、常用技术指标、K 线研判、Level-1 主力行为代理和舆情资讯。
