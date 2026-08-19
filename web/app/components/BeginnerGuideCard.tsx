"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { StockScoreReport } from "../lib/stockScore";
import styles from "./BeginnerGuideCard.module.css";

type RiskProfile = "conservative" | "balanced" | "growth";
const riskProfileStorageKey = "ticklens.risk-profile.v1";
const riskProfileEvent = "ticklens:risk-profile-change";

function readRiskProfile(): RiskProfile {
  try {
    const stored = localStorage.getItem(riskProfileStorageKey);
    return stored === "conservative" || stored === "growth" ? stored : "balanced";
  } catch {
    return "balanced";
  }
}

function subscribeRiskProfile(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(riskProfileEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(riskProfileEvent, listener);
  };
}

export default function BeginnerGuideCard({
  report,
  stockName,
  dataWarnings,
  newsCount,
}: {
  report: StockScoreReport;
  stockName: string;
  dataWarnings: number;
  newsCount: number;
}) {
  const riskProfile = useSyncExternalStore(subscribeRiskProfile, readRiskProfile, () => "balanced");
  const strongest = useMemo(() => [...report.dimensions].sort((left, right) => right.score - left.score)[0], [report.dimensions]);
  const weakest = useMemo(() => [...report.dimensions].sort((left, right) => left.score - right.score)[0], [report.dimensions]);

  const updateRiskProfile = (value: RiskProfile) => {
    try { localStorage.setItem(riskProfileStorageKey, value); } catch { /* The selection remains available for this page. */ }
    window.dispatchEvent(new Event(riskProfileEvent));
  };

  const profileHint = riskProfile === "conservative"
    ? "先看回撤、数据缺口和仓位上限，再看潜在收益。"
    : riskProfile === "growth"
      ? "可以研究增长线索，但仍要先定义失效条件和最大可承受损失。"
      : "同时核对收益证据、估值和下行情景，避免只看单一分数。";

  return (
    <section className={styles.card} aria-labelledby="beginner-guide-title">
      <header className={styles.header}>
        <div><p>BEGINNER CHECKLIST</p><h2 id="beginner-guide-title">今天先看三件事</h2></div>
        <span>观察模式 · 不连接交易账户</span>
      </header>

      <div className={styles.grid}>
        <article className={styles.item}>
          <span>01 · 数据是否可用</span>
          <strong>覆盖度 {report.coverage}% · {dataWarnings ? `${dataWarnings} 条质量提示` : "暂无质量警告"}</strong>
          <p>已纳入 {newsCount} 条经过实体匹配的新闻。任何缺失项都按中性处理，不应把分数当作确定结论。</p>
        </article>
        <article className={styles.item}>
          <span>02 · 证据与最大短板</span>
          <strong>{strongest?.label ?? "综合证据"}相对较强；{weakest?.label ?? "风险数据"}最需要核验</strong>
          <p>{report.signal.headline}</p>
          <small>如果“{weakest?.summary ?? "主要短板"}”相关的新数据改变，当前判断可能失效。</small>
        </article>
        <article className={styles.item}>
          <span>03 · 先匹配自己的风险</span>
          <strong>选择阅读侧重点</strong>
          <div className={styles.profile} role="group" aria-label="风险承受能力">
            <button type="button" aria-pressed={riskProfile === "conservative"} onClick={() => updateRiskProfile("conservative")}>保守</button>
            <button type="button" aria-pressed={riskProfile === "balanced"} onClick={() => updateRiskProfile("balanced")}>稳健</button>
            <button type="button" aria-pressed={riskProfile === "growth"} onClick={() => updateRiskProfile("growth")}>进取</button>
          </div>
          <p>{profileHint}</p>
        </article>
      </div>

      <p className={styles.guardrail}><strong>{stockName || "当前股票"}</strong> 的评分和概率只用于整理证据。下一步应核对原始公告、新闻上下文、数据时间与自己能承受的损失，而不是直接据此买卖。</p>

      <details className={styles.glossary}>
        <summary>第一次看专业指标？展开术语说明</summary>
        <dl>
          <dt>B / S</dt><dd>历史规则生成的买入/卖出观察信号，不是交易指令。</dd>
          <dt>VWAP</dt><dd>成交量加权平均价，用于观察当日平均成交成本附近的位置。</dd>
          <dt>VaR / ES</dt><dd>历史分布下的损失估计；不能覆盖所有极端或突发事件。</dd>
          <dt>AUC</dt><dd>模型区分上涨与下跌样本的能力，0.5 附近通常接近随机。</dd>
        </dl>
      </details>
    </section>
  );
}
