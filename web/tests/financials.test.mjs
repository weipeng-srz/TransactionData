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
        ORG_TYPE: "银行",
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

const bankStatementDates = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"];
const bankIncomePayload = {
  success: true,
  result: {
    data: bankStatementDates.map((date, index) => ({
      REPORT_DATE: `${date} 00:00:00`,
      REPORT_DATE_NAME: `${date.slice(0, 4)}Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`,
      ORG_TYPE: "银行",
      TOTAL_OPERATE_INCOME: [100, 220, 360, 520, 150][index],
      OPERATE_PROFIT: [12, 30, 55, 88, 26][index],
      PARENT_NETPROFIT: [10, 25, 45, 70, 20][index],
      DEDUCT_PARENT_NETPROFIT: [8, 20, 37, 60, 18][index],
    })),
  },
};
const bankBalancePayload = {
  success: true,
  result: {
    data: bankStatementDates.map((date, index) => ({
      REPORT_DATE: `${date} 00:00:00`,
      TOTAL_ASSETS: [300, 320, 340, 370, 430][index],
      TOTAL_LIABILITIES: [250, 268, 286, 310, 360][index],
      TOTAL_PARENT_EQUITY: [50, 52, 54, 60, 70][index],
      BOND_PAYABLE: [20, 21, 22, 25, 30][index],
    })),
  },
};
const bankCashflowPayload = {
  success: true,
  result: {
    data: bankStatementDates.map((date, index) => ({
      REPORT_DATE: `${date} 00:00:00`,
      NETCASH_OPERATE: [5, 18, 36, 80, 25][index],
      NETCASH_INVEST: [-4, -9, -16, -25, -7][index],
      NETCASH_FINANCE: [8, 12, 20, 30, 10][index],
      CONSTRUCT_LONG_ASSET: [2, 5, 9, 14, 4][index],
    })),
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
    if (reportName === "RPT_F10_FINANCE_GINCOME") {
      return new Response(JSON.stringify(bankIncomePayload), { status: 200 });
    }
    if (reportName === "RPT_F10_FINANCE_GBALANCE" || reportName === "RPT_F10_FINANCE_GCASHFLOW") {
      return new Response(JSON.stringify({ success: false, message: "返回数据为空" }), { status: 200 });
    }
    if (reportName === "RPT_F10_FINANCE_BBALANCE") {
      return new Response(JSON.stringify(bankBalancePayload), { status: 200 });
    }
    if (reportName === "RPT_F10_FINANCE_BCASHFLOW") {
      return new Response(JSON.stringify(bankCashflowPayload), { status: 200 });
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
    assert.equal(dataset.analysis.periods.length, 5);
    assert.equal(dataset.analysis.latestReportDate, "2026-03-31");
    assert.equal(dataset.analysis.periods[0].balance.totalAssets, 430);
    assert.equal(dataset.analysis.periods[0].cumulative.operatingCashFlow, 25);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production financial route rejects unsupported methods", async () => {
  const response = GET();
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "仅支持 POST 请求" });
});
