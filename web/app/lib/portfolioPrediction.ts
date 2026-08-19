import type { NextDayPredictionReport } from "./nextDayPrediction.ts";

export type PortfolioPredictionAction = "持有" | "减仓" | "止盈" | "止损";

export type PortfolioPredictionConclusion = {
  action: PortfolioPredictionAction;
  tone: "hold" | "reduce" | "takeProfit" | "stopLoss";
  mark: string;
};

export function buildPortfolioPredictionConclusion(
  report: NextDayPredictionReport,
): PortfolioPredictionConclusion {
  switch (report.decisionSupport.action) {
    case "分批止盈":
      return { action: "止盈", tone: "takeProfit", mark: "盈" };
    case "收紧止损":
      return { action: "止损", tone: "stopLoss", mark: "损" };
    case "降低仓位":
      return { action: "减仓", tone: "reduce", mark: "减" };
    case "持有观察":
    case "等待确认":
    default:
      return { action: "持有", tone: "hold", mark: "持" };
  }
}
