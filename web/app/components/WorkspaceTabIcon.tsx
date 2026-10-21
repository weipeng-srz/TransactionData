import type { ReactNode } from "react";

// Semantic icons shared by every workspace, including its nested views.
const icons: Record<string, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  watchlist: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" />,
  holdings: <><rect x="3" y="7" width="18" height="14" rx="3" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a24 24 0 0 0 18 0M12 11v4" /></>,
  earnings: <><path d="M4 20V4M4 20h16M8 16v-4m5 4V8m5 8V5" /><path d="m7 7 5-4 5 1" /></>,
  review: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6m-14-11 2 2 4-4" /></>,
  market: <><path d="M6 3v18M18 3v18M12 5v14" /><rect x="3" y="7" width="6" height="7" rx="1" /><rect x="15" y="10" width="6" height="7" rx="1" /></>,
  financials: <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7" />,
  news: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h4v4H7zM15 8h2m-2 4h2M7 16h10" /></>,
  models: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
  notes: <path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M9 15l1-4L18 3l3 3-8 8Z" />,
  summary: <path d="M4 20V10m8 10V4m8 16v-7M2 10h4m4-6h4m4 9h4" />,
  trends: <path d="M3 17 9 11l4 4 8-11M15 4h6v6" />,
  details: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 12h8M8 17h5" /></>,
  regions: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  trend: <path d="M3 17 9 11l4 4 8-11M15 4h6v6" />,
  map: <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16M15 5v16" />,
  journal: <path d="M5 3h13a2 2 0 0 1 2 2v16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 3v18M11 8h5M11 12h5" />,
  strategies: <><path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h4m4 0h10" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="9" cy="18" r="2" /></>,
  rules: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m7 8 1 1 2-2m-3 8 1 1 2-2m3-6h4m-4 7h4" /></>,
  insights: <path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 .8-1 2-1 2H9s0-1.2-1-2Z" />,
  candidates: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6M7 10h6M10 7v6" /></>,
  pool: <path d="M4 7h16v13H4ZM3 3h18v4H3ZM9 11h6" />,
  evidence: <path d="M14 3H5v18h14v-8M9 8h2M9 12h2M9 16h6m-2-9 2 2 6-6" />,
};

export function WorkspaceTabIcon({ name, className }: { name: string; className?: string }) {
  return <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{icons[name] ?? icons.overview}</svg>;
}
