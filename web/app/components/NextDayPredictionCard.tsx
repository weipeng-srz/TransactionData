"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { Candle } from "../lib/market";
import {
  buildNextDayPrediction,
  type PredictionNeighborCount,
  type PredictionWindow,
} from "../lib/nextDayPrediction";

const windows: PredictionWindow[] = [60, 126, 250];
const neighborOptions: PredictionNeighborCount[] = [5, 10, 15, 20, 30];

export default function NextDayPredictionCard({
  candles,
  stockName,
  onInspectDate,
}: {
  candles: Candle[];
  stockName: string;
  onInspectDate: (date: string) => void;
}) {
  const [windowSize, setWindowSize] = useState<PredictionWindow>(126);
  const [neighbors, setNeighbors] = useState<PredictionNeighborCount>(15);
  const report = useMemo(
    () => buildNextDayPrediction(candles, { window: windowSize, neighbors }),
    [candles, neighbors, windowSize],
  );

  if (!report) {
    return (
      <section className="next-day-card is-empty" id="next-day-prediction" aria-labelledby="next-day-title">
        <header className="next-day-header">
          <div><p className="eyebrow">NEXT-DAY PROBABILITY LAB</p><h2 id="next-day-title">AI 隔日交易概率分析</h2></div>
        </header>
        <p className="next-day-empty">至少需要 32 个有效交易日，才能建立隔日标签、历史相似日和滚动验证样本。</p>
      </section>
    );
  }

  const modelMetric = (value: number | null) => value == null ? "样本不足" : percent(value, 1);

  return (
    <section className={`next-day-card grade-${report.signal.grade.toLowerCase()}`} id="next-day-prediction" aria-labelledby="next-day-title">
      <header className="next-day-header">
        <div>
          <p className="eyebrow">NEXT-DAY PROBABILITY LAB</p>
          <h2 id="next-day-title">AI 隔日交易概率分析</h2>
          <span>规则统计 × 历史相似日 × 轻量模型 · 自动随 {stockName || "当前股票"} 日 K 更新</span>
        </div>
        <div className="next-day-controls" aria-label="隔日预测参数">
          <label>分析窗口
            <select value={windowSize} onChange={(event) => setWindowSize(Number(event.target.value) as PredictionWindow)}>
              {windows.map((value) => <option key={value} value={value}>{value} 个交易日{value === 126 ? "（推荐）" : ""}</option>)}
            </select>
          </label>
          <label>相似日
            <select value={neighbors} onChange={(event) => setNeighbors(Number(event.target.value) as PredictionNeighborCount)}>
              {neighborOptions.map((value) => <option key={value} value={value}>{value} 个</option>)}
            </select>
          </label>
          <span className="next-day-asof">截至 {report.asOf}</span>
        </div>
      </header>

      <div className="next-day-hero">
        <section className="next-day-grade" aria-label={`隔日信号 ${report.signal.grade} 级，评分 ${report.signal.score}`}>
          <div className="grade-orbit" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={report.signal.score} style={{ "--prediction-score": `${report.signal.score * 3.6}deg` } as CSSProperties}>
            <span>信号等级</span>
            <strong>{report.signal.grade}</strong>
            <small>{report.signal.score}/100</small>
          </div>
          <div>
            <span>当前状态</span>
            <strong>{report.signal.state}</strong>
            <p>{report.trainingSamples} 个带标签样本 · 分析置信度 {report.signal.confidence}%</p>
          </div>
        </section>

        <div className="next-day-core-metrics">
          <PredictionMetric label="隔日上涨概率" value={percent(report.prediction.upProbability)} emphasized />
          <PredictionMetric label="预期收盘涨跌" value={signedPercent(report.prediction.expectedCloseReturn)} tone={report.prediction.expectedCloseReturn} />
          <PredictionMetric label="预期开盘缺口" value={signedPercent(report.prediction.expectedOpenGap)} tone={report.prediction.expectedOpenGap} />
          <PredictionMetric label="盘中预计上探" value={signedPercent(report.prediction.expectedHighReturn)} tone={report.prediction.expectedHighReturn} />
          <PredictionMetric label="盘中预计下探" value={signedPercent(report.prediction.expectedLowReturn)} tone={report.prediction.expectedLowReturn} />
          <PredictionMetric label="放量概率" value={percent(report.volumePrediction.volumeUpProbability)} />
        </div>

        <section className="next-day-range" aria-label="预测区间">
          <span>历史相似日收益区间</span>
          <strong><i>{signedPercent(report.prediction.q25)}</i><b>～</b><em>{signedPercent(report.prediction.q75)}</em></strong>
          <dl>
            <div><dt>中位数</dt><dd>{signedPercent(report.prediction.median)}</dd></div>
            <div><dt>相似日胜率</dt><dd>{percent(report.similarDays.upRate)}</dd></div>
            <div><dt>平均相似度</dt><dd>{percent(report.similarDays.averageSimilarity)}</dd></div>
          </dl>
        </section>
      </div>

      <div className="next-day-scenarios" aria-label="隔日三种概率场景">
        {report.scenarios.map((scenario) => (
          <article className={`next-day-scenario is-${scenario.key}`} key={scenario.key}>
            <header><span>{scenario.label}</span><strong>{percent(scenario.probability)}</strong></header>
            <div className="scenario-track"><i style={{ width: percent(scenario.probability) }} /></div>
            <p>{scenario.summary}</p>
            <ul>{scenario.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          </article>
        ))}
      </div>

      <div className="next-day-analysis-grid">
        <section className="next-day-panel next-day-factors">
          <header><div><p className="eyebrow">BULL VS RISK</p><h3>主要多空因素</h3></div><span>当前形态</span></header>
          <div>
            <article>
              <h4><i>+</i> 看多因素</h4>
              {report.bullishFactors.length ? <ul>{report.bullishFactors.map((factor) => <li key={factor}>{factor}</li>)}</ul> : <p>当前没有达到阈值的明确看多规则。</p>}
            </article>
            <article>
              <h4><i>!</i> 风险因素</h4>
              {report.riskFactors.length ? <ul>{report.riskFactors.map((factor) => <li key={factor}>{factor}</li>)}</ul> : <p>当前未识别到显著的极端风险规则。</p>}
            </article>
          </div>
        </section>

        <section className="next-day-panel next-day-volume">
          <header><div><p className="eyebrow">VOLUME OUTLOOK</p><h3>明日成交活跃度</h3></div><span>{report.volumePrediction.label}</span></header>
          <div className="volume-hero">
            <div><span>预计成交量</span><strong>{compact(report.volumePrediction.expectedVolume)}</strong><small>20 日均量 {report.volumePrediction.expectedVolumeRatio20.toFixed(2)} 倍</small></div>
            <dl>
              <div><dt>今日成交量</dt><dd>{compact(report.volumePrediction.currentVolume)}</dd></div>
              <div><dt>20 日平均</dt><dd>{compact(report.volumePrediction.averageVolume20)}</dd></div>
            </dl>
          </div>
          <div className="volume-probabilities">
            <ProbabilityBar label="明显缩量" value={report.volumePrediction.quietProbability} tone="quiet" />
            <ProbabilityBar label="正常成交" value={report.volumePrediction.normalProbability} tone="normal" />
            <ProbabilityBar label="明显放量" value={report.volumePrediction.activeProbability} tone="active" />
          </div>
        </section>

        <section className="next-day-panel next-day-distribution">
          <header><div><p className="eyebrow">ANALOG DISTRIBUTION</p><h3>相似日隔日收益分布</h3></div><span>{report.similarDays.count} 个样本</span></header>
          <div className="distribution-bars">
            {report.distribution.map((bucket) => (
              <div key={bucket.label}>
                <span>{bucket.label}</span>
                <i><b style={{ width: percent(bucket.probability) }} /></i>
                <strong>{percent(bucket.probability, 0)}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="next-day-panel next-day-model">
          <header><div><p className="eyebrow">WALK-FORWARD CHECK</p><h3>模型有效性与动态权重</h3></div><span className={report.modelValidation.mlEnabled ? "is-enabled" : "is-disabled"}>{report.modelValidation.mlEnabled ? "ML 已启用" : "ML 已降级"}</span></header>
          <div className="model-metrics">
            <div><span>Accuracy</span><strong>{modelMetric(report.modelValidation.accuracy)}</strong></div>
            <div><span>ROC-AUC</span><strong>{report.modelValidation.auc == null ? "样本不足" : report.modelValidation.auc.toFixed(3)}</strong></div>
            <div><span>Precision</span><strong>{modelMetric(report.modelValidation.precision)}</strong></div>
            <div><span>Recall</span><strong>{modelMetric(report.modelValidation.recall)}</strong></div>
            <div><span>自然上涨率</span><strong>{percent(report.modelValidation.baselineUpRate, 1)}</strong></div>
            <div><span>滚动样本</span><strong>{report.modelValidation.validationSamples}</strong></div>
          </div>
          <div className="model-weights" aria-label="组合模型权重">
            <WeightBar label="规则模型" value={report.weights.rule} tone="rule" />
            <WeightBar label="历史相似日" value={report.weights.analog} tone="analog" />
            <WeightBar label="轻量 ML" value={report.weights.ml} tone="ml" />
          </div>
          <p>{report.modelValidation.reason}</p>
        </section>
      </div>

      <section className="next-day-similar-table">
        <header>
          <div><p className="eyebrow">NEAREST TRADING DAYS</p><h3>历史相似交易日</h3></div>
          <span>点击日期定位到历史 K 线</span>
        </header>
        <div className="table-wrap">
          <table>
            <thead><tr><th>日期</th><th>相似度</th><th>当日涨幅</th><th>次日开盘</th><th>次日收盘</th><th>次日最高</th><th>次日最低</th><th>次日量比</th></tr></thead>
            <tbody>
              {report.similarDays.items.slice(0, 10).map((item) => (
                <tr key={item.date}>
                  <td><button type="button" onClick={() => onInspectDate(item.date)}>{item.date}</button></td>
                  <td>{percent(item.similarity, 0)}</td>
                  <ReturnCell value={item.currentReturn} />
                  <ReturnCell value={item.nextOpenReturn} />
                  <ReturnCell value={item.nextCloseReturn} />
                  <ReturnCell value={item.nextHighReturn} />
                  <ReturnCell value={item.nextLowReturn} />
                  <td>{item.nextVolumeRatio20.toFixed(2)}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className="next-day-method">
        <summary>查看命中规则、样本量与方法说明</summary>
        <div>
          <section>
            <h3>当前命中规则</h3>
            {report.activeRules.length ? (
              <div className="rule-table table-wrap"><table><thead><tr><th>规则</th><th>方向</th><th>样本数</th><th>可信度</th><th>历史上涨率</th><th>平均收益</th></tr></thead><tbody>{report.activeRules.map((rule) => <tr key={rule.key}><td><strong>{rule.name}</strong><small>{rule.description}</small></td><td>{rule.tone === "bullish" ? "偏多" : rule.tone === "risk" ? "风险" : "中性"}</td><td>{rule.sampleSize}</td><td>{rule.confidence}</td><td>{percent(rule.upRate)}</td><ReturnCell value={rule.averageReturn} /></tr>)}</tbody></table></div>
            ) : <p>当前没有命中预设强形态或风险形态，规则层回退到该股票自身隔日上涨基准。</p>}
          </section>
          <section>
            <h3>计算口径</h3>
            <ul>
              <li>相似度使用标准化后的价格、K 线、趋势、量能、新高与连续涨跌特征计算。</li>
              <li>Logistic Regression 预测隔日方向，Ridge Regression 辅助估计开盘、收盘、高低点与量比。</li>
              <li>验证采用按时间顺序扩展训练集的 Walk Forward 方式；未优于基准时，ML 权重自动归零。</li>
              <li>最高/最低是历史条件下的统计期望，不是明日价格边界，也不包含突发消息与盘前事件。</li>
            </ul>
          </section>
        </div>
      </details>

      <footer className="next-day-notice">{report.notice}</footer>
    </section>
  );
}

function PredictionMetric({ label, value, tone, emphasized = false }: { label: string; value: string; tone?: number; emphasized?: boolean }) {
  return <div className={emphasized ? "is-emphasized" : ""}><span>{label}</span><strong className={tone == null ? "" : tone >= 0 ? "is-up" : "is-down"}>{value}</strong></div>;
}

function ProbabilityBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div><span>{label}</span><i><b className={`is-${tone}`} style={{ width: percent(value) }} /></i><strong>{percent(value, 0)}</strong></div>;
}

function WeightBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div><span>{label}</span><i><b className={`is-${tone}`} style={{ width: percent(value) }} /></i><strong>{percent(value, 0)}</strong></div>;
}

function ReturnCell({ value }: { value: number }) {
  return <td className={value >= 0 ? "is-up" : "is-down"}>{signedPercent(value)}</td>;
}

function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function signedPercent(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function compact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)} 万`;
  return Math.round(value).toLocaleString("zh-CN");
}
