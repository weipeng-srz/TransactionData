"use client";

import { useMemo, useState } from "react";
import type { FinancialDataset } from "../lib/financials";
import type {
  FinancialAnalysisPeriod,
  FinancialBalanceMetrics,
  FinancialMetrics,
  FinancialViewMode,
} from "../lib/financialAnalysis";
import FinancialChart, { type FinancialChartSeries } from "./FinancialChart";

type LoadState = { phase: "idle" | "loading" | "success" | "error"; detail: string };
type RangeKey = "8q" | "12q" | "5y" | "10y";
type DisplayMode = "absolute" | "yoy" | "qoq" | "ratio";
type ProfitKey = "parentNetProfit" | "deductNetProfit";
type MetricKey = keyof FinancialMetrics | keyof FinancialBalanceMetrics;

type TableRow = {
  key: MetricKey;
  label: string;
  group: string;
  source: "flow" | "balance";
  format: "amount" | "percent" | "ratio" | "days";
  formula: string;
};

const tableRows: TableRow[] = [
  { key: "revenue", label: "营业收入", group: "经营规模", source: "flow", format: "amount", formula: "利润表营业总收入；单季度由累计值差分" },
  { key: "operatingCost", label: "营业成本", group: "经营规模", source: "flow", format: "amount", formula: "利润表营业成本；单季度由累计值差分" },
  { key: "grossProfit", label: "毛利润", group: "经营规模", source: "flow", format: "amount", formula: "营业收入 - 营业成本" },
  { key: "operatingProfit", label: "营业利润", group: "经营规模", source: "flow", format: "amount", formula: "利润表营业利润；单季度由累计值差分" },
  { key: "parentNetProfit", label: "归母净利润", group: "经营规模", source: "flow", format: "amount", formula: "归属于母公司股东净利润" },
  { key: "deductNetProfit", label: "扣非归母净利润", group: "经营规模", source: "flow", format: "amount", formula: "扣除非经常性损益后的归母净利润" },
  { key: "nonRecurringProfit", label: "非经常性损益差额", group: "经营规模", source: "flow", format: "amount", formula: "归母净利润 - 扣非归母净利润" },
  { key: "grossMargin", label: "毛利率", group: "盈利能力", source: "flow", format: "percent", formula: "(营业收入 - 营业成本) ÷ 营业收入" },
  { key: "netMargin", label: "归母净利率", group: "盈利能力", source: "flow", format: "percent", formula: "归母净利润 ÷ 营业收入" },
  { key: "deductMargin", label: "扣非净利率", group: "盈利能力", source: "flow", format: "percent", formula: "扣非归母净利润 ÷ 营业收入" },
  { key: "roe", label: "ROE", group: "盈利能力", source: "flow", format: "percent", formula: "TTM归母净利润 ÷ 期初期末平均归母净资产" },
  { key: "roic", label: "ROIC", group: "盈利能力", source: "flow", format: "percent", formula: "公开财务指标中的投入资本回报率" },
  { key: "researchExpense", label: "研发费用", group: "盈利能力", source: "flow", format: "amount", formula: "利润表研发费用" },
  { key: "researchExpenseRatio", label: "研发费用率", group: "盈利能力", source: "flow", format: "percent", formula: "研发费用 ÷ 营业收入" },
  { key: "operatingCashFlow", label: "经营活动现金流净额", group: "现金流", source: "flow", format: "amount", formula: "现金流量表经营活动现金流量净额" },
  { key: "investingCashFlow", label: "投资活动现金流净额", group: "现金流", source: "flow", format: "amount", formula: "现金流量表投资活动现金流量净额" },
  { key: "financingCashFlow", label: "筹资活动现金流净额", group: "现金流", source: "flow", format: "amount", formula: "现金流量表筹资活动现金流量净额" },
  { key: "capex", label: "资本性支出", group: "现金流", source: "flow", format: "amount", formula: "购建固定资产、无形资产和其他长期资产支付的现金" },
  { key: "freeCashFlow", label: "自由现金流", group: "现金流", source: "flow", format: "amount", formula: "经营活动现金流净额 - 资本性支出" },
  { key: "cashCoverage", label: "经营现金流／净利润", group: "现金流", source: "flow", format: "ratio", formula: "经营活动现金流净额 ÷ 归母净利润" },
  { key: "accountsReceivable", label: "应收账款", group: "资产质量", source: "balance", format: "amount", formula: "资产负债表期末应收账款" },
  { key: "receivableDays", label: "应收账款周转天数", group: "资产质量", source: "balance", format: "days", formula: "公开财务指标中的应收账款周转天数" },
  { key: "inventory", label: "存货", group: "资产质量", source: "balance", format: "amount", formula: "资产负债表期末存货" },
  { key: "inventoryDays", label: "存货周转天数", group: "资产质量", source: "balance", format: "days", formula: "公开财务指标中的存货周转天数" },
  { key: "contractLiabilities", label: "合同负债", group: "资产质量", source: "balance", format: "amount", formula: "资产负债表期末合同负债" },
  { key: "goodwill", label: "商誉", group: "资产质量", source: "balance", format: "amount", formula: "资产负债表期末商誉" },
  { key: "fixedAssets", label: "固定资产", group: "资产质量", source: "balance", format: "amount", formula: "资产负债表期末固定资产" },
  { key: "constructionInProgress", label: "在建工程", group: "资产质量", source: "balance", format: "amount", formula: "资产负债表期末在建工程" },
  { key: "cash", label: "货币资金", group: "偿债能力", source: "balance", format: "amount", formula: "资产负债表期末货币资金" },
  { key: "interestBearingDebt", label: "有息负债", group: "偿债能力", source: "balance", format: "amount", formula: "短期借款 + 长期借款 + 应付债券 + 一年内到期非流动负债 + 租赁负债" },
  { key: "netDebt", label: "净负债", group: "偿债能力", source: "balance", format: "amount", formula: "有息负债 - 货币资金" },
  { key: "currentRatio", label: "流动比率", group: "偿债能力", source: "balance", format: "ratio", formula: "流动资产 ÷ 流动负债" },
  { key: "quickRatio", label: "速动比率", group: "偿债能力", source: "balance", format: "ratio", formula: "速动资产 ÷ 流动负债" },
  { key: "debtAssetRatio", label: "资产负债率", group: "偿债能力", source: "balance", format: "percent", formula: "总负债 ÷ 总资产" },
  { key: "interestCoverage", label: "利息保障倍数", group: "偿债能力", source: "balance", format: "ratio", formula: "息税前利润 ÷ 利息费用" },
];

export default function FinancialDashboard({ dataset, load }: { dataset: FinancialDataset; load: LoadState }) {
  const [range, setRange] = useState<RangeKey>("8q");
  const [mode, setMode] = useState<FinancialViewMode>("single");
  const [profitKey, setProfitKey] = useState<ProfitKey>("deductNetProfit");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("absolute");
  const [expandedMetric, setExpandedMetric] = useState<MetricKey | null>(null);
  const hasAnalysis = dataset.analysis.periods.length > 0;

  const visiblePeriods = useMemo(() => {
    const periods = dataset.analysis.periods;
    if (range === "8q") return periods.slice(0, 8).reverse();
    if (range === "12q") return periods.slice(0, 12).reverse();
    const years = range === "5y" ? 5 : 10;
    return periods.filter((period) => period.quarter === 4).slice(0, years).reverse();
  }, [dataset.analysis.periods, range]);
  const latest = visiblePeriods.at(-1) ?? dataset.analysis.periods[0];
  const effectiveMode: FinancialViewMode = range.endsWith("y") ? "cumulative" : mode;
  const signals = useMemo(() => buildSignals(dataset.analysis.periods), [dataset.analysis.periods]);
  const conclusions = latest ? buildConclusions(latest, dataset) : [];
  const labels = visiblePeriods.map(shortPeriodLabel);
  const selectedProfitLabel = profitKey === "parentNetProfit" ? "归母净利润" : "扣非净利润";

  const metricValues = (key: keyof FinancialMetrics) => visiblePeriods.map((period) => displayValue(period, effectiveMode, displayMode, key));
  const absoluteValues = (key: keyof FinancialMetrics) => visiblePeriods.map((period) => period[effectiveMode][key]);
  const balanceValues = (key: keyof FinancialBalanceMetrics) => visiblePeriods.map((period) => period.balance[key]);
  const incomeSeries: FinancialChartSeries[] = displayMode === "absolute" ? [
    { key: "revenue", label: "营业收入", values: absoluteValues("revenue"), color: "#63c7ff", kind: "bar" },
    { key: "revenue-yoy", label: "营收同比", values: visiblePeriods.map((period) => comparisonFor(period, effectiveMode, "yoy").revenue), color: "#f3b760", kind: "line", axis: "right" },
  ] : [{ key: "revenue", label: displayLabel(displayMode, "营业收入"), values: metricValues("revenue"), color: "#63c7ff", kind: "bar" }];
  const profitSeries: FinancialChartSeries[] = displayMode === "absolute" ? [
    { key: profitKey, label: selectedProfitLabel, values: absoluteValues(profitKey), color: "#c38cff", kind: "bar" },
    { key: `${profitKey}-yoy`, label: "利润同比", values: visiblePeriods.map((period) => comparisonFor(period, effectiveMode, "yoy")[profitKey]), color: "#f3b760", kind: "line", axis: "right" },
  ] : [{ key: profitKey, label: displayLabel(displayMode, selectedProfitLabel), values: metricValues(profitKey), color: "#c38cff", kind: "bar" }];
  const profitabilitySeries: FinancialChartSeries[] = [
    { key: "gross-margin", label: "毛利率", values: absoluteValues("grossMargin"), color: "#63c7ff", kind: "line" },
    { key: "net-margin", label: "归母净利率", values: absoluteValues("netMargin"), color: "#f3b760", kind: "line" },
    { key: "deduct-margin", label: "扣非净利率", values: absoluteValues("deductMargin"), color: "#c38cff", kind: "line", dashed: true },
    { key: "roe", label: "ROE", values: visiblePeriods.map((period) => period.ttm.roe), color: "#ff8f70", kind: "line" },
  ];
  const cashSeries: FinancialChartSeries[] = [
    { key: "profit", label: selectedProfitLabel, values: metricValues(profitKey), color: "#c38cff", kind: "bar" },
    { key: "cfo", label: "经营现金流", values: metricValues("operatingCashFlow"), color: "#63c7ff", kind: "bar" },
    { key: "fcf", label: "自由现金流", values: metricValues("freeCashFlow"), color: "#f3b760", kind: "bar" },
  ];
  const indexedQualitySeries = [
    indexedSeries("receivable", "应收", balanceValues("accountsReceivable"), "#63c7ff"),
    indexedSeries("inventory", "存货", balanceValues("inventory"), "#f3b760"),
    indexedSeries("contract", "合同负债", balanceValues("contractLiabilities"), "#c38cff"),
    indexedSeries("debt", "有息负债", balanceValues("interestBearingDebt"), "#ff8f70"),
  ];

  return (
    <section className="finance-dashboard" id="stock-financials" aria-live="polite">
      <header className="finance-dashboard-header">
        <div>
          <p className="eyebrow">FINANCIAL DIAGNOSTICS</p>
          <h3>财报对比</h3>
          <p>{dataset.name ? `${dataset.name} · ${dataset.code}` : "输入股票后生成增长、质量、风险与估值诊断"}</p>
        </div>
        <div className="finance-header-meta">
          {dataset.snapshot.industry ? <span className="industry-pill">{dataset.snapshot.industry}</span> : null}
          <span>{dataset.analysis.sourceScope}</span>
          <span className={`load-badge is-${load.phase}`}>{load.phase === "loading" ? "加载中" : load.phase === "success" ? "已就绪" : load.phase === "error" ? "失败" : "等待"}</span>
        </div>
      </header>

      <div className="finance-filter-bar" aria-label="财报筛选">
        <FilterGroup label="周期" value={range} options={[
          ["8q", "最近8季度"], ["12q", "最近12季度"], ["5y", "近5年"], ["10y", "近10年"],
        ]} onChange={(value) => setRange(value as RangeKey)} />
        <FilterGroup label="口径" value={effectiveMode} options={[
          ["single", "单季度"], ["cumulative", "累计"], ["ttm", "TTM"],
        ]} onChange={(value) => setMode(value as FinancialViewMode)} disabled={range.endsWith("y")} />
        <FilterGroup label="利润" value={profitKey} options={[
          ["parentNetProfit", "归母净利"], ["deductNetProfit", "扣非净利"],
        ]} onChange={(value) => setProfitKey(value as ProfitKey)} />
        <FilterGroup label="显示" value={displayMode} options={[
          ["absolute", "绝对值"], ["yoy", "同比"], ["qoq", "环比"], ["ratio", "占营收"],
        ]} onChange={(value) => setDisplayMode(value as DisplayMode)} />
        <div className="finance-static-filters"><span>合并报表</span><span>正式财报</span></div>
      </div>

      {!hasAnalysis ? (
        <div className={`finance-dashboard-empty ${load.phase === "loading" ? "is-loading" : ""}`}>
          <span className="finance-empty-mark">FIN</span>
          <div>
            <strong>{load.phase === "loading" ? "正在统一三张报表口径" : load.phase === "error" ? "详细财报暂时未加载" : "输入股票查看最近 8 个单季度"}</strong>
            <p>{load.detail}</p>
          </div>
        </div>
      ) : latest ? (
        <>
          <div className="finance-kpi-grid">
            <FinanceKpi label="营业收入" value={latest[effectiveMode].revenue} format="amount" yoy={comparisonFor(latest, effectiveMode, "yoy").revenue} qoq={comparisonFor(latest, effectiveMode, "qoq").revenue} trend={visiblePeriods.map((period) => period[effectiveMode].revenue)} />
            <FinanceKpi label="归母净利润" value={latest[effectiveMode].parentNetProfit} format="amount" yoy={comparisonFor(latest, effectiveMode, "yoy").parentNetProfit} qoq={comparisonFor(latest, effectiveMode, "qoq").parentNetProfit} trend={visiblePeriods.map((period) => period[effectiveMode].parentNetProfit)} />
            <FinanceKpi label="扣非净利润" value={latest[effectiveMode].deductNetProfit} format="amount" yoy={comparisonFor(latest, effectiveMode, "yoy").deductNetProfit} qoq={comparisonFor(latest, effectiveMode, "qoq").deductNetProfit} trend={visiblePeriods.map((period) => period[effectiveMode].deductNetProfit)} note={`与归母差额 ${formatAmount(latest[effectiveMode].nonRecurringProfit)}`} />
            <FinanceKpi label="毛利率" value={latest[effectiveMode].grossMargin} format="percent" yoy={comparisonFor(latest, effectiveMode, "yoy").grossMargin} qoq={comparisonFor(latest, effectiveMode, "qoq").grossMargin} trend={visiblePeriods.map((period) => period[effectiveMode].grossMargin)} deltaUnit="个百分点" />
            <FinanceKpi label="经营现金流" value={latest[effectiveMode].operatingCashFlow} format="amount" yoy={comparisonFor(latest, effectiveMode, "yoy").operatingCashFlow} qoq={comparisonFor(latest, effectiveMode, "qoq").operatingCashFlow} trend={visiblePeriods.map((period) => period[effectiveMode].operatingCashFlow)} />
            <FinanceKpi label="现金含量" value={latest[effectiveMode].cashCoverage} format="ratio" yoy={comparisonFor(latest, effectiveMode, "yoy").cashCoverage} qoq={comparisonFor(latest, effectiveMode, "qoq").cashCoverage} trend={visiblePeriods.map((period) => period[effectiveMode].cashCoverage)} note={cashCoverageNote(latest[effectiveMode].cashCoverage)} deltaUnit="" />
            <FinanceKpi label="ROE TTM" value={latest.ttm.roe} format="percent" yoy={latest.ttmYoY.roe} qoq={latest.ttmQoQ.roe} trend={visiblePeriods.map((period) => period.ttm.roe)} deltaUnit="个百分点" />
            <FinanceKpi label="资产负债率" value={latest.balance.debtAssetRatio} format="percent" yoy={latest.balanceYoY.debtAssetRatio} qoq={latest.balanceQoQ.debtAssetRatio} trend={visiblePeriods.map((period) => period.balance.debtAssetRatio)} deltaUnit="个百分点" />
          </div>

          <div className="valuation-support-strip" id="finance-valuation">
            <div className="valuation-support-copy">
              <span>业绩与估值匹配</span>
              <strong>{valuationVerdict(latest, dataset)}</strong>
              <small>仅作历史财务与当前估值对照，不构成目标价判断</small>
            </div>
            <ValuationMetric label="收盘价" value={formatPrice(dataset.snapshot.closePrice)} />
            <ValuationMetric label="PE TTM" value={formatMultiple(dataset.snapshot.peTtm)} />
            <ValuationMetric label="PB MRQ" value={formatMultiple(dataset.snapshot.pb)} />
            <ValuationMetric label="PS TTM" value={formatMultiple(dataset.snapshot.psTtm)} />
            <ValuationMetric label="TTM利润同比" value={formatPercent(latest.ttmYoY.parentNetProfit)} tone={latest.ttmYoY.parentNetProfit} />
            <ValuationMetric label="股息率 TTM" value={formatPercent(dataset.snapshot.dividendYieldTtm, false)} />
          </div>

          <div className="finance-chart-grid">
            <FinanceChartCard id="finance-income" title="收入趋势" subtitle={`${rangeLabel(range)} · ${modeLabel(effectiveMode)} · 柱为规模，线为同比`}>
              <FinancialChart labels={labels} series={incomeSeries} leftUnit={displayMode === "absolute" ? "元" : "%"} rightUnit="%" ariaLabel="营业收入及同比趋势" />
            </FinanceChartCard>
            <FinanceChartCard id="finance-profit" title="利润趋势" subtitle={`${selectedProfitLabel} · 与收入分轴展示`}>
              <FinancialChart labels={labels} series={profitSeries} leftUnit={displayMode === "absolute" ? "元" : "%"} rightUnit="%" ariaLabel={`${selectedProfitLabel}及同比趋势`} />
            </FinanceChartCard>
            <FinanceChartCard id="finance-margin" title="盈利能力趋势" subtitle="毛利率、净利率、扣非净利率与 ROE TTM · 单位 %">
              <FinancialChart labels={labels} series={profitabilitySeries} leftUnit="%" ariaLabel="盈利能力指标趋势" />
            </FinanceChartCard>
            <FinanceChartCard id="finance-cash" title="现金流与利润匹配度" subtitle={`${modeLabel(effectiveMode)} · 经营现金流、自由现金流与利润同轴比较`}>
              <FinancialChart labels={labels} series={cashSeries} leftUnit={displayMode === "absolute" ? "元" : "%"} ariaLabel="净利润、经营现金流与自由现金流对比" />
            </FinanceChartCard>
            <FinanceChartCard id="finance-assets" title="资产负债与经营质量" subtitle="期末值指数化，所选区间首期 = 100；精确值见下表">
              <FinancialChart labels={labels} series={indexedQualitySeries} leftUnit="指数" ariaLabel="应收账款、存货、合同负债和有息负债指数趋势" />
            </FinanceChartCard>
            <section className="finance-signal-card" id="finance-signals">
              <header><div><p className="eyebrow">RULE ENGINE</p><h4>异常与改善信号</h4></div><span>{signals.length} 条</span></header>
              <div className="finance-signal-list">
                {signals.slice(0, 6).map((signal) => (
                  <article className={`finance-signal is-${signal.tone}`} key={signal.title}>
                    <i>{signal.tone === "risk" ? "!" : signal.tone === "positive" ? "+" : "·"}</i>
                    <div><strong>{signal.title}</strong><p>{signal.evidence}</p></div>
                  </article>
                ))}
              </div>
              <p className="finance-rule-note">规则仅提示需要核查的方向，不据此断言财务造假或投资结论。</p>
            </section>
          </div>

          <section className="finance-detail-card" id="finance-detail">
            <header>
              <div><p className="eyebrow">FINANCIAL MATRIX</p><h4>详细财务指标对比</h4></div>
              <div><span>点击指标可展开趋势 · 悬停查看公式</span><button type="button" onClick={() => exportFinancialCsv(dataset.name || dataset.code, visiblePeriods, effectiveMode)}>导出 Excel / CSV</button></div>
            </header>
            {expandedMetric ? (
              <div className="expanded-metric-chart">
                <div><strong>{tableRows.find((row) => row.key === expandedMetric)?.label}</strong><button type="button" onClick={() => setExpandedMetric(null)}>收起</button></div>
                <FinancialChart labels={labels} series={[expandedSeries(expandedMetric, visiblePeriods, effectiveMode)]} leftUnit={metricUnit(expandedMetric)} height={190} ariaLabel={`${String(expandedMetric)}趋势`} />
              </div>
            ) : null}
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead><tr><th>指标</th>{visiblePeriods.map((period) => <th key={period.reportDate}>{shortPeriodLabel(period)}</th>)}</tr></thead>
                <tbody>{renderTableRows(tableRows, visiblePeriods, effectiveMode, displayMode, expandedMetric, setExpandedMetric)}</tbody>
              </table>
            </div>
            <p className="finance-table-note">流量指标的单季度值由同一会计年度累计值差分；Q4 = 年报 - 三季报。TTM 为最近四个单季度之和；资产负债指标始终使用期末值。</p>
          </section>

          <section className="finance-conclusion-card" id="finance-conclusion">
            <header><div><p className="eyebrow">TRACEABLE READOUT</p><h4>财报结论与后续关注</h4></div><span>每条结论均可定位依据</span></header>
            <div className="finance-conclusion-grid">
              {conclusions.map((item, index) => (
                <article key={item.title}><span>{index + 1}</span><div><strong>{item.title}</strong><p>{item.body}</p><button type="button" onClick={() => document.getElementById(item.target)?.scrollIntoView({ behavior: "smooth", block: "center" })}>查看依据</button></div></article>
              ))}
            </div>
          </section>
          <p className="finance-source-note">财报截至 {dataset.analysis.latestReportDate}，估值截至 {dataset.snapshot.asOfDate || "—"}。来源：{dataset.source}；页面按公开合并报表计算，公告修订后数值可能变化。</p>
        </>
      ) : null}
    </section>
  );
}

function FilterGroup({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: string[][]; onChange: (value: string) => void; disabled?: boolean }) {
  return <div className={`finance-filter-group ${disabled ? "is-disabled" : ""}`}><span>{label}</span><div>{options.map(([key, text]) => <button key={key} type="button" className={value === key ? "active" : ""} disabled={disabled} onClick={() => onChange(key)}>{text}</button>)}</div></div>;
}

function FinanceKpi({ label, value, format, yoy, qoq, trend, note, deltaUnit = "%" }: { label: string; value: number | null; format: "amount" | "percent" | "ratio"; yoy: number | null; qoq: number | null; trend: Array<number | null>; note?: string; deltaUnit?: string }) {
  return (
    <article className="finance-kpi">
      <span>{label}</span><strong>{formatValue(value, format)}</strong>
      <div><small className={toneClass(yoy)}>同比 {formatDelta(yoy, deltaUnit)}</small><small className={toneClass(qoq)}>环比 {formatDelta(qoq, deltaUnit)}</small></div>
      <MiniTrend values={trend} />
      {note ? <p>{note}</p> : null}
    </article>
  );
}

function MiniTrend({ values }: { values: Array<number | null> }) {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  return <div className="finance-mini-trend" aria-hidden="true">{values.map((value, index) => <i key={index} style={{ height: `${value == null ? 2 : 18 + ((value - min) / Math.max(1e-9, max - min)) * 82}%` }} />)}</div>;
}

function ValuationMetric({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  return <div className="valuation-support-metric"><span>{label}</span><strong className={toneClass(tone ?? null)}>{value}</strong></div>;
}

function FinanceChartCard({ id, title, subtitle, children }: { id: string; title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="finance-chart-card" id={id}><header><div><h4>{title}</h4><p>{subtitle}</p></div></header>{children}</section>;
}

function comparisonFor(period: FinancialAnalysisPeriod, mode: FinancialViewMode, comparison: "yoy" | "qoq"): FinancialMetrics {
  const suffix = comparison === "yoy" ? "YoY" : "QoQ";
  return period[`${mode}${suffix}` as "singleYoY" | "singleQoQ" | "cumulativeYoY" | "cumulativeQoQ" | "ttmYoY" | "ttmQoQ"];
}

function displayValue(period: FinancialAnalysisPeriod, mode: FinancialViewMode, display: DisplayMode, key: keyof FinancialMetrics): number | null {
  if (display === "yoy") return comparisonFor(period, mode, "yoy")[key];
  if (display === "qoq") return comparisonFor(period, mode, "qoq")[key];
  if (display === "ratio") {
    if (key === "revenue") return 100;
    if (key === "parentNetProfit") return period[mode].netMargin;
    if (key === "deductNetProfit") return period[mode].deductMargin;
    const revenue = period[mode].revenue;
    const value = period[mode][key];
    return value == null || revenue == null || revenue === 0 ? null : (value / revenue) * 100;
  }
  return period[mode][key];
}

function indexedSeries(key: string, label: string, values: Array<number | null>, color: string): FinancialChartSeries {
  const base = values.find((value) => value != null && value !== 0) ?? null;
  return { key, label, values: values.map((value) => value == null || base == null ? null : (value / base) * 100), color, kind: "line" };
}

function expandedSeries(key: MetricKey, periods: FinancialAnalysisPeriod[], mode: FinancialViewMode): FinancialChartSeries {
  const row = tableRows.find((item) => item.key === key);
  const values = row?.source === "balance"
    ? periods.map((period) => period.balance[key as keyof FinancialBalanceMetrics])
    : periods.map((period) => period[mode][key as keyof FinancialMetrics]);
  return { key: String(key), label: row?.label ?? String(key), values, color: "#63c7ff", kind: "line" };
}

function renderTableRows(rows: TableRow[], periods: FinancialAnalysisPeriod[], mode: FinancialViewMode, display: DisplayMode, expanded: MetricKey | null, setExpanded: (key: MetricKey | null) => void) {
  let group = "";
  return rows.flatMap((row) => {
    const output: React.ReactNode[] = [];
    if (row.group !== group) {
      group = row.group;
      output.push(<tr className="finance-table-group" key={`group-${group}`}><th colSpan={periods.length + 1}>{group}</th></tr>);
    }
    output.push(<tr className={expanded === row.key ? "is-expanded" : ""} key={row.key}><th title={row.formula}><button type="button" onClick={() => setExpanded(expanded === row.key ? null : row.key)}>{row.label}<i>↗</i></button></th>{periods.map((period) => <td key={period.reportDate}>{formatTableValue(row, period, mode, display)}</td>)}</tr>);
    return output;
  });
}

function formatTableValue(row: TableRow, period: FinancialAnalysisPeriod, mode: FinancialViewMode, display: DisplayMode): string {
  if (row.source === "balance") {
    const key = row.key as keyof FinancialBalanceMetrics;
    if (display === "yoy") return formatBalanceComparison(period.balanceYoY[key], row.format);
    if (display === "qoq") return formatBalanceComparison(period.balanceQoQ[key], row.format);
    if (display === "ratio" && row.format === "amount") {
      const value = period.balance[key];
      const denominator = period.balance.totalAssets;
      return value == null || denominator == null || denominator === 0 ? "—" : formatPercent((value / denominator) * 100, false);
    }
    return formatByKind(period.balance[key], row.format);
  }
  const key = row.key as keyof FinancialMetrics;
  if (display === "yoy") return formatComparison(period, mode, key, "yoy");
  if (display === "qoq") return formatComparison(period, mode, key, "qoq");
  if (display === "ratio" && row.format === "amount") return formatPercent(displayValue(period, mode, "ratio", key), false);
  return formatByKind(period[mode][key], row.format);
}

function formatComparison(period: FinancialAnalysisPeriod, mode: FinancialViewMode, key: keyof FinancialMetrics, comparison: "yoy" | "qoq") {
  const value = comparisonFor(period, mode, comparison)[key];
  return ["grossMargin", "netMargin", "deductMargin", "researchExpenseRatio", "roe", "roic"].includes(key) ? formatDelta(value, "个百分点") : formatPercent(value);
}

function formatBalanceComparison(value: number | null, format: TableRow["format"]): string {
  if (format === "amount") return formatPercent(value);
  if (format === "percent") return formatDelta(value, "个百分点");
  if (format === "days") return formatDelta(value, "天");
  return formatDelta(value, "");
}

function buildSignals(periods: FinancialAnalysisPeriod[]) {
  const latest = periods[0];
  const previous = periods[1];
  const previous2 = periods[2];
  if (!latest) return [];
  const signals: Array<{ title: string; evidence: string; tone: "risk" | "watch" | "positive" }> = [];
  const revenueGrowth = latest.singleYoY.revenue;
  const deductGrowth = latest.singleYoY.deductNetProfit;
  if ((revenueGrowth ?? 0) > 0 && (deductGrowth ?? 0) < 0) signals.push({ title: "增收不增利", evidence: `营收同比 ${formatPercent(revenueGrowth)}，扣非净利润同比 ${formatPercent(deductGrowth)}。`, tone: "risk" });
  if ((latest.singleYoY.parentNetProfit ?? 0) > 0 && (latest.singleYoY.operatingCashFlow ?? 0) < 0) signals.push({ title: "利润现金支撑减弱", evidence: `净利润增长但经营现金流同比 ${formatPercent(latest.singleYoY.operatingCashFlow)}，需要关注回款。`, tone: "risk" });
  if (latest.balanceYoY.accountsReceivable != null && revenueGrowth != null && latest.balanceYoY.accountsReceivable > revenueGrowth + 20) signals.push({ title: "应收压力", evidence: `应收账款同比 ${formatPercent(latest.balanceYoY.accountsReceivable)}，高于营收增速 ${formatNumber(latest.balanceYoY.accountsReceivable - revenueGrowth, 1)} 个百分点。`, tone: "watch" });
  if ((latest.balanceYoY.inventory ?? 0) > 0 && (latest.balanceYoY.inventoryDays ?? 0) > 0) signals.push({ title: "存货压力", evidence: `存货同比 ${formatPercent(latest.balanceYoY.inventory)}，周转天数同比增加 ${formatNumber(latest.balanceYoY.inventoryDays ?? 0, 1)} 天。`, tone: "watch" });
  if (previous && previous2 && falling([previous2.single.grossMargin, previous.single.grossMargin, latest.single.grossMargin])) signals.push({ title: "毛利率连续回落", evidence: `最近三期毛利率为 ${[previous2, previous, latest].map((period) => formatPercent(period.single.grossMargin, false)).join("、")}。`, tone: "risk" });
  const parentProfit = latest.single.parentNetProfit;
  const deductProfit = latest.single.deductNetProfit;
  if (parentProfit != null && parentProfit > 0 && deductProfit != null && deductProfit / parentProfit < 0.7) signals.push({ title: "非经常性损益依赖", evidence: `扣非净利润仅占归母净利润 ${formatPercent((deductProfit / parentProfit) * 100, false)}。`, tone: "watch" });
  if (latest.balanceYoY.interestBearingDebt != null && revenueGrowth != null && latest.balanceYoY.interestBearingDebt > revenueGrowth + 20) signals.push({ title: "债务扩张", evidence: `有息负债同比 ${formatPercent(latest.balanceYoY.interestBearingDebt)}，明显快于营收。`, tone: "watch" });
  if ((latest.singleYoY.capex ?? 0) > 30 && ((latest.balanceYoY.constructionInProgress ?? 0) > 20 || (latest.balanceYoY.fixedAssets ?? 0) > 20)) signals.push({ title: "扩产投入增强", evidence: `资本开支同比 ${formatPercent(latest.singleYoY.capex)}，固定资产/在建工程同步增加。`, tone: "positive" });
  if ((latest.balanceYoY.contractLiabilities ?? 0) > 30) signals.push({ title: "订单先行线索", evidence: `合同负债同比 ${formatPercent(latest.balanceYoY.contractLiabilities)}，可能反映预收或订单增加。`, tone: "positive" });
  const goodwillRatio = ratio(latest.balance.goodwill, latest.balance.parentEquity);
  if (goodwillRatio != null && goodwillRatio > 0.3) signals.push({ title: "商誉占比较高", evidence: `商誉约占归母净资产 ${formatPercent(goodwillRatio * 100, false)}，需关注减值风险。`, tone: "watch" });
  if (!signals.length) signals.push({ title: "暂无高置信度异常", evidence: `基于 ${latest.periodLabel} 与历史同期的规则检查，暂未触发主要异常阈值。`, tone: "positive" });
  return signals;
}

function buildConclusions(latest: FinancialAnalysisPeriod, dataset: FinancialDataset) {
  const revenueGrowth = latest.singleYoY.revenue;
  const profitGrowth = latest.singleYoY.deductNetProfit;
  const grossMarginChange = latest.singleYoY.grossMargin;
  const coverage = latest.single.cashCoverage;
  const receivableGrowth = latest.balanceYoY.accountsReceivable;
  const contractGrowth = latest.balanceYoY.contractLiabilities;
  const revenueStreak = positiveGrowthStreak(dataset.analysis.periods, "revenue");
  const profitStreak = positiveGrowthStreak(dataset.analysis.periods, "deductNetProfit");
  return [
    { title: "业绩表现", target: "finance-income", body: `${latest.periodLabel} 单季度营收同比 ${formatPercent(revenueGrowth)}，扣非净利润同比 ${formatPercent(profitGrowth)}；${relativeGrowthText(revenueGrowth, profitGrowth)}。营收/扣非利润已连续 ${revenueStreak}/${profitStreak} 个可比季度同比增长。` },
    { title: "盈利质量", target: "finance-cash", body: `毛利率同比 ${formatDelta(grossMarginChange, "个百分点")}；经营现金流／归母净利润为 ${formatRatio(coverage)}，${cashCoverageNote(coverage)}。` },
    { title: "资产变化", target: "finance-assets", body: `应收账款同比 ${formatPercent(receivableGrowth)}，合同负债同比 ${formatPercent(contractGrowth)}；结合存货与周转天数判断回款和订单兑现。` },
    { title: "估值与后续关注", target: "finance-valuation", body: `${valuationVerdict(latest, dataset)} 后续重点跟踪经营现金流、扣非利润和资产周转能否延续。` },
  ];
}

function positiveGrowthStreak(periods: FinancialAnalysisPeriod[], key: "revenue" | "deductNetProfit"): number {
  let count = 0;
  for (const period of periods) {
    const value = period.singleYoY[key];
    if (value == null || value <= 0) break;
    count += 1;
  }
  return count;
}

function valuationVerdict(latest: FinancialAnalysisPeriod, dataset: FinancialDataset): string {
  const pe = dataset.snapshot.peTtm;
  const growthValue = latest.ttmYoY.parentNetProfit;
  if (pe == null) return "当前缺少可比 PE，暂不能仅凭公开数据判断估值支撑。";
  if (pe <= 0) return `PE TTM 为 ${formatMultiple(pe)}，滚动盈利为负或口径异常，业绩暂未形成正向估值基础。`;
  if ((growthValue ?? 0) > 0) return `PE TTM ${formatMultiple(pe)}，TTM 归母净利润同比 ${formatPercent(growthValue)}，盈利增长对估值有一定基础，但仍需与行业中位数比较。`;
  return `PE TTM ${formatMultiple(pe)}，TTM 归母净利润同比 ${formatPercent(growthValue)}，当前估值需要后续盈利修复验证。`;
}

function exportFinancialCsv(name: string, periods: FinancialAnalysisPeriod[], mode: FinancialViewMode) {
  const rows = [["指标", ...periods.map(shortPeriodLabel)], ...tableRows.map((row) => [row.label, ...periods.map((period) => formatTableValue(row, period, mode, "absolute"))])];
  const blob = new Blob(["\uFEFF", rows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${name || "stock"}-financials-${mode}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

function csvCell(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function shortPeriodLabel(period: FinancialAnalysisPeriod): string { return `${String(period.fiscalYear).slice(-2)}Q${period.quarter}`; }
function rangeLabel(range: RangeKey): string { return ({ "8q": "最近8季度", "12q": "最近12季度", "5y": "近5年", "10y": "近10年" })[range]; }
function modeLabel(mode: FinancialViewMode): string { return ({ single: "单季度", cumulative: "累计", ttm: "TTM" })[mode]; }
function displayLabel(mode: DisplayMode, metric: string): string { return ({ absolute: metric, yoy: `${metric}同比`, qoq: `${metric}环比`, ratio: `${metric}占营收` })[mode]; }
function cashCoverageNote(value: number | null): string { return value == null ? "现金含量暂不可比" : value >= 1 ? "利润现金支撑较好" : value < 0.5 ? "现金支撑偏弱，需要关注" : "现金支撑一般"; }
function relativeGrowthText(revenue: number | null, profit: number | null): string { if (revenue == null || profit == null) return "同比口径暂不完整"; return profit > revenue ? "利润增速高于收入增速" : profit < revenue ? "利润增速低于收入增速" : "利润与收入增速接近"; }
function falling(values: Array<number | null>): boolean { return values.every((value): value is number => value != null) && values[0] > values[1] && values[1] > values[2]; }
function ratio(left: number | null, right: number | null): number | null { return left == null || right == null || right === 0 ? null : left / right; }
function metricUnit(key: MetricKey): string { const row = tableRows.find((item) => item.key === key); return row?.format === "amount" ? "元" : row?.format === "percent" ? "%" : "指数"; }
function toneClass(value: number | null): string { return value == null || !Number.isFinite(value) ? "" : value >= 0 ? "is-up" : "is-down"; }
function formatByKind(value: number | null, kind: TableRow["format"]): string { if (kind === "amount") return formatAmount(value); if (kind === "percent") return formatPercent(value, false); if (kind === "days") return value == null ? "—" : `${formatNumber(value, 1)} 天`; return formatRatio(value); }
function formatValue(value: number | null, kind: "amount" | "percent" | "ratio"): string { return kind === "amount" ? formatAmount(value) : kind === "percent" ? formatPercent(value, false) : formatRatio(value); }
function formatAmount(value: number | null): string { if (value == null || !Number.isFinite(value)) return "—"; const abs = Math.abs(value); if (abs >= 100_000_000) return `${formatNumber(value / 100_000_000, abs >= 10_000_000_000 ? 1 : 2)} 亿`; if (abs >= 10_000) return `${formatNumber(value / 10_000, 2)} 万`; return `${formatNumber(value, 0)} 元`; }
function formatPercent(value: number | null, signed = true): string { return value == null || !Number.isFinite(value) ? "—" : `${signed && value >= 0 ? "+" : ""}${formatNumber(value, 2)}%`; }
function formatDelta(value: number | null, unit: string): string { if (value == null || !Number.isFinite(value)) return "—"; return `${value >= 0 ? "+" : ""}${formatNumber(value, 2)}${unit ? ` ${unit}` : ""}`; }
function formatRatio(value: number | null): string { return value == null || !Number.isFinite(value) ? "—" : `${formatNumber(value, 2)}×`; }
function formatMultiple(value: number | null): string { return value == null || !Number.isFinite(value) ? "—" : `${formatNumber(value, 2)}×`; }
function formatPrice(value: number | null): string { return value == null || !Number.isFinite(value) ? "—" : `¥${formatNumber(value, 2)}`; }
function formatNumber(value: number, digits: number): string { return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value); }
