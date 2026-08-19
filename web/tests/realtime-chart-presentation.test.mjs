import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const realtimeSource = readFileSync(new URL("../app/components/RealtimeTradingPanel.tsx", import.meta.url), "utf8");
const appleStyles = readFileSync(new URL("../app/apple.css", import.meta.url), "utf8");
const refinementStyles = readFileSync(new URL("../app/apple-refinement.css", import.meta.url), "utf8");

test("moves the latest quote into the minute K-line without duplicating the old quote tile", () => {
  const quoteStripStart = realtimeSource.indexOf('<div className="realtime-quote-strip">');
  const signalBarStart = realtimeSource.indexOf("realtime-signal-bar", quoteStripStart);
  const quoteStrip = realtimeSource.slice(quoteStripStart, signalBarStart);

  assert.ok(quoteStripStart >= 0);
  assert.ok(signalBarStart > quoteStripStart);
  assert.doesNotMatch(quoteStrip, />最新</);
  assert.match(quoteStrip, /label="今开"/);
  assert.match(quoteStrip, /label="成交额"/);
  assert.match(realtimeSource, /quote=\{\{[\s\S]*?price: snapshot\.price,[\s\S]*?change: snapshot\.change,[\s\S]*?changePct: snapshot\.changePct/);
  assert.match(realtimeSource, /className="realtime-chart-quote"[\s\S]*?最新价 \$\{quote\.price\.toFixed\(3\)\}/);
  assert.match(realtimeSource, /className=\{quoteDirection\}>\{quote\.price\.toFixed\(3\)\}<\/strong>/);
  assert.match(realtimeSource, /quote\.change\.toFixed\(3\)[\s\S]*?quote\.changePct\.toFixed\(2\)/);
  assert.match(realtimeSource, /aria-label=\{`当前交易日1分钟K线，最新价\$\{quote\.price\.toFixed\(3\)\}，涨跌幅/);
});

test("draws the live price guide inside the plot and keeps narrow canvases contained", () => {
  assert.match(realtimeSource, /calculatePlot\(visibleCandles, previousClose, quote\.price, size\)/);
  assert.match(realtimeSource, /Math\.min\(previousClose, currentPrice,/);
  assert.match(realtimeSource, /context\.moveTo\(left, quoteY\)[\s\S]*?context\.lineTo\(plotRight, quoteY\)/);
  assert.match(realtimeSource, /context\.fillText\(quote\.price\.toFixed\(3\)/);
  assert.match(realtimeSource, /context\.fillText\(`\$\{quote\.changePct > 0 \? "\+" : ""\}\$\{quote\.changePct\.toFixed\(2\)\}%`/);
  assert.match(realtimeSource, /width: Math\.max\(1, entry\.contentRect\.width\)/);
  assert.doesNotMatch(realtimeSource, /width: Math\.max\(320, entry\.contentRect\.width\)/);
});

test("reserves a larger responsive chart surface and prevents quote-control collisions", () => {
  assert.match(appleStyles, /\.realtime-canvas-wrap \{[\s\S]*?min-height: 410px;[\s\S]*?height: clamp\(410px, 34vw, 480px\);/);
  assert.match(appleStyles, /\.realtime-chart-quote \{[\s\S]*?max-width: 140px;[\s\S]*?pointer-events: none;/);
  assert.match(refinementStyles, /\.realtime-quote-strip \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);[\s\S]*?overflow: hidden;/);
  assert.match(refinementStyles, /height: clamp\(430px, 60vw, 480px\);\s+min-height: 430px;/);
  assert.match(refinementStyles, /@media \(max-width: 380px\)[\s\S]*?height: 460px;[\s\S]*?\.realtime-canvas-wrap \.realtime-kline-controls \{[\s\S]*?top: 84px;/);
  assert.match(refinementStyles, /@media \(min-width: 821px\) and \(max-width: 1024px\)[\s\S]*?\.realtime-layout \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
});
