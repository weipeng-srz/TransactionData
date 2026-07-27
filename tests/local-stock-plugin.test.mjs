import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeNewsRequest,
  normalizeStockLookupRequest,
  normalizeStockRequest,
  parseStockLookupResponse,
  pickStockLookupResult,
} from "../build/local-stock-data-plugin.ts";

test("normalizes supported local stock requests", () => {
  assert.deepEqual(normalizeStockRequest({ code: " 002747 ", days: 90 }), { code: "002747", days: 90 });
  assert.deepEqual(normalizeStockRequest({ code: "sh600000" }), { code: "sh600000", days: 90 });
  assert.deepEqual(normalizeStockRequest({ code: "000001.SZ", days: 1 }), { code: "000001.SZ", days: 1 });
});

test("rejects invalid codes and unsafe arguments", () => {
  assert.throws(() => normalizeStockRequest({ code: "002747;rm -rf /" }), /6位沪深股票代码/);
  assert.throws(() => normalizeStockRequest({ code: "12345" }), /6位沪深股票代码/);
  assert.throws(() => normalizeStockRequest({ code: "002747", days: 251 }), /1到250/);
});

test("normalizes stock news requests", () => {
  assert.deepEqual(normalizeNewsRequest({ code: " 600000 ", limit: 30 }), { code: "600000", limit: 30 });
  assert.deepEqual(normalizeNewsRequest({ code: "000001.SZ" }), { code: "000001.SZ", limit: 30 });
  assert.throws(() => normalizeNewsRequest({ code: "600000", limit: 101 }), /1到100/);
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
