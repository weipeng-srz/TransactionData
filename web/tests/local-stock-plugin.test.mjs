import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRemoteMarketRequest } from "../app/lib/remoteMarket.ts";
import { normalizeRemoteNewsRequest } from "../app/lib/remoteNews.ts";
import {
  normalizeStockLookupRequest,
  parseStockLookupResponse,
  pickStockLookupResult,
} from "../app/lib/stockLookup.ts";

test("normalizes supported local stock requests", () => {
  assert.deepEqual(normalizeRemoteMarketRequest({ code: " 002747 ", days: 90 }), { code: "002747", days: 90, kind: "stock" });
  assert.deepEqual(normalizeRemoteMarketRequest({ code: "sh600000" }), { code: "600000", days: 250, kind: "stock" });
  assert.deepEqual(normalizeRemoteMarketRequest({ code: "000001.SZ", days: 20, kind: "index" }), { code: "000001", days: 20, kind: "index" });
});

test("rejects invalid codes and unsafe arguments", () => {
  assert.throws(() => normalizeRemoteMarketRequest({ code: "002747;rm -rf /" }), /6 位沪深代码/);
  assert.throws(() => normalizeRemoteMarketRequest({ code: "12345" }), /6 位沪深代码/);
  assert.throws(() => normalizeRemoteMarketRequest({ code: "002747", days: 19 }), /20 到 1250/);
});

test("normalizes stock news requests", () => {
  assert.deepEqual(normalizeRemoteNewsRequest({ code: " 600000 ", limit: 30 }), { code: "600000", limit: 30 });
  assert.deepEqual(normalizeRemoteNewsRequest({ code: "000001.SZ" }), { code: "000001", limit: 30 });
  assert.throws(() => normalizeRemoteNewsRequest({ code: "600000", limit: 101 }), /1 到 100/);
});

test("normalizes stock name lookup requests", () => {
  assert.deepEqual(normalizeStockLookupRequest({ query: " 平安银行 " }), { query: "平安银行" });
  assert.throws(() => normalizeStockLookupRequest({ query: "" }), /股票代码或名称/);
  assert.throws(() => normalizeStockLookupRequest({ query: "a".repeat(41) }), /格式无效/);
});

test("prefers an exact Shanghai or Shenzhen A-share name match", () => {
  const payload = {
    QuotationCodeTable: {
      Data: [
        { Code: "000001", Name: "上证指数", Classify: "Index", QuoteID: "1.000001" },
        { Code: "000001", Name: "平安银行", Classify: "AStock", QuoteID: "0.000001" },
        { Code: "920001", Name: "北交示例", Classify: "AStock", QuoteID: "2.920001" },
      ],
    },
  };
  assert.deepEqual(pickStockLookupResult(payload, "平安 银行"), { code: "000001", name: "平安银行" });
  assert.throws(() => pickStockLookupResult({ QuotationCodeTable: { Data: [] } }, "不存在"), /没有找到/);
});

test("parses both JSON and JSONP stock lookup responses", () => {
  const payload = {
    QuotationCodeTable: {
      Data: [{ Code: "600519", Name: "贵州茅台", Classify: "AStock", QuoteID: "1.600519" }],
    },
  };
  const json = JSON.stringify(payload);
  assert.deepEqual(parseStockLookupResponse(json, "贵州茅台"), { code: "600519", name: "贵州茅台" });
  assert.deepEqual(parseStockLookupResponse(`ticklensLookup(${json})`, "贵州茅台"), { code: "600519", name: "贵州茅台" });
  assert.throws(() => parseStockLookupResponse("<html>blocked</html>", "贵州茅台"), /异常页面/);
});
