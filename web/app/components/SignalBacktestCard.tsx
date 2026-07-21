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
          <small>B {backtest.buySignals} · S {backtest.sellSignals} · 连续同向信号已去重</small>
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
      <p className="method-note">按信号收盘价到未来 5/10/20 根 K 线收盘价计算方向收益；未计手续费、滑点、停牌和涨跌停成交约束，样本少时不应外推。</p>
    </section>
  );
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function tone(value: number | null): string {
  return (value ?? 0) > 0 ? "is-up" : (value ?? 0) < 0 ? "is-down" : "";
}
