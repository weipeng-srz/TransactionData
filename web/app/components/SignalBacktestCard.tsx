import { memo } from "react";
import type { SignalBacktest } from "../lib/research";
import type { StockMarket } from "../lib/security";
import styles from "./SignalBacktestCard.module.css";

function SignalBacktestCard({ backtest, benchmarkName = "沪深300", market = "CN", priceBasis = "", onCostChange }: { backtest: SignalBacktest; benchmarkName?: string; market?: StockMarket; priceBasis?: string; onCostChange?: (value: number) => void }) {
  const buyHorizons = backtest.directions?.buy.horizons ?? backtest.horizons;
  const sellHorizons = backtest.directions?.sell.horizons ?? [];
  const primary = buyHorizons.find((item) => item.periods === 10) ?? buyHorizons[0];
  const sellPrimary = sellHorizons.find((item) => item.periods === 10) ?? sellHorizons[0];
  return (
    <section className="rail-card backtest-card" id="signal-backtest">
      <div className="rail-heading">
        <div className={styles.headingControls}>
          <p className="eyebrow">HISTORICAL VALIDATION</p>
          <h3>B 收益 / S 风险验证</h3>
          <span className={`${styles.regimeBadge} ${styles[backtest.recent?.status ?? "insufficient"]}`}>{backtest.recent?.label ?? "近期样本不足"}</span>
        </div>
        <div>
          <label className={styles.costControl}>交易摩擦
            <input type="number" min="0" max="5" step="0.05" value={backtest.roundTripCostPct} onChange={(event) => onCostChange?.(Math.max(0, Math.min(5, Number(event.target.value) || 0)))} aria-label="回测单次往返交易摩擦百分比" />
            <span>%</span>
          </label>
          <span className="calc-badge">{backtest.totalSignals} SIGNALS</span>
        </div>
      </div>
      <div className={styles.directionGrid}>
        <DirectionHero label="B 点 · 可交易方向" primary={primary} count={backtest.buySignals} />
        <DirectionHero label="S 点 · 仅风险提示" primary={sellPrimary} count={backtest.sellSignals} warning />
      </div>
      <div className="backtest-table-wrap">
        <table className="backtest-table">
          <thead><tr><th>方向</th><th>观察期</th><th>样本</th><th>胜率</th><th>平均收益</th><th>Profit Factor</th><th>平均成本</th></tr></thead>
          <tbody>
            {buyHorizons.map((item) => <HorizonRow key={`buy-${item.periods}`} label="B" item={item} />)}
            {sellHorizons.map((item) => <HorizonRow key={`sell-${item.periods}`} label="S" item={item} warning />)}
          </tbody>
        </table>
      </div>
      {primary ? (
        <div className="backtest-risk-grid" aria-label={`${primary.periods}期回测风险指标`}>
          <Metric label="期望收益" value={formatPercent(primary.expectancy)} tone={primary.expectancy} />
          <Metric label="盈亏比" value={formatRatio(primary.payoffRatio)} />
          <Metric label="Profit Factor" value={formatRatio(primary.profitFactor)} />
          <Metric label="信号序列回撤" value={formatPercent(primary.maxDrawdown)} tone={primary.maxDrawdown} />
          <Metric label="最大连亏" value={`${primary.maxLossStreak} 次`} />
          <Metric label={`相对${benchmarkName}`} value={formatPercent(primary.averageExcessReturn)} tone={primary.averageExcessReturn} />
        </div>
      ) : null}
      <p className="method-note">{backtest.executionModel}；输入的 {backtest.roundTripCostPct.toFixed(2)}% 为回测单次往返交易摩擦百分比基础值，流动性模型会在其上估算手续费、税费与滑点合计假设，并跳过无量{market === "CN" ? "或按板块与历史日期识别的单边涨跌停开盘" : "开盘"}样本。价格口径：{priceBasis || "未明确复权，需核对分红送转影响"}。胜率区间使用 Wilson 95% 估计；卖出信号仅作方向验证，不代表可直接做空。样本少时不应外推。</p>
    </section>
  );
}

export default memo(SignalBacktestCard);

function DirectionHero({ label, primary, count, warning = false }: { label: string; primary: SignalBacktest["horizons"][number] | undefined; count: number; warning?: boolean }) {
  return (
    <div className={`${styles.directionHero} ${warning ? styles.warningHero : ""}`}>
      <span>{label}</span>
      <strong className={tone(primary?.averageReturn ?? null)}>{formatPercent(primary?.averageReturn ?? null)}</strong>
      <small>{primary?.periods ?? 10}期平均 · {count} 个信号 · 胜率 {formatPercent(primary?.winRate ?? null)} · 95%区间 {formatRange(primary?.winRateLow ?? null, primary?.winRateHigh ?? null)}</small>
    </div>
  );
}

function HorizonRow({ label, item, warning = false }: { label: "B" | "S"; item: SignalBacktest["horizons"][number]; warning?: boolean }) {
  return (
    <tr className={warning ? styles.warningRow : ""}>
      <td><strong>{label}</strong></td>
      <td>{item.periods} 根K线</td>
      <td>{item.samples}</td>
      <td>{formatPercent(item.winRate)}</td>
      <td className={tone(item.averageReturn)}>{formatPercent(item.averageReturn)}</td>
      <td>{formatRatio(item.profitFactor)}</td>
      <td>{formatPercent(item.averageCostPct ?? null)}</td>
    </tr>
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
