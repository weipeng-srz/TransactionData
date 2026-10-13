import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portfolioSource = readFileSync(new URL("../app/components/PortfolioHome.tsx", import.meta.url), "utf8");
const stockSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const holdingCardSource = readFileSync(new URL("../app/components/HoldingProfitCard.tsx", import.meta.url), "utf8");
const researchStateSource = readFileSync(new URL("../app/api/research-state/route.ts", import.meta.url), "utf8");

test("persists positions through account storage and keeps CSV import and export", () => {
  assert.match(portfolioSource, /accountStorage\.setItem\(holdingsStorageKey/);
  assert.match(portfolioSource, /accept="\.csv,text\/csv"/);
  assert.match(portfolioSource, /parseHoldingsCsv\(await file\.text\(\)\)/);
  assert.match(portfolioSource, /exportHoldingsCsv\(holdings, watchlist\)/);
  assert.match(portfolioSource, /账户|数据库/);
  assert.doesNotMatch(portfolioSource, /personalPortfolio/);
  assert.match(holdingCardSource, /持仓按账户同步至数据库/);
});

test("legacy research state stays separate from the account-data holdings store", () => {
  assert.doesNotMatch(stockSource, /cloudHoldings/);
  assert.doesNotMatch(stockSource, /holdings: Object\.values\(holdings\)/);
  assert.doesNotMatch(researchStateSource, /parseHoldings/);
  assert.match(researchStateSource, /delete state\.holdings/);
  assert.match(researchStateSource, /hasStoredHoldings\(storedState\)[\s\S]*?db\.update\(researchStates\)/);
});
