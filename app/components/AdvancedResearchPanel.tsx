import type { EventStudy, FactorProfile } from "../lib/advancedResearch";
import type { RiskMetrics } from "../lib/research";

export default function AdvancedResearchPanel({ risk, factors, events, benchmarkName = "沪深300" }: { risk: RiskMetrics; factors: FactorProfile[]; events: EventStudy[]; benchmarkName?: string }) {
  return (
    <section className="advanced-research-panel" id="advanced-research">
      <header className="section-heading advanced-heading">
        <div><p className="eyebrow">RISK · FACTOR · EVENT</p><h3>高级研究透视</h3><p>将绝对收益拆成风险、相对表现、因子与事件影响。</p></div>
        <span>{risk.samples} RETURNS</span>
      </header>
      <div className="advanced-risk-grid">
        <Risk label="区间收益" value={pct(risk.totalReturn)} tone={risk.totalReturn} />
        <Risk label={`相对${benchmarkName}`} value={pct(risk.excessReturn)} tone={risk.excessReturn} />
        <Risk label="最大回撤" value={pct(risk.maxDrawdown)} tone={risk.maxDrawdown} />
        <Risk label="年化波动" value={pct(risk.annualizedVolatility)} />
        <Risk label="Beta" value={num(risk.beta)} />
        <Risk label="Alpha 年化" value={pct(risk.alphaAnnualized)} tone={risk.alphaAnnualized} />
        <Risk label="Sharpe" value={num(risk.sharpe)} />
        <Risk label="Sortino" value={num(risk.sortino)} />
        <Risk label="日 VaR 95%" value={pct(risk.valueAtRisk95)} tone={risk.valueAtRisk95} />
        <Risk label="日 ES 95%" value={pct(risk.expectedShortfall95)} tone={risk.expectedShortfall95} />
      </div>
      <div className="advanced-research-columns">
        <section className="factor-card">
          <header><div><span>六维因子</span><strong>可解释评分</strong></div><small>0–100</small></header>
          <div className="factor-list">
            {factors.map((factor) => (
                <div className="factor-row" key={factor.key}>
                  <div><strong>{factor.label}</strong><span>{factor.evidence}</span></div>
                  <div className="factor-score">
                    <span className="factor-track" aria-label={`${factor.label}评分 ${factor.score ?? "暂无"}`}><i style={{ width: `${factor.score ?? 0}%` }} /></span>
                    <b>{factor.score ?? "—"}</b>
                  </div>
                </div>
            ))}
          </div>
          <p>当前为历史数据绝对评分，未做行业中性化；评分只用于比较线索，不是投资评级。</p>
        </section>
        <section className="event-study-card">
          <header><div><span>事件研究</span><strong>公告后表现</strong></div><small>+1 / +5 / +20</small></header>
          {events.length ? <div className="event-study-list">{events.map((event, index) => (
            <article key={`${event.date}-${event.kind}-${index}`}>
              <span className={`event-kind is-${event.kind}`}>{event.kind === "news" ? "N" : event.kind === "report" ? "F" : "D"}</span>
              <div><strong>{event.label}</strong><small>{event.date} · {event.category}</small></div>
              <div className="event-returns"><em className={tone(event.onePeriod)}>{pct(event.onePeriod)}</em><em className={tone(event.fivePeriods)}>{pct(event.fivePeriods)}</em><em className={tone(event.twentyPeriods)}>{pct(event.twentyPeriods)}</em></div>
            </article>
          ))}</div> : <div className="event-study-empty">当前行情区间内暂无可定位事件。</div>}
        </section>
      </div>
      <p className="advanced-method-note">风险指标按日收益估算；VaR/ES 使用历史分布法。Alpha、Beta 与相关性仅在交易日重合时计算，不能替代情景压力测试。</p>
    </section>
  );
}

function Risk({ label, value, tone: valueTone }: { label: string; value: string; tone?: number | null }) { return <article><span>{label}</span><strong className={valueTone == null ? "" : tone(valueTone)}>{value}</strong></article>; }
function pct(value: number | null): string { return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
function num(value: number | null): string { return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2); }
function tone(value: number | null): string { return (value ?? 0) > 0 ? "is-up" : (value ?? 0) < 0 ? "is-down" : ""; }
