"use client";

import { klineRangeLength, rangeForLatest, zoomKlineRange, type KlineRange } from "../lib/klineViewport";

export default function KlineViewportControls({
  range,
  total,
  minVisible = 10,
  resetVisible,
  onRangeChange,
  className = "",
}: {
  range: KlineRange;
  total: number;
  minVisible?: number;
  resetVisible: number;
  onRangeChange: (range: KlineRange) => void;
  className?: string;
}) {
  const visible = Math.min(total, klineRangeLength(range));
  const zoom = (deltaY: number) => onRangeChange(zoomKlineRange({
    range,
    total,
    deltaY,
    anchorRatio: 1,
    minVisible,
  }));

  return (
    <div
      className={`kline-viewport-controls ${className}`.trim()}
      role="toolbar"
      aria-label="K线缩放控制"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={() => zoom(120)} disabled={visible >= total} aria-label="缩小K线图" title="缩小（显示更多K线）">−</button>
      <span title={`当前显示 ${visible} / ${total} 根K线`}>{visible}<small>根</small></span>
      <button type="button" onClick={() => zoom(-120)} disabled={visible <= Math.min(total, minVisible)} aria-label="放大K线图" title="放大（显示更少K线）">＋</button>
      <button className="is-reset" type="button" onClick={() => onRangeChange(rangeForLatest(total, resetVisible))} disabled={!total} aria-label="复位K线视窗">复位</button>
    </div>
  );
}
