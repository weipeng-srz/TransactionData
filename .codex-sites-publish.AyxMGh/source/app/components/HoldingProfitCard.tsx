"use client";

import { useMemo, useState } from "react";
import { calculateHoldingMetrics, type StockHolding } from "../lib/holdings";

type HoldingProfitCardProps = {
  code: string;
  name: string;
  currentPrice: number | null;
  holding: StockHolding | null;
  isDemo: boolean;
  cloudStatus: "loading" | "synced" | "local" | "error";
  onSave: (shares: number, cost: number) => void;
  onClear: () => void;
};

const currencyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function HoldingProfitCard({
  code,
  name,
  currentPrice,
  holding,
  isDemo,
  cloudStatus,
  onSave,
  onClear,
}: HoldingProfitCardProps) {
  const [sharesInput, setSharesInput] = useState(() => holding ? String(holding.shares) : "");
  const [costInput, setCostInput] = useState(() => holding ? String(holding.cost) : "");
  const [notice, setNotice] = useState("");

  const shares = Number(sharesInput);
  const cost = Number(costInput);
  const validInput = Number.isInteger(shares) && shares > 0 && Number.isFinite(cost) && cost > 0;
  const metrics = useMemo(
    () => calculateHoldingMetrics(shares, cost, currentPrice),
    [cost, currentPrice, shares],
  );
  const toneClass = metrics ? metrics.profit > 0 ? "is-up" : metrics.profit < 0 ? "is-down" : "" : "";
  const syncLabel = cloudStatus === "synced"
    ? "云端同步"
    : cloudStatus === "loading"
      ? "同步中"
      : cloudStatus === "error"
        ? "本机已存"
        : "本机保存";

  const save = () => {
    if (!validInput) {
      setNotice("请输入整数股数和有效成本");
      return;
    }
    if (isDemo) {
      setNotice("请先查询真实股票再保存持仓");
      return;
    }
    onSave(shares, cost);
    setNotice("已保存，下次打开该股票会自动加载");
  };

  const clear = () => {
    onClear();
    setSharesInput("");
    setCostInput("");
    setNotice("已清除当前股票的持仓记录");
  };

  return (
    <section className="rail-card holding-card" aria-labelledby="holding-profit-title">
      <div className="rail-heading">
        <div>
          <p className="eyebrow">MY POSITION</p>
          <h3 id="holding-profit-title">持仓收益</h3>
        </div>
        <span className={`holding-sync is-${cloudStatus}`}>{holding ? syncLabel : "未记录"}</span>
      </div>

      <div className="holding-symbol">
        <span>{name || "当前股票"}</span>
        <b>{code}</b>
        <small>现价 {currentPrice == null ? "—" : formatPrice(currentPrice)}</small>
      </div>

      <div className="holding-input-grid">
        <label>
          <span>持有股数</span>
          <div><input aria-label="持有股数" min="1" step="1" inputMode="numeric" type="number" value={sharesInput} onChange={(event) => setSharesInput(event.target.value)} placeholder="例如 1000" /><i>股</i></div>
        </label>
        <label>
          <span>平均成本</span>
          <div><input aria-label="平均成本" min="0.001" step="0.001" inputMode="decimal" type="number" value={costInput} onChange={(event) => setCostInput(event.target.value)} placeholder="例如 12.500" /><i>元</i></div>
        </label>
      </div>

      <div className="holding-results" aria-live="polite">
        <div className="holding-profit">
          <span>目前盈亏</span>
          <strong className={toneClass}>{metrics ? formatSignedCurrency(metrics.profit) : "—"}</strong>
          <b className={toneClass}>{metrics ? `${metrics.profitPct >= 0 ? "+" : ""}${metrics.profitPct.toFixed(2)}%` : "—"}</b>
        </div>
        <div className="holding-values">
          <span>持仓市值 <b>{metrics ? currencyFormatter.format(metrics.marketValue) : "—"}</b></span>
          <span>投入成本 <b>{metrics ? currencyFormatter.format(metrics.costValue) : "—"}</b></span>
        </div>
      </div>

      <div className="holding-actions">
        <button type="button" onClick={save}>保存持仓</button>
        {holding ? <button className="secondary" type="button" onClick={clear}>清除</button> : null}
        <span role="status">{notice || (holding ? "已保存，下次自动加载" : isDemo ? "演示行情不可保存" : "按股票代码独立记录")}</span>
      </div>
    </section>
  );
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value);
}

function formatSignedCurrency(value: number): string {
  if (value === 0) return currencyFormatter.format(0);
  return `${value > 0 ? "+" : "-"}${currencyFormatter.format(Math.abs(value))}`;
}
