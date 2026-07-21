import type { FinancialDataset } from "./financials.ts";
import type { Candle, IndicatorSet, Timeframe } from "./market.ts";
import type { NewsItem, NewsSentiment, ParsedNewsDataset } from "./news.ts";

export type ChartEventKind = "news" | "report" | "dividend";

export type ChartEvent = {
  date: string;
  kind: ChartEventKind;
  label: string;
  tone: "up" | "down" | "neutral";
};

export type BacktestHorizon = {
  periods: number;
  samples: number;
  wins: number;
  winRate: number | null;
  averageReturn: number | null;
  medianReturn: number | null;
  worstAdverseMove: number | null;
};

export type SignalBacktest = {
  totalSignals: number;
  buySignals: number;
  sellSignals: number;
  horizons: BacktestHorizon[];
};

export type WatchlistItem = {
  code: string;
  name: string;
  price: number | null;
  changePct: number | null;
  peTtm: number | null;
  pb: number | null;
  dividendYieldTtm: number | null;
  sentiment: NewsSentiment | null;
  updatedAt: string;
};

export type PriceAlert = {
  id: string;
  code: string;
  name: string;
  direction: "above" | "below";
  target: number;
  createdAt: string;
  triggeredAt: string;
};

export type SavedWorkspace = {
  version: 1;
  code: string;
  isDemo: boolean;
  timeframe: Timeframe;
  lowerIndicator: string;
  overlays: string[];
  range: { from: number; to: number };
  savedAt: string;
};

export function backtestGuideSignals(
  candles: Candle[],
  indicators: IndicatorSet,
  periods: number[] = [5, 10, 20],
): SignalBacktest {
  const signals: Array<{ index: number; direction: "buy" | "sell" }> = [];
  let previous: { index: number; direction: "buy" | "sell" } | null = null;
  indicators.guidePoints.forEach((guide, index) => {
    if (!guide) return;
    if (previous && previous.direction === guide.type && index - previous.index <= 3) return;
    const signal = { index, direction: guide.type };
    signals.push(signal);
    previous = signal;
  });

  const horizons = [...new Set(periods)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right)
    .map((horizon): BacktestHorizon => {
      const outcomes = signals.flatMap((signal) => {
        const target = candles[signal.index + horizon];
        const entry = candles[signal.index];
        if (!entry || !target || entry.close <= 0) return [];
        const direction = signal.direction === "buy" ? 1 : -1;
        const strategyReturn = ((target.close / entry.close) - 1) * 100 * direction;
        const path = candles.slice(signal.index + 1, signal.index + horizon + 1);
        const worstAdverseMove = signal.direction === "buy"
          ? Math.min(0, ...path.map((candle) => ((candle.low / entry.close) - 1) * 100))
          : Math.min(0, ...path.map((candle) => ((entry.close / candle.high) - 1) * 100));
        return [{ strategyReturn, worstAdverseMove }];
      });
      const returns = outcomes.map((item) => item.strategyReturn);
      const wins = returns.filter((value) => value > 0).length;
      return {
        periods: horizon,
        samples: outcomes.length,
        wins,
        winRate: outcomes.length ? (wins / outcomes.length) * 100 : null,
        averageReturn: outcomes.length ? average(returns) : null,
        medianReturn: outcomes.length ? median(returns) : null,
        worstAdverseMove: outcomes.length ? Math.min(...outcomes.map((item) => item.worstAdverseMove)) : null,
      };
    });

  return {
    totalSignals: signals.length,
    buySignals: signals.filter((signal) => signal.direction === "buy").length,
    sellSignals: signals.filter((signal) => signal.direction === "sell").length,
    horizons,
  };
}

export function buildChartEvents(
  newsItems: NewsItem[],
  financialDataset: FinancialDataset,
  code: string,
): ChartEvent[] {
  const events: ChartEvent[] = [];
  newsItems
    .filter((item) => item.code === code)
    .slice(0, 40)
    .forEach((item) => {
      const date = extractDate(item.publishedAt);
      if (!date) return;
      events.push({
        date,
        kind: "news",
        label: item.title,
        tone: item.sentiment === "正面" ? "up" : item.sentiment === "负面" ? "down" : "neutral",
      });
    });
  if (financialDataset.code === code) {
    financialDataset.reports.forEach((report) => {
      const date = extractDate(report.noticeDate || report.reportDate);
      if (!date) return;
      events.push({
        date,
        kind: "report",
        label: `${report.periodLabel}财报发布`,
        tone: (report.netProfitYoY ?? 0) > 0 ? "up" : (report.netProfitYoY ?? 0) < 0 ? "down" : "neutral",
      });
    });
    const dividendDate = extractDate(financialDataset.snapshot.latestDividendDate);
    if (dividendDate) {
      events.push({
        date: dividendDate,
        kind: "dividend",
        label: financialDataset.snapshot.latestDividendProfile || "现金分红",
        tone: "up",
      });
    }
  }
  return events.sort((left, right) => left.date.localeCompare(right.date));
}

export function parseWatchlist(value: unknown): WatchlistItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<WatchlistItem>;
    const code = String(candidate.code ?? "").trim();
    const name = String(candidate.name ?? "").trim();
    if (!/^\d{6}$/.test(code) || !name || seen.has(code)) return [];
    seen.add(code);
    return [{
      code,
      name,
      price: nullableNumber(candidate.price),
      changePct: nullableNumber(candidate.changePct),
      peTtm: nullableNumber(candidate.peTtm),
      pb: nullableNumber(candidate.pb),
      dividendYieldTtm: nullableNumber(candidate.dividendYieldTtm),
      sentiment: candidate.sentiment === "正面" || candidate.sentiment === "中性" || candidate.sentiment === "负面" ? candidate.sentiment : null,
      updatedAt: String(candidate.updatedAt ?? ""),
    }];
  }).slice(0, 12);
}

export function parsePriceAlerts(value: unknown): PriceAlert[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<PriceAlert>;
    const target = Number(candidate.target);
    const code = String(candidate.code ?? "").trim();
    const direction = candidate.direction;
    if (!/^\d{6}$/.test(code) || !Number.isFinite(target) || target <= 0 || (direction !== "above" && direction !== "below")) return [];
    return [{
      id: String(candidate.id || `${code}-${direction}-${target}`),
      code,
      name: String(candidate.name || code),
      direction,
      target,
      createdAt: String(candidate.createdAt ?? ""),
      triggeredAt: String(candidate.triggeredAt ?? ""),
    }];
  }).slice(0, 30);
}

export function evaluatePriceAlerts(
  alerts: PriceAlert[],
  code: string,
  price: number,
  triggeredAt: string,
): PriceAlert[] {
  if (!Number.isFinite(price) || price <= 0) return alerts;
  return alerts.map((alert) => {
    if (alert.code !== code || alert.triggeredAt) return alert;
    const matched = alert.direction === "above" ? price >= alert.target : price <= alert.target;
    return matched ? { ...alert, triggeredAt } : alert;
  });
}

export function buildResearchReport({
  code,
  name,
  timeframe,
  candles,
  conclusion,
  backtest,
  financialDataset,
  newsDataset,
  generatedAt,
}: {
  code: string;
  name: string;
  timeframe: Timeframe;
  candles: Candle[];
  conclusion: { label: string; summary: string; points: string[] } | null;
  backtest: SignalBacktest;
  financialDataset: FinancialDataset;
  newsDataset: ParsedNewsDataset;
  generatedAt: string;
}): string {
  const latest = candles.at(-1);
  const snapshot = financialDataset.code === code ? financialDataset.snapshot : null;
  const lines = [
    `# TickLens 研究报告：${name || code} ${code}`,
    "",
    `- 生成时间：${generatedAt}`,
    `- K线周期：${timeframe}`,
    `- 数据区间：${candles.at(0)?.key ?? "—"} 至 ${latest?.key ?? "—"}`,
    `- 最新收盘：${latest ? latest.close.toFixed(3) : "—"}`,
    `- 最新涨跌幅：${latest ? `${latest.changePct >= 0 ? "+" : ""}${latest.changePct.toFixed(2)}%` : "—"}`,
    "",
    "## K线研判",
    "",
    conclusion ? `**${conclusion.label}**：${conclusion.summary}` : "样本不足，暂无法生成研判。",
    ...(conclusion?.points.map((point) => `- ${point}`) ?? []),
    "",
    "## B/S 信号历史验证",
    "",
    `共识别 ${backtest.totalSignals} 个去重信号（B ${backtest.buySignals} / S ${backtest.sellSignals}）。`,
    ...backtest.horizons.map((item) => `- ${item.periods}期：样本 ${item.samples}，胜率 ${formatPercent(item.winRate)}，平均收益 ${formatPercent(item.averageReturn)}，最差不利波动 ${formatPercent(item.worstAdverseMove)}`),
    "",
    "## 估值与基本面",
    "",
    `- PE TTM：${formatMultiple(snapshot?.peTtm ?? null)}`,
    `- PB：${formatMultiple(snapshot?.pb ?? null)}`,
    `- 股息率 TTM：${formatPercent(snapshot?.dividendYieldTtm ?? null)}`,
    `- 财报截至：${financialDataset.analysis.latestReportDate || "—"}`,
    "",
    "## 舆情",
    "",
    `- 新闻数量：${newsDataset.summary.total}`,
    `- 综合倾向：${newsDataset.summary.tone}`,
    `- 综合得分：${newsDataset.summary.averageScore.toFixed(3)}`,
    ...newsDataset.items.slice(0, 5).map((item) => `- ${item.publishedAt || "时间未知"}｜${item.sentiment}｜[${item.title}](${item.url})`),
    "",
    "> 本报告由公开数据和规则模型生成，仅供研究参考，不构成投资建议。信号回测未计入手续费、滑点和涨跌停成交约束。",
    "",
  ];
  return lines.join("\n");
}

function extractDate(value: string): string {
  return value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatPercent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMultiple(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}x`;
}
