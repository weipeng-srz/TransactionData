import { workspaceView } from "./workspaceNavigation.ts";

export const financialViews = ["summary", "trends", "details"] as const;
export const financialAnchors = { "finance-valuation": "summary", "finance-detail": "details", "finance-conclusion": "details", "finance-*": "trends" } as const;
export const financialContext = { tab: "financials" };

export function financialWorkspaceView(url: URL) {
  return workspaceView(url, financialViews, "summary", "finance", financialAnchors);
}
