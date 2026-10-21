import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { calculateIndicators, LEGACY_SIGNAL_GUIDE_POLICY } from "../app/lib/market.ts";
import { buildEvents, simulatePortfolio } from "./backtest-bs-portfolio.mjs";

// Input preserves the original deterministic stock ordering. The first 120
// stocks were used for exploration; none of the remaining stocks chose weights.
const args = process.argv.slice(2);
const input = args[args.indexOf("--input") + 1];
if (!args.includes("--input") || !input) throw new Error("需要 --input 历史样本.json[.gz]");
const data = await readFile(input);
const records = JSON.parse(input.endsWith(".gz") ? gunzipSync(data).toString("utf8") : data.toString("utf8"));
const securities = records.slice(120);
if (!securities.length) throw new Error("样本必须包含前120只探索股票和额外留出股票");
const dates = [...new Set(securities.flatMap((security) => security.candles.map((candle) => candle.date)))].sort();
const endDate = dates.at(-1);
const startDate = `${Number(endDate.slice(0, 4)) - 1}${endDate.slice(4)}`;
const tradingDates = dates.filter((date) => date >= startDate);
const gate = new Map(tradingDates.map((date) => [date, { status: "active" }]));
const result = {
  period: { startDate, endDate },
  holdoutStocks: securities.length,
  trainingStocksExcluded: 120,
  symbols: securities.map((security) => security.quote.symbol),
  method: "固定10期、信号日流动性成本、40万元、最多5只、同样的分数/流动性排序；组合采用相同固定仓位上限，不根据留出结果调参。事件与组合收益分别报告。",
  caveats: "当前存续股票；非历史全市场；留出股票与探索股票共享市场日期。信号持有期重叠，未证明统计显著性；未模拟整手/最小佣金，日线成交限制为保守代理。",
  variants: {},
};

for (const [name, policy] of [["v1", LEGACY_SIGNAL_GUIDE_POLICY], ["stable", { version: "stable" }], ["v2", { version: "v2" }]]) {
  const events = securities.flatMap((security) => buildEvents({
    ...security,
    candlesByDate: new Map(security.candles.map((candle) => [candle.date, candle])),
  }, calculateIndicators(security.candles, policy), name)).filter((event) => event.direction === "buy");
  const recent = events.filter((event) => event.entryDate >= startDate);
  result.variants[name] = {
    fullHistory: summarize(events),
    recentYear: summarize(recent),
    portfolio: simulatePortfolio(recent, tradingDates, gate, name, "score-first"),
  };
}
const output = JSON.stringify(result, null, 2);
if (args.includes("--output")) await writeFile(args[args.indexOf("--output") + 1], `${output}\n`);
console.log(output);

function summarize(events) {
  const completed = events.filter((event) => event.netReturn != null);
  const returns = completed.map((event) => event.netReturn);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  return {
    samples: returns.length,
    pending: events.length - completed.length,
    winRate: returns.length ? wins.length / returns.length * 100 : null,
    meanReturnPct: returns.length ? sum(returns) / returns.length : null,
    profitFactor: losses.length ? sum(wins) / Math.abs(sum(losses)) : null,
  };
}
