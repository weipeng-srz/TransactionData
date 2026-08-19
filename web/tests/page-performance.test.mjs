import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const appleStyles = read("../app/apple-refinement.css");
const portfolioStyles = read("../app/components/PortfolioHome.module.css");
const financialDashboard = read("../app/components/FinancialDashboard.tsx");
const nextDayCard = read("../app/components/NextDayPredictionCard.tsx");
const marketChart = read("../app/components/MarketChart.tsx");

test("skips offscreen research sections and long watchlist rows", () => {
  assert.match(appleStyles, /\.research-page \.workspace-grid \{[\s\S]*?content-visibility: auto;[\s\S]*?contain-intrinsic-size: auto 2500px;/);
  assert.match(appleStyles, /\.research-page \.next-day-card \{[\s\S]*?content-visibility: auto;/);
  assert.match(portfolioStyles, /\.stockRow \{[\s\S]*?content-visibility: auto;[\s\S]*?contain-intrinsic-size: auto 116px;/);
});

test("keeps large scrolling cards off the live backdrop compositor", () => {
  assert.match(appleStyles, /@media \(min-width: 1181px\)[\s\S]*?\.research-page \.chart-card,[\s\S]*?\.research-page \.news-card \{[\s\S]*?backdrop-filter: none;/);
});

test("mounts dense financial and prediction evidence only when requested", () => {
  assert.match(financialDashboard, /detailExpanded \? \([\s\S]*?id="finance-detail-content"/);
  assert.match(financialDashboard, /export default memo\(FinancialDashboard\);/);
  assert.match(nextDayCard, /evidenceExpanded \? <section[\s\S]*?id="next-day-evidence"/);
  assert.match(nextDayCard, /\{evidenceExpanded \? <>[\s\S]*?next-day-similar-table/);
  assert.match(marketChart, /export default memo\(MarketChart, marketChartPropsEqual\);/);
});
