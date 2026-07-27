import type { SignalBacktest } from "../lib/research";

export default function SignalBacktestCard({ backtest }: { backtest: SignalBacktest }) {
  const primary = backtest.horizons.find((item) => item.periods === 10) ?? backtest.horizons[0];
  return (
    <section className="rail-card backtest-card" id="signal-backtest">
      <div className="rail-heading">
        <div>
          <p className="eyebrow">HISTORICAL VALIDATION</p>
          <h3>B/S 信号回测</h3>
        </div>
        <span className="calc-badge">{backtest.totalSignals} SIGNALS</span>
      </div>
      <div className="backtest-layout">
        <div className="backtest-hero">
          <span>{primary ? `${primary.periods}期信号胜率` : "信号胜率"}</span>
          <strong className={(primary?.winRate ?? 0) >= 50 ? "is-up" : "is-down"}>{formatPercent(primary?.winRate ?? null)}</strong>
          <small>B {backtest.buySignals} · S {backtest.sellSignals} · 跳过 {backtest.skippedSignals} · 95%区间 {formatRange(primary?.winRateLow ?? null, primary?.winRateHigh ?? null)}</small>
        </div>
        <div className="backtest-table-wrap">
          <table className="backtest-table">
            <thead><tr><th>观察期</th><th>样本</th><th>胜率</th><th>平均收益</th><th>中位收益</th><th>最差不利波动</th></tr></thead>
            <tbody>
              {backtest.horizons.map((item) => (
                <tr key={item.periods}>
                  <td>{item.periods} 根K线</td>
                  <td>{item.samples}</td>
                  <td>{formatPercent(item.winRate)}</td>
                  <td className={tone(item.averageReturn)}>{formatPercent(item.averageReturn)}</td>
                  <td className={tone(item.medianReturn)}>{formatPercent(item.medianReturn)}</td>
                  <td className="is-down">{formatPercent(item.worstAdverseMove)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {primary ? (
        <div className="backtest-risk-grid" aria-label={`${primary.periods}期回测风险指标`}>
          <Metric label="期望收益" value={formatPercent(primary.expectancy)} tone={primary.expectancy} />
          <Metric label="盈亏比" value={formatRatio(primary.payoffRatio)} />
          <Metric label="Profit Factor" value={formatRatio(primary.profitFactor)} />
          <Metric label="信号序列回撤" value={formatPercent(primary.maxDrawdown)} tone={primary.maxDrawdown} />
          <Metric label="最大连亏" value={`${primary.maxLossStreak} 次`} />
          <Metric label="相对沪深300" value={formatPercent(primary.averageExcessReturn)} tone={primary.averageExcessReturn} />
        </div>
      ) : null}
      <p className="method-note">{backtest.executionModel}；方向收益已扣除约 {backtest.roundTripCostPct.toFixed(2)}% 交易摩擦，并跳过无量或单边涨跌停开盘样本。胜率区间使用 Wilson 95% 估计；卖出信号仅作方向验证，不代表可直接做空。样本少时不应外推。</p>
    </section>
  );
}

function Metric({ label, value, tone: metricTone }: { label: string; value: string; tone?: number | null }) {
  return <div><span>{label}</span><strong className={metricTone == null ? "" : tone(metricTone)}>{value}</strong></div>;
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function tone(value: number | null): string {
  return (value ?? 0) > 0 ? "is-up" : (value ?? 0) < 0 ? "is-down" : "";
}

function formatRatio(value: number | null): string { return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}x`; }
function formatRange(low: number | null, high: number | null): string { return low == null || high == null ? "—" : `${low.toFixed(0)}–${high.toFixed(0)}%`; }
