export function reportTelemetry(event: string, durationMs = 0): void {
  try {
    const body = JSON.stringify({ event, durationMs: Math.max(0, Math.round(durationMs)) });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/telemetry", new Blob([body], { type: "application/json" }));
    else void fetch("/api/telemetry", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  } catch { /* metrics must never affect research work */ }
}
