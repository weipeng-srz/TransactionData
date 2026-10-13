"use client";

import type { ReactNode } from "react";
import styles from "./WorkspaceTabs.module.css";

export type WorkspaceTab<T extends string> = { id: T; label: string; count?: number; panel?: string };

export function WorkspaceTabs<T extends string>({ label, id, tabs, value, onChange, sticky = true }: {
  label: string; id: string; sticky?: boolean; tabs: readonly WorkspaceTab<T>[]; value: T; onChange: (value: T) => void;
}) {
  return <nav className={`${styles.navigation} ${sticky ? "" : styles.inline}`} aria-label={label}>
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => <button type="button" role="tab" key={tab.id} id={`${id}-tab-${tab.id}`} aria-selected={value === tab.id} aria-controls={`${id}-panel-${tab.panel ?? tab.id}`} tabIndex={value === tab.id ? 0 : -1} onClick={() => onChange(tab.id)} onKeyDown={(event) => {
        const target = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
        if (target < 0) return;
        event.preventDefault();
        onChange(tabs[target].id);
        document.getElementById(`${id}-tab-${tabs[target].id}`)?.focus();
      }}>{tab.label}{tab.count !== undefined ? <span>{tab.count}</span> : null}</button>)}
    </div>
  </nav>;
}

/** Keep descendants mounted: UI navigation must not reset collectors, charts or drafts. */
export function WorkspacePanel({ id, view, active, children, panel, className = "" }: {
  id: string; view: string; active: string; children: ReactNode; panel?: string; className?: string;
}) {
  return <div id={`${id}-panel-${panel ?? view}`} role="tabpanel" aria-labelledby={`${id}-tab-${view}`} hidden={active !== view} className={`${styles.panel} ${className}`} tabIndex={0}>{children}</div>;
}
