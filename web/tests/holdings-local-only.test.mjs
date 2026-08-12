import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portfolioSource = readFileSync(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8");
const stockSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const holdingCardSource = readFileSync(new URL("../app/components/HoldingProfitCard.tsx", import.meta.url), "utf8");
const researchStateSource = readFileSync(new URL("../app/api/research-state/route.ts", import.meta.url), "utf8");

test("keeps positions in browser storage and exposes editable CSV import and export", () => {
  assert.match(portfolioSource, /localStorage\.setItem\(holdingsStorageKey/);
  assert.match(portfolioSource, /accept="\.csv,text\/csv"/);
  assert.match(portfolioSource, /parseHoldingsCsv\(await file\.text\(\)\)/);
  assert.match(portfolioSource, /exportHoldingsCsv\(holdings, watchlist\)/);
  assert.match(portfolioSource, /持仓仅保存在当前浏览器/);
  assert.doesNotMatch(portfolioSource, /personalPortfolio/);
  assert.match(holdingCardSource, /仅保存在当前浏览器/);
});

test("does not send positions to or restore positions from cloud research state", () => {
  assert.doesNotMatch(stockSource, /cloudHoldings/);
  assert.doesNotMatch(stockSource, /holdings: Object\.values\(holdings\)/);
  assert.doesNotMatch(researchStateSource, /parseHoldings/);
  assert.match(researchStateSource, /delete state\.holdings/);
  assert.match(researchStateSource, /hasStoredHoldings\(storedState\)[\s\S]*?db\.update\(researchStates\)/);
});
