/** URL-only UI navigation; never serializes portfolio or research data. */
export const workspaceNavigationEvent = "trendsight:workspace-navigation";

export function workspaceAnchor(hash: string): string {
  try { return decodeURIComponent(hash.slice(1)); } catch { return ""; }
}

export function workspaceView<T extends string>(url: URL, values: readonly T[], fallback: T, parameter = "view", anchors: Readonly<Record<string, T>> = {}): T {
  const anchor = workspaceAnchor(url.hash);
  const anchored = anchors[anchor] ?? (anchor.startsWith("finance-") ? anchors["finance-*"] : undefined);
  if (anchored && values.includes(anchored)) return anchored;
  const requested = url.searchParams.get(parameter);
  return values.includes(requested as T) ? requested as T : fallback;
}

export function workspaceViewUrl(url: URL, parameter: string, view: string, context: Readonly<Record<string, string>> = {}): URL {
  const next = new URL(url);
  for (const [key, value] of Object.entries(context)) next.searchParams.set(key, value);
  next.searchParams.set(parameter, view);
  next.hash = "";
  return next;
}
