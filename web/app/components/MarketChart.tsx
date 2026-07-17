"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Candle, IndicatorSet, LowerIndicator } from "../lib/market";
import { formatNumber } from "../lib/market";

type OverlayKey = "ma5" | "ma10" | "ma20" | "ema" | "boll" | "vwap" | "nineTurn" | "guides";

type Props = {
  candles: Candle[];
  indicators: IndicatorSet;
  overlays: Record<OverlayKey, boolean>;
  lowerIndicator: LowerIndicator;
  range: { from: number; to: number };
  onRangeChange: (range: { from: number; to: number }) => void;
  onHover: (index: number | null) => void;
};

type HoverState = { index: number; x: number; y: number } | null;
type Layout = {
  left: number;
  plotWidth: number;
  candleWidth: number;
  from: number;
  to: number;
  mainTop: number;
  mainBottom: number;
  priceMin: number;
  priceMax: number;
};

const colors = {
  grid: "rgba(126, 143, 163, .13)",
  text: "#718096",
  textStrong: "#b8c3d1",
  up: "#f05d5e",
  down: "#24b47e",
  neutral: "#91a0b2",
  ma5: "#f3b760",
  ma10: "#63c7ff",
  ma20: "#c38cff",
  ema12: "#ff8f70",
  ema26: "#70d6ae",
  boll: "#8192ff",
  vwap: "#f08ec6",
  nineBuy: "#63c7ff",
  nineSell: "#f3b760",
  white: "#eaf0f6",
};

export default function MarketChart({
  candles,
  indicators,
  overlays,
  lowerIndicator,
  range,
  onRangeChange,
  onHover,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<Layout | null>(null);
  const dragRef = useRef<{ x: number; from: number; to: number } | null>(null);
  const [size, setSize] = useState({ width: 960, height: 560 });
  const [hover, setHover] = useState<HoverState>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.max(320, entry.contentRect.width), height: Math.max(480, entry.contentRect.height) });
    });
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, []);

  const visible = useMemo(
    () => candles.slice(Math.max(0, range.from), Math.min(candles.length, range.to + 1)),
    [candles, range],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    if (visible.length === 0) {
      context.fillStyle = colors.text;
      context.font = "13px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText("没有可显示的 K 线数据", 24, 40);
      return;
    }

    const left = 12;
    const right = 72;
    const plotWidth = size.width - left - right;
    const mainTop = 34;
    const mainBottom = Math.round(size.height * 0.67);
    const lowerTop = mainBottom + 42;
    const lowerBottom = size.height - 34;
    const candleWidth = plotWidth / visible.length;

    const priceValues = visible.flatMap((candle) => [candle.high, candle.low]);
    const addOverlayValues = (values: Array<number | null>) => {
      for (let index = range.from; index <= range.to; index += 1) {
        const value = values[index];
        if (value !== null && Number.isFinite(value)) priceValues.push(value);
      }
    };
    if (overlays.ma5) addOverlayValues(indicators.ma5);
    if (overlays.ma10) addOverlayValues(indicators.ma10);
    if (overlays.ma20) addOverlayValues(indicators.ma20);
    if (overlays.ema) {
      addOverlayValues(indicators.ema12);
      addOverlayValues(indicators.ema26);
    }
    if (overlays.boll) {
      addOverlayValues(indicators.bollUpper);
      addOverlayValues(indicators.bollLower);
    }
    if (overlays.vwap) addOverlayValues(indicators.vwap);
    let priceMin = Math.min(...priceValues);
    let priceMax = Math.max(...priceValues);
    const padding = Math.max((priceMax - priceMin) * 0.09, priceMax * 0.004);
    priceMin -= padding;
    priceMax += padding;

    const xFor = (localIndex: number) => left + candleWidth * (localIndex + 0.5);
    const yForPrice = (price: number) => mainTop + ((priceMax - price) / (priceMax - priceMin)) * (mainBottom - mainTop);
    const globalToLocal = (globalIndex: number) => globalIndex - range.from;

    context.lineWidth = 1;
    context.strokeStyle = colors.grid;
    context.fillStyle = colors.text;
    context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "left";
    for (let step = 0; step <= 5; step += 1) {
      const y = mainTop + ((mainBottom - mainTop) / 5) * step;
      context.beginPath();
      context.moveTo(left, y + 0.5);
      context.lineTo(left + plotWidth, y + 0.5);
      context.stroke();
      const value = priceMax - ((priceMax - priceMin) / 5) * step;
      context.fillText(value.toFixed(3), left + plotWidth + 9, y + 4);
    }
    for (let step = 0; step <= 6; step += 1) {
      const x = left + (plotWidth / 6) * step;
      context.beginPath();
      context.moveTo(x + 0.5, mainTop);
      context.lineTo(x + 0.5, lowerBottom);
      context.stroke();
    }

    if (overlays.boll) {
      const upperPoints: Array<[number, number]> = [];
      const lowerPoints: Array<[number, number]> = [];
      for (let index = range.from; index <= range.to; index += 1) {
        const upper = indicators.bollUpper[index];
        const lower = indicators.bollLower[index];
        if (upper !== null && lower !== null) {
          const x = xFor(globalToLocal(index));
          upperPoints.push([x, yForPrice(upper)]);
          lowerPoints.push([x, yForPrice(lower)]);
        }
      }
      if (upperPoints.length > 1) {
        context.beginPath();
        upperPoints.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
        [...lowerPoints].reverse().forEach(([x, y]) => context.lineTo(x, y));
        context.closePath();
        context.fillStyle = "rgba(129, 146, 255, .07)";
        context.fill();
      }
    }

    visible.forEach((candle, localIndex) => {
      const x = xFor(localIndex);
      const openY = yForPrice(candle.open);
      const closeY = yForPrice(candle.close);
      const highY = yForPrice(candle.high);
      const lowY = yForPrice(candle.low);
      const color = candle.close > candle.open ? colors.up : candle.close < candle.open ? colors.down : colors.neutral;
      context.strokeStyle = color;
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(x + 0.5, highY);
      context.lineTo(x + 0.5, lowY);
      context.stroke();
      const bodyWidth = Math.max(1, Math.min(candleWidth * 0.62, 12));
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(1.2, Math.abs(closeY - openY));
      if (candle.close >= candle.open) {
        context.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
      } else {
        context.strokeRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
      }
    });

    const drawLine = (values: Array<number | null>, color: string, width = 1.2, dashed = false) => {
      context.beginPath();
      context.strokeStyle = color;
      context.lineWidth = width;
      context.setLineDash(dashed ? [4, 4] : []);
      let started = false;
      for (let index = range.from; index <= range.to; index += 1) {
        const value = values[index];
        if (value === null || !Number.isFinite(value)) {
          started = false;
          continue;
        }
        const x = xFor(globalToLocal(index));
        const y = yForPrice(value);
        if (!started) {
          context.moveTo(x, y);
          started = true;
        } else {
          context.lineTo(x, y);
        }
      }
      context.stroke();
      context.setLineDash([]);
      context.lineWidth = 1;
    };

    if (overlays.ma5) drawLine(indicators.ma5, colors.ma5);
    if (overlays.ma10) drawLine(indicators.ma10, colors.ma10);
    if (overlays.ma20) drawLine(indicators.ma20, colors.ma20);
    if (overlays.ema) {
      drawLine(indicators.ema12, colors.ema12, 1, true);
      drawLine(indicators.ema26, colors.ema26, 1, true);
    }
    if (overlays.boll) {
      drawLine(indicators.bollUpper, colors.boll, 1, true);
      drawLine(indicators.bollMid, "#a9b4ff", 1);
      drawLine(indicators.bollLower, colors.boll, 1, true);
    }
    if (overlays.vwap) drawLine(indicators.vwap, colors.vwap, 1.15, true);

    if (overlays.nineTurn) {
      context.textAlign = "center";
      context.font = "700 9px ui-monospace, SFMono-Regular, Menlo, monospace";
      for (let index = range.from; index <= range.to; index += 1) {
        const mark = indicators.nineTurn[index];
        if (!mark) continue;
        const candle = candles[index];
        const x = xFor(globalToLocal(index));
        const y = mark.direction === "buy" ? yForPrice(candle.low) + 13 : yForPrice(candle.high) - 7;
        context.fillStyle = mark.direction === "buy" ? colors.nineBuy : colors.nineSell;
        if (mark.completed) {
          context.beginPath();
          context.arc(x, y - 3, 7, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = "#071016";
        }
        context.fillText(String(mark.count), x, y);
      }
    }

    if (overlays.guides) {
      for (let index = range.from; index <= range.to; index += 1) {
        const guide = indicators.guidePoints[index];
        if (!guide) continue;
        const candle = candles[index];
        const x = xFor(globalToLocal(index));
        const anchor = guide.type === "buy" ? yForPrice(candle.low) + 23 : yForPrice(candle.high) - 23;
        context.fillStyle = guide.type === "buy" ? colors.up : colors.down;
        context.beginPath();
        if (guide.type === "buy") {
          context.moveTo(x, anchor - 8);
          context.lineTo(x - 5, anchor);
          context.lineTo(x + 5, anchor);
        } else {
          context.moveTo(x, anchor + 8);
          context.lineTo(x - 5, anchor);
          context.lineTo(x + 5, anchor);
        }
        context.closePath();
        context.fill();
        context.textAlign = "center";
        context.font = "800 8px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.fillText(guide.type === "buy" ? "B" : "S", x, guide.type === "buy" ? anchor + 10 : anchor - 4);
      }
    }

    context.strokeStyle = colors.grid;
    context.beginPath();
    context.moveTo(left, lowerTop - 18);
    context.lineTo(left + plotWidth, lowerTop - 18);
    context.stroke();
    context.fillStyle = colors.textStrong;
    context.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText(lowerIndicator === "VOL" ? "VOL · MV5 / MV10" : lowerIndicator, left, lowerTop - 24);

    const drawLowerLine = (
      values: Array<number | null>,
      color: string,
      min: number,
      max: number,
      width = 1.15,
    ) => {
      context.beginPath();
      context.strokeStyle = color;
      context.lineWidth = width;
      let started = false;
      for (let index = range.from; index <= range.to; index += 1) {
        const value = values[index];
        if (value === null || !Number.isFinite(value)) continue;
        const x = xFor(globalToLocal(index));
        const y = lowerTop + ((max - value) / Math.max(max - min, 0.000001)) * (lowerBottom - lowerTop);
        if (!started) {
          context.moveTo(x, y);
          started = true;
        } else context.lineTo(x, y);
      }
      context.stroke();
      context.lineWidth = 1;
    };

    if (lowerIndicator === "VOL") {
      const maxVolume = Math.max(...visible.map((candle) => candle.volume), 1);
      visible.forEach((candle, localIndex) => {
        const height = (candle.volume / maxVolume) * (lowerBottom - lowerTop);
        context.fillStyle = candle.close >= candle.open ? "rgba(240,93,94,.72)" : "rgba(36,180,126,.72)";
        context.fillRect(
          xFor(localIndex) - Math.max(1, candleWidth * 0.25),
          lowerBottom - height,
          Math.max(1, candleWidth * 0.5),
          height,
        );
      });
      drawLowerLine(indicators.volumeMa5, colors.ma5, 0, maxVolume, 1.1);
      drawLowerLine(indicators.volumeMa10, colors.ma10, 0, maxVolume, 1.1);
      context.fillStyle = colors.text;
      context.fillText(maxVolume.toLocaleString("zh-CN"), left + plotWidth + 8, lowerTop + 4);
      context.fillText("0", left + plotWidth + 8, lowerBottom + 3);
    } else if (lowerIndicator === "MACD") {
      const values = [
        ...indicators.macdDif.slice(range.from, range.to + 1),
        ...indicators.macdDea.slice(range.from, range.to + 1),
        ...indicators.macdHist.slice(range.from, range.to + 1),
      ];
      const max = Math.max(...values, 0.01);
      const min = Math.min(...values, -0.01);
      const zeroY = lowerTop + (max / (max - min)) * (lowerBottom - lowerTop);
      context.strokeStyle = colors.grid;
      context.beginPath();
      context.moveTo(left, zeroY);
      context.lineTo(left + plotWidth, zeroY);
      context.stroke();
      for (let index = range.from; index <= range.to; index += 1) {
        const value = indicators.macdHist[index];
        const y = lowerTop + ((max - value) / (max - min)) * (lowerBottom - lowerTop);
        context.fillStyle = value >= 0 ? "rgba(240,93,94,.78)" : "rgba(36,180,126,.78)";
        context.fillRect(xFor(globalToLocal(index)) - 1.5, Math.min(y, zeroY), 3, Math.max(1, Math.abs(y - zeroY)));
      }
      drawLowerLine(indicators.macdDif, colors.ma5, min, max);
      drawLowerLine(indicators.macdDea, colors.ma10, min, max);
    } else if (lowerIndicator === "RSI") {
      drawThresholds(context, left, plotWidth, lowerTop, lowerBottom, [30, 70], 0, 100);
      drawLowerLine(indicators.rsi, colors.ma10, 0, 100, 1.4);
      drawLowerAxis(context, left + plotWidth + 8, lowerTop, lowerBottom, [100, 70, 30, 0]);
    } else {
      drawThresholds(context, left, plotWidth, lowerTop, lowerBottom, [20, 80], -20, 120);
      drawLowerLine(indicators.k, colors.ma5, -20, 120);
      drawLowerLine(indicators.d, colors.ma10, -20, 120);
      drawLowerLine(indicators.j, colors.ma20, -20, 120);
      drawLowerAxis(context, left + plotWidth + 8, lowerTop, lowerBottom, [100, 80, 20, 0]);
    }

    context.fillStyle = colors.text;
    context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "center";
    const labelCount = Math.min(6, visible.length);
    for (let step = 0; step < labelCount; step += 1) {
      const localIndex = Math.round((step / Math.max(labelCount - 1, 1)) * (visible.length - 1));
      const candle = visible[localIndex];
      context.fillText(candle.label, xFor(localIndex), size.height - 10);
    }

    const last = visible[visible.length - 1];
    const lastY = yForPrice(last.close);
    context.strokeStyle = last.change >= 0 ? "rgba(240,93,94,.55)" : "rgba(36,180,126,.55)";
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(left, lastY);
    context.lineTo(left + plotWidth, lastY);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = last.change >= 0 ? colors.up : colors.down;
    context.fillRect(left + plotWidth + 4, lastY - 9, 62, 18);
    context.fillStyle = "#071016";
    context.textAlign = "center";
    context.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText(last.close.toFixed(3), left + plotWidth + 35, lastY + 3.5);

    if (hover && hover.index >= range.from && hover.index <= range.to) {
      const localIndex = hover.index - range.from;
      const candle = candles[hover.index];
      const x = xFor(localIndex);
      const y = yForPrice(candle.close);
      context.strokeStyle = "rgba(218,228,239,.45)";
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(x, mainTop);
      context.lineTo(x, lowerBottom);
      context.moveTo(left, y);
      context.lineTo(left + plotWidth, y);
      context.stroke();
      context.setLineDash([]);
    }

    layoutRef.current = { left, plotWidth, candleWidth, from: range.from, to: range.to, mainTop, mainBottom, priceMin, priceMax };
  }, [candles, hover, indicators, lowerIndicator, overlays, range, size, visible]);

  useEffect(() => {
    draw();
  }, [draw]);

  const updateHover = (clientX: number, clientY: number) => {
    const layout = layoutRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!layout || !rect) return;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < layout.left || x > layout.left + layout.plotWidth) {
      setHover(null);
      onHover(null);
      return;
    }
    const localIndex = Math.max(0, Math.min(layout.to - layout.from, Math.floor((x - layout.left) / layout.candleWidth)));
    const index = layout.from + localIndex;
    setHover({ index, x, y });
    onHover(index);
  };

  const shiftRange = (delta: number) => {
    const length = range.to - range.from;
    const from = Math.max(0, Math.min(candles.length - length - 1, range.from + delta));
    onRangeChange({ from, to: from + length });
  };

  return (
    <div className="chart-stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`K线图，共 ${candles.length} 根，当前显示第 ${range.from + 1} 到 ${range.to + 1} 根`}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, from: range.from, to: range.to };
        }}
        onPointerMove={(event) => {
          if (dragRef.current && layoutRef.current) {
            const candleDelta = Math.round((dragRef.current.x - event.clientX) / layoutRef.current.candleWidth);
            const length = dragRef.current.to - dragRef.current.from;
            const from = Math.max(0, Math.min(candles.length - length - 1, dragRef.current.from + candleDelta));
            onRangeChange({ from, to: from + length });
          } else {
            updateHover(event.clientX, event.clientY);
          }
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          updateHover(event.clientX, event.clientY);
        }}
        onPointerLeave={() => {
          if (!dragRef.current) {
            setHover(null);
            onHover(null);
          }
        }}
        onWheel={(event) => {
          event.preventDefault();
          const currentLength = range.to - range.from + 1;
          const nextLength = Math.max(10, Math.min(candles.length, Math.round(currentLength * (event.deltaY > 0 ? 1.16 : 0.86))));
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - 12) / Math.max(rect.width - 84, 1)));
          const anchor = range.from + Math.round(currentLength * ratio);
          let from = anchor - Math.round(nextLength * ratio);
          from = Math.max(0, Math.min(candles.length - nextLength, from));
          onRangeChange({ from, to: from + nextLength - 1 });
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const current = hover?.index ?? range.to;
            const index = Math.max(range.from, Math.min(range.to, current + (event.key === "ArrowRight" ? 1 : -1)));
            setHover({ index, x: 0, y: 0 });
            onHover(index);
          } else if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            const length = Math.max(10, Math.round((range.to - range.from + 1) * 0.8));
            onRangeChange({ from: Math.max(0, range.to - length + 1), to: range.to });
          } else if (event.key === "-") {
            event.preventDefault();
            const length = Math.min(candles.length, Math.round((range.to - range.from + 1) * 1.2));
            onRangeChange({ from: Math.max(0, range.to - length + 1), to: range.to });
          }
        }}
      />
      {hover && candles[hover.index] ? (
        <div
          className="chart-float"
          style={{ left: Math.min(size.width - 170, Math.max(12, hover.x + 14)), top: Math.min(size.height - 92, Math.max(12, hover.y - 28)) }}
        >
          <span>{candles[hover.index].key}</span>
          <strong>{formatNumber(candles[hover.index].close, 3)}</strong>
          {indicators.guidePoints[hover.index] ? <em>{indicators.guidePoints[hover.index]?.type === "buy" ? "B" : "S"}{indicators.guidePoints[hover.index]?.score}</em> : null}
        </div>
      ) : null}
      <div className="chart-hint">滚轮缩放 · 拖拽平移 · ← → 定位</div>
      <button className="chart-nudge chart-nudge-left" type="button" onClick={() => shiftRange(-Math.max(1, Math.round((range.to - range.from) * 0.25)))} aria-label="向前移动图表">
        ‹
      </button>
      <button className="chart-nudge chart-nudge-right" type="button" onClick={() => shiftRange(Math.max(1, Math.round((range.to - range.from) * 0.25)))} aria-label="向后移动图表">
        ›
      </button>
    </div>
  );
}

function drawThresholds(
  context: CanvasRenderingContext2D,
  left: number,
  width: number,
  top: number,
  bottom: number,
  thresholds: number[],
  min: number,
  max: number,
) {
  context.strokeStyle = "rgba(126,143,163,.18)";
  context.setLineDash([3, 4]);
  for (const threshold of thresholds) {
    const y = top + ((max - threshold) / (max - min)) * (bottom - top);
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(left + width, y);
    context.stroke();
  }
  context.setLineDash([]);
}

function drawLowerAxis(
  context: CanvasRenderingContext2D,
  x: number,
  top: number,
  bottom: number,
  values: number[],
) {
  context.fillStyle = colors.text;
  context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "left";
  values.forEach((value, index) => {
    const y = top + (index / Math.max(values.length - 1, 1)) * (bottom - top);
    context.fillText(String(value), x, y + 3);
  });
}
