import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeFinancialRequest,
  parseDividendResponse,
  parseFinancialResponse,
  parseHolderStructureResponse,
  parseValuationResponse,
  toSecuCode,
} from "../app/lib/financials.ts";
import { GET, POST } from "../app/api/local-stock-financials/route.ts";

const responsePayload = {
  success: true,
  result: {
    data: [
      {
        SECUCODE: "000001.SZ",
        SECURITY_NAME_ABBR: "平安银行",
        REPORT_DATE: "2025-06-30 00:00:00",
        REPORT_DATE_NAME: "2025半年报",
        TOTALOPERATEREVE: 69300000000,
      },
      {
        SECUCODE: "000001.SZ",
        SECURITY_NAME_ABBR: "平安银行",
        REPORT_DATE: "2026-03-31 00:00:00",
        REPORT_DATE_NAME: "2026一季报",
        REPORT_TYPE: "一季报",
        NOTICE_DATE: "2026-04-25 00:00:00",
        TOTALOPERATEREVE: 35277000000,
        TOTALOPERATEREVETZ: 4.65,
        PARENTNETPROFIT: 14523000000,
        PARENTNETPROFITTZ: 3.03,
        EPSJB: 0.67,
        BPS: 23.91,
        MGJYXJJE: 1.948,
        ROEJQ: 2.83,
        ZZCJLL: 0.24,
        XSJLL: 41.17,
        ZCFZL: 90.98,
      },
      {
        SECUCODE: "000001.SZ",
        SECURITY_NAME_ABBR: "平安银行",
        REPORT_DATE: "2025-12-31 00:00:00",
        REPORT_DATE_NAME: "2025年报",
        REPORT_TYPE: "年报",
        TOTALOPERATEREVE: 146300000000,
        PARENTNETPROFIT: 49800000000,
      },
      {
        SECUCODE: "000001.SZ",
        SECURITY_NAME_ABBR: "平安银行",
        REPORT_DATE: "2025-09-30 00:00:00",
        REPORT_DATE_NAME: "2025三季报",
        REPORT_TYPE: "三季报",
        TOTALOPERATEREVE: 107700000000,
        PARENTNETPROFIT: 38000000000,
      },
    ],
  },
};

const valuationPayload = {
  success: true,
  result: {
    data: [{
      SECURITY_CODE: "000001",
      SECURITY_NAME_ABBR: "平安银行",
      BOARD_NAME: "银行Ⅱ",
      TRADE_DATE: "2026-07-17 00:00:00",
      CLOSE_PRICE: 10.78,
      TOTAL_MARKET_CAP: 209195798174.44,
      NOTLIMITED_MARKETCAP_A: 209192375039.34,
      TOTAL_SHARES: 19405918198,
      PE_TTM: 4.858,
      PE_LAR: 4.907,
      PB_MRQ: 0.451,
      PCF_OCF_TTM: 1.097,
      PS_TTM: 1.573,
      PEG_CAR: -1.166,
    }],
  },
};

const dividendPayload = {
  success: true,
  result: {
    data: [
      {
        REPORT_DATE: "2025-12-31 00:00:00",
        EX_DIVIDEND_DATE: "2026-06-12 00:00:00",
        PRETAX_BONUS_RMB: 3.6,
        IMPL_PLAN_PROFILE: "10派3.60元(含税)",
      },
      {
        REPORT_DATE: "2025-06-30 00:00:00",
        EX_DIVIDEND_DATE: "2025-10-15 00:00:00",
        PRETAX_BONUS_RMB: 2.36,
        IMPL_PLAN_PROFILE: "10派2.36元(含税)",
      },
      {
        REPORT_DATE: "2024-12-31 00:00:00",
        EX_DIVIDEND_DATE: "2025-06-12 00:00:00",
        PRETAX_BONUS_RMB: 3.62,
        IMPL_PLAN_PROFILE: "10派3.62元(含税)",
      },
    ],
  },
};

const holderPayload = {
  success: true,
  result: {
    data: [
      { END_DATE: "2026-03-31 00:00:00", REPORT_DATE_NAME: "2026一季报", HOLDER_RANK: 1, HOLDER_NAME: "机构甲", HOLD_NUM_ABBR: "机构甲", IS_HOLDORG: "1", FREE_HOLDNUM_RATIO: 30, HOLD_RATIO_CHANGE: 1.2, HOLDER_NEWTYPE: "保险", HOLDER_STATE_NEW: "加仓" },
      { END_DATE: "2026-03-31 00:00:00", REPORT_DATE_NAME: "2026一季报", HOLDER_RANK: 2, HOLDER_NAME: "机构乙", IS_HOLDORG: "1", FREE_HOLDNUM_RATIO: 15, HOLD_RATIO_CHANGE: -0.2, HOLDER_NEWTYPE: "基金", HOLDER_STATE_NEW: "减仓" },
      { END_DATE: "2026-03-31 00:00:00", REPORT_DATE_NAME: "2026一季报", HOLDER_RANK: 3, HOLDER_NAME: "个人甲", IS_HOLDORG: "0", FREE_HOLDNUM_RATIO: 5, HOLDER_TYPE: "个人" },
      { END_DATE: "2025-12-31 00:00:00", REPORT_DATE_NAME: "2025年报", HOLDER_RANK: 1, HOLDER_NAME: "机构甲", IS_HOLDORG: "1", FREE_HOLDNUM_RATIO: 28.5 },
      { END_DATE: "2025-12-31 00:00:00", REPORT_DATE_NAME: "2025年报", HOLDER_RANK: 2, HOLDER_NAME: "机构乙", IS_HOLDORG: "1", FREE_HOLDNUM_RATIO: 14.5 },
    ],
  },
};

test("normalizes A-share financial report stock codes", () => {
  assert.deepEqual(normalizeFinancialRequest({ code: "sz000001" }), { code: "000001" });
  assert.equal(toSecuCode("000001"), "000001.SZ");
  assert.equal(toSecuCode("600519"), "600519.SH");
  assert.throws(() => normalizeFinancialRequest({ code: "PingAn" }), /6 位/);
});

test("parses only the latest three disclosed financial reports", () => {
  const dataset = parseFinancialResponse(responsePayload, "000001");
  assert.equal(dataset.code, "000001");
  assert.equal(dataset.name, "平安银行");
  assert.equal(dataset.reports.length, 3);
  assert.deepEqual(dataset.reports.map((report) => report.periodLabel), ["2026一季报", "2025年报", "2025三季报"]);
  assert.equal(dataset.reports[0].revenue, 35277000000);
  assert.equal(dataset.reports[0].revenueYoY, 4.65);
  assert.equal(dataset.reports[0].noticeDate, "2026-04-25");
  assert.equal(dataset.reports[0].bookValuePerShare, 23.91);
  assert.equal(dataset.reports[0].operatingCashFlowPerShare, 1.948);
  assert.equal(dataset.reports[0].debtAssetRatio, 90.98);
});

test("parses valuation and trailing-12-month cash dividends", () => {
  const snapshot = parseValuationResponse(valuationPayload);
  assert.equal(snapshot.asOfDate, "2026-07-17");
  assert.equal(snapshot.industry, "银行Ⅱ");
  assert.equal(snapshot.peTtm, 4.858);
  assert.equal(snapshot.pb, 0.451);

  const dividend = parseDividendResponse(dividendPayload, snapshot.asOfDate, snapshot.closePrice);
  assert.equal(dividend.dividendPaymentsTtm, 2);
  assert.ok(Math.abs(dividend.cashDividendPerShareTtm - 0.596) < 1e-12);
  assert.ok(Math.abs(dividend.dividendYieldTtm - (0.596 / 10.78) * 100) < 1e-12);
  assert.equal(dividend.latestDividendProfile, "10派3.60元(含税)");
  assert.equal(dividend.latestDividendDate, "2026-06-12");
});

test("builds a disclosed institutional and remaining-float holding proxy", () => {
  const structure = parseHolderStructureResponse(holderPayload);
  assert.equal(structure.asOfDate, "2026-03-31");
  assert.equal(structure.institutionalRatio, 45);
  assert.equal(structure.retailProxyRatio, 55);
  assert.equal(structure.institutionalChangePp, 2);
  assert.equal(structure.institutionCount, 2);
  assert.equal(structure.topInstitutions[0].name, "机构甲");
  assert.match(structure.analysis, /集中度提高/);
});

test("production financial route returns recent reports", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const reportName = url.searchParams.get("reportName");
    if (reportName === "RPT_VALUEANALYSIS_DET") {
      assert.match(url.searchParams.get("columns") ?? "", /PE_TTM/);
      assert.equal(url.searchParams.get("pageSize"), "1250");
    } else {
      assert.equal(url.searchParams.get("columns"), "ALL");
    }
    if (reportName === "RPT_F10_FINANCE_MAINFINADATA") {
      assert.match(url.searchParams.get("filter") ?? "", /000001\.SZ/);
      return new Response(JSON.stringify(responsePayload), { status: 200 });
    }
    assert.match(url.searchParams.get("filter") ?? "", /000001/);
    if (reportName === "RPT_VALUEANALYSIS_DET") {
      return new Response(JSON.stringify(valuationPayload), { status: 200 });
    }
    if (reportName === "RPT_SHAREBONUS_DET") {
      return new Response(JSON.stringify(dividendPayload), { status: 200 });
    }
    if (reportName === "RPT_F10_EH_FREEHOLDERS") {
      assert.equal(url.searchParams.get("sortColumns"), "END_DATE");
      return new Response(JSON.stringify(holderPayload), { status: 200 });
    }
    return new Response(JSON.stringify({ success: false, message: "unexpected report" }), { status: 400 });
  };
  try {
    const response = await POST(new Request("http://localhost/api/local-stock-financials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000001" }),
    }));
    assert.equal(response.status, 200);
    const dataset = await response.json();
    assert.equal(dataset.name, "平安银行");
    assert.equal(dataset.reports.length, 3);
    assert.equal(dataset.snapshot.peTtm, 4.858);
    assert.equal(dataset.snapshot.dividendPaymentsTtm, 2);
    assert.equal(dataset.holderStructure.institutionalRatio, 45);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production financial route rejects unsupported methods", async () => {
  const response = GET();
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "仅支持 POST 请求" });
});
