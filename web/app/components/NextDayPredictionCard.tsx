"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Candle } from "../lib/market";
import type { NewsItem } from "../lib/news";
import type { RealtimeSnapshot } from "../lib/realtimeMarket";
import type { StockMarket } from "../lib/security";
import {
  buildNextDayPrediction,
  type PredictionMode,
  type PredictionNeighborCount,
  type PredictionWindow,
} from "../lib/nextDayPrediction";

const windows: PredictionWindow[] = [60, 126, 250];
const neighborOptions: PredictionNeighborCount[] = [5, 10, 15, 20, 30];

type Props = {
  candles: Candle[];
  benchmarkCandles: Candle[];
  benchmarkName: string;
  newsItems: NewsItem[];
  realtimeSnapshot: RealtimeSnapshot | null;
  market: StockMarket;
  stockName: string;
  onInspectDate: (date: string) => void;
};

function NextDayPredictionCard({
  candles,
  benchmarkCandles,
  benchmarkName,
  newsItems,
  realtimeSnapshot,
  market,
  stockName,
  onInspectDate,
}: Props) {
  const [mode, setMode] = useState<PredictionMode>("tomorrow");
  const [windowSize, setWindowSize] = useState<PredictionWindow>(126);
  const [neighbors, setNeighbors] = useState<PredictionNeighborCount>(15);
  const [predictionSnapshot, setPredictionSnapshot] = useState<RealtimeSnapshot | null>(realtimeSnapshot);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const latestSnapshotRef = useRef(realtimeSnapshot);
  useEffect(() => {
    latestSnapshotRef.current = realtimeSnapshot;
  }, [realtimeSnapshot]);
  const predictionMinute = realtimeSnapshot ? `${realtimeSnapshot.date} ${realtimeSnapshot.time.slice(0, 5)} ${realtimeSnapshot.marketStatus}` : "";
  useEffect(() => {
    const timeout = window.setTimeout(() => setPredictionSnapshot(latestSnapshotRef.current), 0);
    return () => window.clearTimeout(timeout);
  }, [predictionMinute]);
  const report = useMemo(
    () => buildNextDayPrediction(candles, {
      window: windowSize,
      neighbors,
      mode,
      market,
      realtimeSnapshot: predictionSnapshot,
      benchmarkCandles,
      benchmarkName,
      newsItems,
    }),
    [benchmarkCandles, benchmarkName, candles, market, mode, neighbors, newsItems, predictionSnapshot, windowSize],
  );

  if (!report) {
    return (
      <section className="next-day-card is-empty" id="next-day-prediction" aria-labelledby="next-day-title">
        <header className="next-day-header">
          <div><p className="eyebrow">ADAPTIVE PREDICTION LAB</p><h2 id="next-day-title">统计今日 / 明日概率实验</h2></div>
        </header>
        <ModeSwitch mode={mode} onChange={setMode} />
        <p className="next-day-empty">至少需要 32 个有效交易日，才能建立隔日标签、历史相似日和滚动验证样本。预测今日模式还需要识别当前交易日。</p>
      </section>
    );
  }

  const modelMetric = (value: number | null) => value == null ? "样本不足" : percent(value, 1);

  return (
    <section className={`next-day-card grade-${report.signal.grade.toLowerCase()}`} id="next-day-prediction" aria-labelledby="next-day-title">
      <header className="next-day-header">
        <div>
          <p className="eyebrow">ADAPTIVE PREDICTION LAB</p>
          <h2 id="next-day-title">统计今日 / 明日概率实验</h2>
          <span>技术面 × 市场基准 × 消息面 × 轻量 ML · 自动随 {stockName || "当前股票"} 数据滚动重训</span>
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
          <span className="next-day-asof">模型切片 {report.asOf} · {report.asOfTime}</span>
        </div>
      </header>

      <ModeSwitch mode={mode} onChange={setMode} />
      <div className="next-day-basis" role="status">
        <div><strong>{report.target.label}</strong><span>{report.target.basis}</span></div>
        <i>{report.target.isPartialSession ? `盘中样本 · 交易进度约 ${percent(report.target.sessionProgress)}` : report.target.usesCurrentSession ? "完整当日样本" : "严格收盘切片"}</i>
      </div>

      <div className="next-day-trust-summary" aria-label="上涨概率的可靠性与样本语境">
        <span>方向概率与可靠性</span>
        <strong>{report.target.label}上涨 {percent(report.prediction.upProbability)}</strong>
        <small>模型可靠性 {report.signal.reliability} · 决策可信度 {report.signal.decisionConfidence}% · {report.trainingSamples} 个带标签样本 · 自然上涨率 {percent(report.modelValidation.baselineUpRate)} · 相似日胜率 95% 区间 {percent(report.similarDays.upRateInterval95[0])}～{percent(report.similarDays.upRateInterval95[1])}</small>
      </div>

      <div className="next-day-hero">
        <section className="next-day-grade" aria-label={`模型强度 ${report.signal.score} 分，可靠性 ${report.signal.reliability}`}>
          <div className="grade-orbit" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={report.signal.score} style={{ "--prediction-score": `${report.signal.score * 3.6}deg` } as CSSProperties}>
            <span>模型强度</span>
            <strong>{report.signal.score}</strong>
            <small>/100</small>
          </div>
          <div>
            <span>模型可靠性</span>
            <strong>{report.signal.reliability}</strong>
            <p>{report.signal.state} · 评分反映当前证据一致性，不是 B/S 买卖规则等级。</p>
          </div>
        </section>

        <div className="next-day-core-metrics">
          <PredictionMetric label={`${report.target.label}上涨概率`} value={percent(report.prediction.upProbability)} emphasized />
          <PredictionMetric label="较自然上涨率" value={signedPercent(report.prediction.upProbability - report.modelValidation.baselineUpRate, 1)} tone={report.prediction.upProbability - report.modelValidation.baselineUpRate} />
          <PredictionMetric label="预期收盘涨跌" value={signedPercent(report.prediction.expectedCloseReturn)} tone={report.prediction.expectedCloseReturn} />
          <PredictionMetric label="预期开盘缺口" value={signedPercent(report.prediction.expectedOpenGap)} tone={report.prediction.expectedOpenGap} />
          <PredictionMetric label="盘中预计上探" value={signedPercent(report.prediction.expectedHighReturn)} tone={report.prediction.expectedHighReturn} />
          <PredictionMetric label="盘中预计下探" value={signedPercent(report.prediction.expectedLowReturn)} tone={report.prediction.expectedLowReturn} />
          <PredictionMetric label="消息面概率修正" value={signedPercent(report.prediction.contextAdjustment, 1)} tone={report.prediction.contextAdjustment} />
          <PredictionMetric label="放量概率" value={percent(report.volumePrediction.volumeUpProbability)} />
        </div>

        <section className="next-day-range" aria-label="预测区间">
          <span>历史相似日收益区间</span>
          <strong><i>{signedPercent(report.prediction.q25)}</i><b>～</b><em>{signedPercent(report.prediction.q75)}</em></strong>
          <dl>
            <div><dt>中位数</dt><dd>{signedPercent(report.prediction.median)}</dd></div>
            <div><dt>相似日胜率</dt><dd>{percent(report.similarDays.upRate)}</dd></div>
            <div><dt>平均相似度</dt><dd>{percent(report.similarDays.averageSimilarity)}</dd></div>
            <div><dt>相似日胜率 95% 区间</dt><dd>{percent(report.similarDays.upRateInterval95[0])}～{percent(report.similarDays.upRateInterval95[1])}</dd></div>
          </dl>
        </section>
      </div>

      <section className={`next-day-decision is-${report.decisionSupport.tone}`} aria-label="隔日研究倾向与统计观察带">
        <header>
          <div><p className="eyebrow">RESEARCH POSTURE</p><h3>研究倾向与统计观察带</h3></div>
          <strong>{researchPosture(report.decisionSupport.action)}</strong>
        </header>
        <p>{researchSummary(report.decisionSupport.action)}</p>
        <div className="next-day-decision-metrics">
          <div><span>当前涨跌</span><strong className={(report.decisionSupport.currentReturn ?? 0) >= 0 ? "is-up" : "is-down"}>{report.decisionSupport.currentReturn == null ? "—" : signedPercent(report.decisionSupport.currentReturn)}</strong></div>
          <div><span>统计期望价</span><strong>{formatPrice(report.decisionSupport.expectedPrice)}</strong></div>
          <div><span>统计上沿观察位</span><strong>{formatPrice(report.decisionSupport.takeProfitReference)}</strong></div>
          <div><span>统计下沿观察位</span><strong>{formatPrice(report.decisionSupport.riskReference)}</strong></div>
          <div><span>统计风险收益比</span><strong>{report.decisionSupport.riskRewardRatio == null ? "—" : `${report.decisionSupport.riskRewardRatio.toFixed(2)} : 1`}</strong></div>
          <div><span>模型一致度</span><strong>{percent(report.signal.ensembleAgreement)}</strong></div>
        </div>
        <ul>{report.decisionSupport.checks.map((check) => <li key={check}>{check}</li>)}</ul>
      </section>

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
        <section className="next-day-panel next-day-context">
          <header><div><p className="eyebrow">MARKET & NEWS CONTEXT</p><h3>大盘与消息面验证</h3></div><span>覆盖度 {percent(report.externalContext.coverage)}</span></header>
          <div className="next-day-context-grid">
            <article>
              <div><span>市场基准</span><strong>{report.externalContext.market.available ? report.externalContext.market.name : "数据缺失"}</strong></div>
              <dl>
                <div><dt>当日走势</dt><dd className={report.externalContext.market.return1d >= 0 ? "is-up" : "is-down"}>{report.externalContext.market.available ? signedPercent(report.externalContext.market.return1d) : "—"}</dd></div>
                <div><dt>近 5 日</dt><dd>{report.externalContext.market.available ? signedPercent(report.externalContext.market.return5d) : "—"}</dd></div>
                <div><dt>个股相对强弱</dt><dd>{report.externalContext.market.available ? signedPercent(report.externalContext.market.relativeStrength5d) : "—"}</dd></div>
              </dl>
              <p>{report.externalContext.market.regime} · {report.externalContext.market.asOf || "无日期"}{report.externalContext.market.fresh ? "" : "（最近可用）"}</p>
              <small>{report.externalContext.market.role}</small>
            </article>
            <article>
              <div><span>消息面</span><strong className={report.externalContext.news.tone === "正面" ? "is-up" : report.externalContext.news.tone === "负面" ? "is-down" : ""}>{report.externalContext.news.available ? report.externalContext.news.tone : "数据缺失"}</strong></div>
              <dl>
                <div><dt>有效新闻</dt><dd>{report.externalContext.news.itemCount} 条</dd></div>
                <div><dt>近 3 日</dt><dd>{report.externalContext.news.freshItemCount} 条</dd></div>
                <div><dt>加权情绪分</dt><dd>{report.externalContext.news.available ? report.externalContext.news.weightedScore.toFixed(3) : "—"}</dd></div>
              </dl>
              <p>修正 {signedPercent(report.externalContext.news.probabilityAdjustment, 1)} · 数据可信 {percent(report.externalContext.news.confidence)}</p>
              <small>{report.externalContext.news.role}；切片截止 {report.externalContext.news.cutoff}</small>
            </article>
          </div>
        </section>

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
          <header><div><p className="eyebrow">VOLUME OUTLOOK</p><h3>{report.target.label}成交活跃度</h3></div><span>{report.volumePrediction.label}</span></header>
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

        <button className="next-day-evidence-toggle" type="button" aria-expanded={evidenceExpanded} aria-controls="next-day-evidence" onClick={() => setEvidenceExpanded((current) => !current)}>
          <span><small>DEEP DIAGNOSTICS</small><strong>模型验证与相似日证据</strong></span>
          <em>{report.modelValidation.validationSamples} 个滚动样本 · {report.similarDays.count} 个相似日</em>
          <i aria-hidden="true">{evidenceExpanded ? "收起 ↑" : "按需展开 ↓"}</i>
        </button>

        {evidenceExpanded ? <section className="next-day-panel next-day-model" id="next-day-evidence">
          <header><div><p className="eyebrow">WALK-FORWARD CHECK</p><h3>模型有效性与动态权重</h3></div><span className={report.modelValidation.panelEnabled || report.modelValidation.mlEnabled ? "is-enabled" : "is-disabled"}>{report.modelValidation.panelEnabled ? "面板 ML 已启用" : report.modelValidation.mlEnabled ? "个股 ML 已启用" : "ML 已降级"}</span></header>
          <div className="model-metrics">
            <div><span>Accuracy</span><strong>{modelMetric(report.modelValidation.accuracy)}</strong></div>
            <div><span>ROC-AUC</span><strong>{report.modelValidation.auc == null ? "样本不足" : report.modelValidation.auc.toFixed(3)}</strong></div>
            <div><span>Precision</span><strong>{modelMetric(report.modelValidation.precision)}</strong></div>
            <div><span>Recall</span><strong>{modelMetric(report.modelValidation.recall)}</strong></div>
            <div><span>Brier Score</span><strong>{report.modelValidation.brierScore == null ? "样本不足" : report.modelValidation.brierScore.toFixed(3)}</strong></div>
            <div><span>基准 Brier</span><strong>{report.modelValidation.baselineBrierScore == null ? "样本不足" : report.modelValidation.baselineBrierScore.toFixed(3)}</strong></div>
            <div><span>Brier 改善</span><strong>{report.modelValidation.brierImprovement == null ? "样本不足" : signedNumber(report.modelValidation.brierImprovement, 3)}</strong></div>
            <div><span>概率提升</span><strong>{signedPercent(report.modelValidation.probabilityLift, 1)}</strong></div>
            <div><span>自然上涨率</span><strong>{percent(report.modelValidation.baselineUpRate, 1)}</strong></div>
            <div><span>滚动样本</span><strong>{report.modelValidation.validationSamples}</strong></div>
            <div><span>面板验证 Accuracy</span><strong>{percent(report.modelValidation.panelValidationAccuracy, 1)}</strong></div>
            <div><span>面板验证 Brier</span><strong>{report.modelValidation.panelValidationBrierScore.toFixed(3)}</strong></div>
            <div><span>面板验证样本</span><strong>{report.modelValidation.panelValidationSamples}</strong></div>
            <div><span>市场状态 Logit 校准</span><strong>{signedNumber(report.modelValidation.regimeLogitAdjustment, 3)}</strong></div>
            <div><span>模型版本</span><strong>{report.modelValidation.version}</strong></div>
            <div><span>数据充分度</span><strong>{report.signal.dataSufficiency}%</strong></div>
          </div>
          <div className="model-weights" aria-label="组合模型权重">
            <WeightBar label="规则模型" value={report.weights.rule} tone="rule" />
            <WeightBar label="历史相似日" value={report.weights.analog} tone="analog" />
            <WeightBar label="轻量 ML" value={report.weights.ml} tone="ml" />
            <WeightBar label="跨股票面板" value={report.weights.panel} tone="ml" />
          </div>
          <p>{report.modelValidation.reason}</p>
        </section> : null}
      </div>

      {evidenceExpanded ? <>
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
                <li>“预测今日”会把今日 K 线完全移出输入；“预测明日”才合并今日截至当前的 OHLCV，盘中量能按交易进度投影。</li>
                <li>相似度使用标准化后的价格形态、波动率、ATR、量能、大盘趋势与个股相对强弱计算，并加入时间衰减。</li>
                <li>Logistic Regression 预测方向，Ridge Regression 辅助估计开盘、收盘、高低点与量比；规则胜率采用先验收缩避免小样本虚高。</li>
                <li>验证采用按时间顺序扩展训练集的 Walk Forward 方式；准确率、AUC 与 Brier 校准未共同优于基准时，ML 权重自动归零。</li>
                <li>新闻按发布时间、相关性和衰减权重计算，最多修正 ±5 个百分点；大盘因子直接进入相似日与 ML 特征。</li>
                <li>止盈位、风险位和最高/最低均是历史条件下的统计观察带，不是保证成交的价格边界。</li>
              </ul>
            </section>
          </div>
        </details>
      </> : null}

      <footer className="next-day-notice">{report.notice}</footer>
    </section>
  );
}

function predictionSliceKey(snapshot: RealtimeSnapshot | null): string {
  return snapshot ? `${snapshot.code}:${snapshot.date}:${snapshot.time.slice(0, 5)}:${snapshot.marketStatus}` : "";
}

function researchPosture(action: string): string {
  return ({
    "持有观察": "方向证据偏正向",
    "等待确认": "方向证据待确认",
    "分批止盈": "涨幅进入偏乐观区间",
    "收紧止损": "跌幅进入弱势尾部",
    "降低仓位": "风险证据偏高",
  } as Record<string, string>)[action] ?? "方向证据待确认";
}

function researchSummary(action: string): string {
  return ({
    "持有观察": "方向、收益期望与风险收益比暂时同向，仍需等待新的价格与量能证据验证。",
    "等待确认": "多模型尚未形成足够优势，当前更适合观察价格、量能或大盘方向是否继续确认。",
    "分批止盈": "当前涨幅已进入历史偏乐观区间，但延续概率与风险证据尚未同步确认。",
    "收紧止损": "当前跌幅落入历史弱势尾部，且统计修复概率偏低，下行证据需要优先核查。",
    "降低仓位": "个股风险项或系统性压力偏高，当前方向结论的可靠性受到限制。",
  } as Record<string, string>)[action] ?? "当前证据尚不足以形成稳定方向，需要继续观察。";
}

function nextDayPropsEqual(previous: Props, next: Props): boolean {
  return previous.candles === next.candles
    && previous.benchmarkCandles === next.benchmarkCandles
    && previous.benchmarkName === next.benchmarkName
    && previous.newsItems === next.newsItems
    && predictionSliceKey(previous.realtimeSnapshot) === predictionSliceKey(next.realtimeSnapshot)
    && previous.market === next.market
    && previous.stockName === next.stockName
    && previous.onInspectDate === next.onInspectDate;
}

export default memo(NextDayPredictionCard, nextDayPropsEqual);

function ModeSwitch({ mode, onChange }: { mode: PredictionMode; onChange: (mode: PredictionMode) => void }) {
  return (
    <div className="next-day-mode-switch" role="group" aria-label="选择预测时点">
      <button type="button" className={mode === "today" ? "active" : ""} aria-pressed={mode === "today"} onClick={() => onChange("today")}>
        <strong>预测今日</strong><small>昨日完整日 K → 今日</small>
      </button>
      <button type="button" className={mode === "tomorrow" ? "active" : ""} aria-pressed={mode === "tomorrow"} onClick={() => onChange("tomorrow")}>
        <strong>预测明日</strong><small>今日截至当前 → 下一交易日</small>
      </button>
    </div>
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

function signedNumber(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value >= 1000 ? value.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : value.toFixed(value >= 10 ? 2 : 3);
}

function compact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)} 万`;
  return Math.round(value).toLocaleString("zh-CN");
}
