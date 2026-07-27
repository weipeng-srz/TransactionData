import type { FinancialDataset } from "./financials.ts";
import type { Candle } from "./market.ts";
import type { ChartEvent, RiskMetrics } from "./research.ts";

export type FactorProfile = {
  key: "value" | "quality" | "growth" | "momentum" | "lowVol" | "dividend";
  label: string;
  score: number | null;
  evidence: string;
};

export type EventStudy = ChartEvent & {
  category: string;
  onePeriod: number | null;
  fivePeriods: number | null;
  twentyPeriods: number | null;
};

export function buildFactorProfile(candles: Candle[], financials: FinancialDataset, risk: RiskMetrics): FactorProfile[] {
  const latest = financials.analysis.periods[0];
  const snapshot = financials.snapshot;
  const return20 = periodReturn(candles, 20);
  const return60 = periodReturn(candles, 60);
  const return120 = periodReturn(candles, 120);
  const valuationInputs = [
    snapshot.peTtm && snapshot.peTtm > 0 ? inverseScore(snapshot.peTtm, 8, 45) : null,
    snapshot.pb && snapshot.pb > 0 ? inverseScore(snapshot.pb, 0.8, 8) : null,
    snapshot.psTtm && snapshot.psTtm > 0 ? inverseScore(snapshot.psTtm, 0.8, 12) : null,
  ];
  const qualityInputs = [
    latest?.ttm.roe == null ? null : scaleScore(latest.ttm.roe, 0, 25),
    latest?.ttm.roic == null ? null : scaleScore(latest.ttm.roic, 0, 20),
    latest?.ttm.cashCoverage == null ? null : scaleScore(latest.ttm.cashCoverage, 0, 1.5),
  ];
  const growthInputs = [latest?.ttmYoY.revenue, latest?.ttmYoY.deductNetProfit].map((value) => value == null ? null : scaleScore(value, -20, 35));
  const momentumInputs = [return20, return60, return120].map((value) => value == null ? null : scaleScore(value, -20, 35));
  const lowVolScore = risk.annualizedVolatility == null ? null : inverseScore(risk.annualizedVolatility, 12, 60);
  const dividendScore = snapshot.dividendYieldTtm == null ? null : scaleScore(snapshot.dividendYieldTtm, 0, 5);
  return [
    { key: "value", label: "价值", score: averageScore(valuationInputs), evidence: `PE ${multiple(snapshot.peTtm)} · PB ${multiple(snapshot.pb)} · PS ${multiple(snapshot.psTtm)}` },
    { key: "quality", label: "质量", score: averageScore(qualityInputs), evidence: `ROE ${percent(latest?.ttm.roe ?? null)} · ROIC ${percent(latest?.ttm.roic ?? null)} · 现金含量 ${ratio(latest?.ttm.cashCoverage ?? null)}` },
    { key: "growth", label: "成长", score: averageScore(growthInputs), evidence: `TTM营收 ${percent(latest?.ttmYoY.revenue ?? null)} · 扣非利润 ${percent(latest?.ttmYoY.deductNetProfit ?? null)}` },
    { key: "momentum", label: "动量", score: averageScore(momentumInputs), evidence: `20/60/120日 ${[return20, return60, return120].map(percent).join(" · ")}` },
    { key: "lowVol", label: "低波", score: lowVolScore, evidence: `年化波动 ${percent(risk.annualizedVolatility)}` },
    { key: "dividend", label: "股息", score: dividendScore, evidence: `TTM股息率 ${percent(snapshot.dividendYieldTtm)}` },
  ];
}

export function buildEventStudies(events: ChartEvent[], candles: Candle[]): EventStudy[] {
  const indexByDate = new Map(candles.map((candle, index) => [candle.date, index]));
  return [...events].reverse().flatMap((event) => {
    const index = indexByDate.get(event.date);
    if (index == null) return [];
    return [{ ...event, category: eventCategory(event), onePeriod: forwardReturn(candles, index, 1), fivePeriods: forwardReturn(candles, index, 5), twentyPeriods: forwardReturn(candles, index, 20) }];
  }).slice(0, 12);
}

function eventCategory(event: ChartEvent): string {
  if (event.kind === "report") return "财报";
  if (event.kind === "dividend") return "分红";
  const title = event.label;
  for (const category of ["回购", "增持", "减持", "解禁", "中标", "处罚", "问询", "并购", "分红", "业绩"]) if (title.includes(category)) return category;
  return "新闻";
}

function periodReturn(candles: Candle[], periods: number): number | null {
  if (candles.length <= periods) return null;
  const start = candles[candles.length - periods - 1];
  const end = candles.at(-1)!;
  return start.close > 0 ? ((end.close / start.close) - 1) * 100 : null;
}
function forwardReturn(candles: Candle[], index: number, periods: number): number | null {
  const start = candles[index];
  const end = candles[index + periods];
  return start?.close > 0 && end ? ((end.close / start.close) - 1) * 100 : null;
}
function scaleScore(value: number, low: number, high: number): number { return Math.round(Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100))); }
function inverseScore(value: number, low: number, high: number): number { return 100 - scaleScore(value, low, high); }
function averageScore(values: Array<number | null>): number | null { const usable = values.filter((value): value is number => value != null); return usable.length ? Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length) : null; }
function percent(value: number | null): string { return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`; }
function multiple(value: number | null): string { return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}x`; }
function ratio(value: number | null): string { return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}x`; }
