export function plotIndexFromPointer({
  pointerX,
  containerWidth,
  viewBoxWidth,
  plotLeft,
  plotWidth,
  pointCount,
}: {
  pointerX: number;
  containerWidth: number;
  viewBoxWidth: number;
  plotLeft: number;
  plotWidth: number;
  pointCount: number;
}): number {
  if (pointCount <= 1 || containerWidth <= 0 || viewBoxWidth <= 0 || plotWidth <= 0) return 0;
  const clampedPointer = Math.max(0, Math.min(containerWidth, pointerX));
  const viewBoxX = (clampedPointer / containerWidth) * viewBoxWidth;
  const plotX = Math.max(0, Math.min(plotWidth - Number.EPSILON, viewBoxX - plotLeft));
  return Math.max(0, Math.min(pointCount - 1, Math.floor((plotX / plotWidth) * pointCount)));
}
