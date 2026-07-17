"use client";

import { useEffect, useRef } from "react";

export type FinancialChartSeries = {
  key: string;
  label: string;
  values: Array<number | null>;
  color: string;
  kind: "bar" | "line";
  axis?: "left" | "right";
  dashed?: boolean;
};

export default function FinancialChart({
  labels,
  series,
  leftUnit = "元",
  rightUnit = "%",
  height = 230,
  ariaLabel,
}: {
  labels: string[];
  series: FinancialChartSeries[];
  leftUnit?: string;
  rightUnit?: string;
  height?: number;
  ariaLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => drawChart(canvas, labels, series, leftUnit, rightUnit, height);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [labels, series, leftUnit, rightUnit, height]);

  return (
    <div className="financial-chart-shell">
      <div className="financial-chart-legend" aria-hidden="true">
        {series.map((item) => (
          <span key={item.key}>
            <i
              className={item.kind === "line" ? "is-line" : "is-bar"}
              style={{ backgroundColor: item.kind === "bar" ? item.color : "transparent", borderColor: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>
      <canvas ref={canvasRef} style={{ height }} role="img" aria-label={ariaLabel} />
    </div>
  );
}

function drawChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  series: FinancialChartSeries[],
  leftUnit: string,
  rightUnit: string,
  height: number,
) {
  const width = Math.max(320, canvas.clientWidth || 320);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const hasRightAxis = series.some((item) => (item.axis ?? "left") === "right");
  const margin = { top: 12, right: hasRightAxis ? 48 : 14, bottom: 32, left: 52 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const leftRange = rangeFor(series.filter((item) => (item.axis ?? "left") === "left"));
  const rightRange = rangeFor(series.filter((item) => item.axis === "right"));
  const y = (value: number, axis: "left" | "right") => {
    const range = axis === "right" ? rightRange : leftRange;
    return margin.top + ((range.max - value) / (range.max - range.min)) * plotHeight;
  };
  const slotWidth = plotWidth / Math.max(1, labels.length);
  const x = (index: number) => margin.left + slotWidth * (index + 0.5);

  context.font = '9px "SFMono-Regular", Menlo, monospace';
  context.textBaseline = "middle";
  for (let tick = 0; tick <= 4; tick += 1) {
    const ratio = tick / 4;
    const gridY = margin.top + ratio * plotHeight;
    context.strokeStyle = "rgba(137, 158, 181, 0.13)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(margin.left, gridY);
    context.lineTo(width - margin.right, gridY);
    context.stroke();
    context.fillStyle = "#637384";
    context.textAlign = "right";
    context.fillText(formatAxis(leftRange.max - ratio * (leftRange.max - leftRange.min), leftUnit), margin.left - 7, gridY);
    if (hasRightAxis) {
      context.textAlign = "left";
      context.fillText(formatAxis(rightRange.max - ratio * (rightRange.max - rightRange.min), rightUnit), width - margin.right + 7, gridY);
    }
  }

  const barSeries = series.filter((item) => item.kind === "bar");
  const barGroupWidth = Math.min(slotWidth * 0.68, 54);
  const barWidth = Math.max(3, barGroupWidth / Math.max(1, barSeries.length) - 2);
  barSeries.forEach((item, seriesIndex) => {
    const axis = item.axis ?? "left";
    const zeroY = y(0, axis);
    item.values.forEach((value, index) => {
      if (value == null || !Number.isFinite(value)) return;
      const valueY = y(value, axis);
      const left = x(index) - barGroupWidth / 2 + seriesIndex * (barWidth + 2) + 1;
      context.fillStyle = item.color;
      context.strokeStyle = colorWithAlpha(item.color, 0.9);
      context.lineWidth = 1;
      context.beginPath();
      context.rect(left, Math.min(zeroY, valueY), barWidth, Math.max(1, Math.abs(zeroY - valueY)));
      context.fill();
      context.stroke();
    });
  });

  series.filter((item) => item.kind === "line").forEach((item) => {
    const axis = item.axis ?? "left";
    context.strokeStyle = item.color;
    context.lineWidth = 1.8;
    context.setLineDash(item.dashed ? [5, 4] : []);
    context.beginPath();
    let started = false;
    item.values.forEach((value, index) => {
      if (value == null || !Number.isFinite(value)) {
        started = false;
        return;
      }
      if (!started) context.moveTo(x(index), y(value, axis));
      else context.lineTo(x(index), y(value, axis));
      started = true;
    });
    context.stroke();
    context.setLineDash([]);
    item.values.forEach((value, index) => {
      if (value == null || !Number.isFinite(value)) return;
      context.fillStyle = "#0b151d";
      context.strokeStyle = item.color;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(x(index), y(value, axis), 2.8, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });
  });

  context.fillStyle = "#637384";
  context.textAlign = "center";
  context.textBaseline = "top";
  const labelStep = width < 560 && labels.length > 8 ? 2 : 1;
  labels.forEach((label, index) => {
    if (index % labelStep !== 0 && index !== labels.length - 1) return;
    context.fillText(label, x(index), height - margin.bottom + 10);
  });
}

function rangeFor(series: FinancialChartSeries[]) {
  const values = series.flatMap((item) => item.values.filter((value): value is number => value != null && Number.isFinite(value)));
  if (!values.length) return { min: 0, max: 1 };
  const hasBars = series.some((item) => item.kind === "bar");
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (hasBars) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    const padding = Math.abs(min || 1) * 0.12;
    min -= padding;
    max += padding;
  } else {
    const padding = (max - min) * 0.1;
    if (!hasBars || min < 0) min -= padding;
    if (!hasBars || max > 0) max += padding;
  }
  return { min, max };
}

function formatAxis(value: number, unit: string): string {
  if (unit === "%") return `${formatCompact(value)}%`;
  if (unit === "指数") return formatCompact(value);
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) return `${formatCompact(value / 100_000_000)}亿`;
  if (absolute >= 10_000) return `${formatCompact(value / 10_000)}万`;
  return formatCompact(value);
}

function formatCompact(value: number): string {
  const absolute = Math.abs(value);
  const digits = absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/, "");
}

function colorWithAlpha(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return color;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
