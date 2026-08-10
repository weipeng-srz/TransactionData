import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const portfolioSource = await readFile(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("watchlist polls stock quotes and global market pulse", () => {
  assert.match(portfolioSource, /setInterval\(\(\) => void refreshRealtimeQuotes\(\), 5_000\)/);
  assert.match(portfolioSource, /fetch\("\/api\/global-indexes"/);
  assert.match(portfolioSource, /setInterval\(\(\) => void loadGlobalFeed\(true\), 10_000\)/);
  for (const id of ["shanghai", "chinext", "nasdaq", "a-share-fear", "us-vix"]) {
    assert.match(portfolioSource, new RegExp(`id === "${id}"`));
  }
});

test("stock route hides demo data behind requested-symbol loading state", () => {
  assert.match(pageSource, /<StockAnalysisPage[^>]*initialStockCode=\{analysisCode\}/);
  assert.match(pageSource, /useState\(initialStockCode\)/);
  assert.match(pageSource, /initialRouteState !== "ready"/);
  const loadingComponent = pageSource.slice(
    pageSource.indexOf("function StockInitialLoading"),
    pageSource.indexOf("function LoadBadge"),
  );
  assert.match(loadingComponent, /正在加载 \$\{code\}/);
  assert.doesNotMatch(loadingComponent, /平安银行|000001/);
});
