import { memo, type CSSProperties } from "react";
import type { StockScoreDimension, StockScoreReport } from "../lib/stockScore";

const radarSize = 360;
const radarCenter = radarSize / 2;
const radarRadius = 112;

function StockScoreCard({ report, stockName }: { report: StockScoreReport; stockName: string }) {
  const weakestDimension = [...report.dimensions].sort((left, right) => left.score - right.score)[0];
  const riskDimension = report.dimensions.find((dimension) => dimension.key === "risk");

  return (
    <section className={`stock-score-card is-${report.signal.tone}`} id="stock-score" aria-labelledby="stock-score-title">
      <header className="stock-score-header">
        <div>
          <p className="eyebrow">EIGHT-DIMENSION RESEARCH SCORE</p>
          <h2 id="stock-score-title">八维研究评分</h2>
          <span>基于本页已加载的行情、技术、资金、财务、估值、舆情、回测与风险数据</span>
        </div>
        <div className="stock-score-meta">
          <span>数据覆盖度 <strong>{report.coverage}%</strong></span>
          <small>缺失项按中性处理 · 自动随 {stockName || "当前股票"} 数据更新</small>
        </div>
      </header>

      <div className="stock-score-layout">
        <section className="stock-score-verdict" aria-label={`综合评分 ${report.score} 分，证据状态 ${report.signal.action}`}>
          <div className="stock-score-number" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={report.score} aria-label={`综合评分 ${report.score} 分`}>
            <span>综合评分</span>
            <strong>{report.score}<small>/100</small></strong>
            <i style={{ "--score-progress": `${report.score * 3.6}deg` } as CSSProperties} aria-hidden="true" />
          </div>
          <div className={`stock-score-signal is-${report.signal.tone}`}>
            <span>证据状态</span>
            <strong>{report.signal.action}</strong>
          </div>
          <div className="stock-score-copy">
            <strong>{report.signal.headline}</strong>
            <p>{report.signal.description}</p>
          </div>
          <p className="stock-score-disclaimer">评分用于比较证据强弱，不预测收益；低覆盖维度会向 50 分收缩。交易前请核对数据时效、估值口径与自身风险承受能力。</p>
          <dl className="stock-score-guardrails" aria-label="交易前检查">
            <div><dt>数据覆盖</dt><dd>{report.coverage}%</dd></div>
            <div><dt>主要短板</dt><dd>{weakestDimension?.label ?? "待识别"} {weakestDimension?.score ?? "—"}</dd></div>
            <div><dt>风险韧性</dt><dd>{riskDimension?.score ?? "—"}/100</dd></div>
          </dl>
        </section>

        <RadarChart dimensions={report.dimensions} />

        <section className="stock-score-breakdown" aria-label="八个维度的得分与原因">
          {report.dimensions.map((dimension) => (
            <article className={`stock-score-dimension ${dimensionTone(dimension.score)}`} key={dimension.key}>
              <div className="stock-score-dimension-head">
                <div><span>{dimension.label}</span><small>{dimension.summary} · 覆盖 {dimension.coverage}%</small></div>
                <strong>{dimension.score}</strong>
              </div>
              <ul>
                {dimension.reasons.map((reason, index) => (
                  <li className={`is-${reason.tone}`} key={`${dimension.key}-${index}`}>
                    <i aria-hidden="true">{reason.tone === "positive" ? "+" : reason.tone === "negative" ? "−" : "·"}</i>
                    <span>{reason.text}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}

export default memo(StockScoreCard);

function RadarChart({ dimensions }: { dimensions: StockScoreDimension[] }) {
  const rings = [25, 50, 75, 100];
  const scorePoints = dimensions.map((dimension, index) => radarPoint(index, dimensions.length, radarRadius * (dimension.score / 100)));
  const outerPoints = dimensions.map((_, index) => radarPoint(index, dimensions.length, radarRadius));

  return (
    <figure className="stock-score-radar">
      <figcaption>
        <strong>能力轮廓</strong>
        <span>同心环为 25 分刻度</span>
      </figcaption>
      <svg viewBox={`0 0 ${radarSize} ${radarSize}`} role="img" aria-label={dimensions.map((dimension) => `${dimension.label} ${dimension.score} 分`).join("，")}>
        <title>八维研究评分雷达图</title>
        {rings.map((ring) => (
          <polygon
            className="stock-score-radar-grid"
            key={ring}
            points={dimensions.map((_, index) => {
              const point = radarPoint(index, dimensions.length, radarRadius * (ring / 100));
              return `${point.x},${point.y}`;
            }).join(" ")}
          />
        ))}
        {outerPoints.map((point, index) => (
          <line className="stock-score-radar-axis" key={dimensions[index].key} x1={radarCenter} y1={radarCenter} x2={point.x} y2={point.y} />
        ))}
        <polygon className="stock-score-radar-area" points={scorePoints.map((point) => `${point.x},${point.y}`).join(" ")} />
        <polyline className="stock-score-radar-line" points={`${scorePoints.map((point) => `${point.x},${point.y}`).join(" ")} ${scorePoints[0]?.x},${scorePoints[0]?.y}`} />
        {scorePoints.map((point, index) => (
          <g key={dimensions[index].key}>
            <circle className="stock-score-radar-point" cx={point.x} cy={point.y} r={3.5} />
            <title>{`${dimensions[index].label}：${dimensions[index].score} 分`}</title>
          </g>
        ))}
        {dimensions.map((dimension, index) => {
          const point = radarPoint(index, dimensions.length, radarRadius + 29);
          const anchor = point.x < radarCenter - 10 ? "end" : point.x > radarCenter + 10 ? "start" : "middle";
          return (
            <g className="stock-score-radar-label" key={dimension.key}>
              <text x={point.x} y={point.y - 2} textAnchor={anchor}>{dimension.shortLabel}</text>
              <text className="is-score" x={point.x} y={point.y + 12} textAnchor={anchor}>{dimension.score}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function radarPoint(index: number, count: number, radius: number) {
  const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
  return {
    x: radarCenter + Math.cos(angle) * radius,
    y: radarCenter + Math.sin(angle) * radius,
  };
}

function dimensionTone(score: number): string {
  return score >= 60 ? "is-positive" : score <= 40 ? "is-negative" : "is-neutral";
}
