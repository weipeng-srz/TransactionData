export type ViewMode = "basic" | "pro";

export function resolveStoredViewMode(value: string | null): ViewMode {
  return value === "pro" ? "pro" : "basic";
}
