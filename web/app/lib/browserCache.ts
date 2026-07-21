type CachedText = { text: string; cachedAt: string };

export async function readCachedText(namespace: string, payload: unknown, maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<CachedText | null> {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open("ticklens-research-v2");
    const response = await cache.match(cacheRequest(namespace, payload));
    if (!response) return null;
    const cachedAt = response.headers.get("X-TickLens-Cached-At") ?? "";
    if (!cachedAt || Date.now() - Date.parse(cachedAt) > maxAgeMs) return null;
    return { text: await response.text(), cachedAt };
  } catch { return null; }
}

export async function writeCachedText(namespace: string, payload: unknown, text: string): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open("ticklens-research-v2");
    await cache.put(cacheRequest(namespace, payload), new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-TickLens-Cached-At": new Date().toISOString() } }));
  } catch { /* cache is an optional resilience layer */ }
}

function cacheRequest(namespace: string, payload: unknown): Request {
  const stable = JSON.stringify(payload, Object.keys((payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>).sort());
  let hash = 2166136261;
  for (let index = 0; index < stable.length; index += 1) hash = Math.imul(hash ^ stable.charCodeAt(index), 16777619);
  return new Request(`${location.origin}/__ticklens_cache__/${encodeURIComponent(namespace)}/${(hash >>> 0).toString(36)}`);
}
