export type KlineRange = { from: number; to: number };

export function klineRangeLength(range: KlineRange): number {
  return Math.max(0, range.to - range.from + 1);
}

export function rangeForLatest(total: number, visibleCount: number): KlineRange {
  if (total <= 0) return { from: 0, to: 0 };
  const length = Math.max(1, Math.min(total, Math.round(visibleCount)));
  return { from: total - length, to: total - 1 };
}

export function normalizeKlineRange(range: KlineRange, total: number): KlineRange {
  if (total <= 0) return { from: 0, to: 0 };
  const from = Math.max(0, Math.min(total - 1, Math.round(range.from)));
  const to = Math.max(from, Math.min(total - 1, Math.round(range.to)));
  return { from, to };
}

export function normalizeWheelDelta(deltaY: number, deltaMode: number, viewportHeight = 800): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * Math.max(1, viewportHeight);
  return deltaY;
}

export function panKlineRange(range: KlineRange, total: number, deltaCandles: number): KlineRange {
  const normalized = normalizeKlineRange(range, total);
  if (total <= 0) return normalized;
  const length = klineRangeLength(normalized);
  const from = Math.max(0, Math.min(total - length, normalized.from + Math.round(deltaCandles)));
  return { from, to: from + length - 1 };
}

export function zoomKlineRange({
  range,
  total,
  deltaY,
  anchorRatio,
  minVisible = 10,
  maxVisible = total,
}: {
  range: KlineRange;
  total: number;
  deltaY: number;
  anchorRatio: number;
  minVisible?: number;
  maxVisible?: number;
}): KlineRange {
  const normalized = normalizeKlineRange(range, total);
  if (total <= 0 || deltaY === 0) return normalized;
  const currentLength = klineRangeLength(normalized);
  const minimum = Math.max(1, Math.min(total, Math.round(minVisible)));
  const maximum = Math.max(minimum, Math.min(total, Math.round(maxVisible)));
  const boundedDelta = Math.max(-240, Math.min(240, deltaY));
  let nextLength = Math.round(currentLength * Math.exp(boundedDelta * .0026));
  if (nextLength === currentLength) nextLength += deltaY > 0 ? 1 : -1;
  nextLength = Math.max(minimum, Math.min(maximum, nextLength));
  if (nextLength === currentLength) return normalized;

  const ratio = Math.max(0, Math.min(1, anchorRatio));
  const anchorIndex = normalized.from + ratio * Math.max(0, currentLength - 1);
  let from = Math.round(anchorIndex - ratio * Math.max(0, nextLength - 1));
  from = Math.max(0, Math.min(total - nextLength, from));
  return { from, to: from + nextLength - 1 };
}
