import { holdingRiskStatus, type HoldingRiskPlan } from "../lib/holdingRisk";
import "./holding-risk.css";

export default function HoldingRiskSummary({ plan, currentPrice }: { plan: HoldingRiskPlan | null; currentPrice: number | null }) {
  if (!plan) return null;
  const status = holdingRiskStatus(plan, currentPrice);
  const currency = plan.market === "US" ? "美元" : "元";
  const price = (value: number | null) => value == null ? "—" : new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: value < 1 ? 6 : 3 }).format(value);
  const percent = (value: number | null) => value == null ? "等待完整日线" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}% · 相对成本`;
  return (
    <section className="holding-risk-summary" aria-label="持仓止盈止损参考">
      <div className="holding-risk-heading">
        <div><strong>持仓止盈止损</strong><span>{plan.shares.toLocaleString("zh-CN")} 股 · {currency}</span></div>
        <span className={`holding-risk-status is-${status.tone}`} role="status">{status.label}</span>
      </div>
      <div className="holding-risk-levels">
        <div className="holding-risk-cost"><span><i />持仓成本</span><strong>{price(plan.cost)}</strong><small>当前保存的平均成本</small></div>
        <div className="holding-risk-profit"><span><i />建议止盈</span><strong>{price(plan.takeProfit)}</strong><small>{percent(plan.takeProfitPct)}</small></div>
        <div className="holding-risk-stop"><span><i />建议止损</span><strong>{price(plan.stopLoss)}</strong><small>{percent(plan.stopLossPct)}</small></div>
      </div>
      <details className="holding-risk-method">
        <summary>{plan.state === "ready" ? `ATR14 ${price(plan.atr)} · 盈亏比 ${plan.riskRewardRatio?.toFixed(2)} · 查看算法依据` : plan.reason}</summary>
        {plan.state === "ready" ? <p>{plan.reason}支撑/压力取近 20 个完整交易日；止损至少保留 0.5×ATR 缓冲，压力位需高于成本 + 1×ATR 才参与计算。</p> : null}
        <p>{plan.asOf ? `日线截至 ${plan.asOf}。` : "暂无完整日线。"}{plan.priceBasis ? `行情口径：${plan.priceBasis}。` : ""}参考位随完整日线和持仓成本更新，盘中报价不改变参考位。仅作持仓风控参考，不自动下单。</p>
      </details>
      {plan.chartAdjustmentFactor != null && plan.chartAdjustmentFactor !== 1 ? <p className="holding-risk-adjustment">上方显示实际价格；图中参考位 = 实际价格 ÷ 最新复权因子 {price(plan.chartAdjustmentFactor)}。</p> : null}
    </section>
  );
}
