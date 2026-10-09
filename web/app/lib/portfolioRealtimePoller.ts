import type { RealtimeSnapshot } from "./realtimeMarket.ts";
import { marketOf } from "./security.ts";
import type { WatchlistStock } from "./watchlist.ts";

type QuoteHandlers = {
  onQuote: (stock: WatchlistStock, snapshot: RealtimeSnapshot) => void;
  onError: (stock: WatchlistStock) => void;
};

export function createPortfolioRealtimePoller({
  fetchImpl = fetch,
  timeoutMs = 25_000,
}: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  let activeController: AbortController | null = null;

  return {
    async refresh(stocks: WatchlistStock[], handlers: QuoteHandlers): Promise<void> {
      // A slow quote must survive the next polling tick; each quote can settle independently.
      if (activeController || stocks.length === 0) return;
      const controller = new AbortController();
      activeController = controller;
      try {
        await Promise.allSettled(stocks.map(async (stock) => {
          const requestController = new AbortController();
          const cancelRequest = () => requestController.abort();
          controller.signal.addEventListener("abort", cancelRequest, { once: true });
          const timeout = setTimeout(cancelRequest, timeoutMs);
          try {
            const response = await fetchImpl(marketOf(stock) === "US" ? "/api/us-stock-realtime" : "/api/realtime-market", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: stock.code }),
              cache: "no-store",
              signal: requestController.signal,
            });
            const body = await response.json() as RealtimeSnapshot | { error?: unknown };
            if (!response.ok) throw new Error(String((body as { error?: unknown }).error || "实时行情获取失败"));
            const snapshot = body as RealtimeSnapshot;
            if (snapshot.code !== stock.code) throw new Error("实时行情股票代码不匹配");
            if (!controller.signal.aborted && !requestController.signal.aborted) handlers.onQuote(stock, snapshot);
          } catch {
            if (!controller.signal.aborted) handlers.onError(stock);
          } finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", cancelRequest);
          }
        }));
      } finally {
        if (activeController === controller) activeController = null;
      }
    },
    abort() {
      const controller = activeController;
      activeController = null;
      controller?.abort();
    },
  };
}
