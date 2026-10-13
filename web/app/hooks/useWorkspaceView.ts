"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { workspaceAnchor, workspaceNavigationEvent, workspaceView, workspaceViewUrl } from "../lib/workspaceNavigation";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener("hashchange", listener);
  window.addEventListener(workspaceNavigationEvent, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener("hashchange", listener);
    window.removeEventListener(workspaceNavigationEvent, listener);
  };
}
const snapshot = () => window.location.href;
const serverSnapshot = () => "";
const emptyAnchors = {};

export function useWorkspaceView<T extends string>(values: readonly T[], fallback: T, parameter = "view", anchors: Readonly<Record<string, T>> = emptyAnchors, context: Readonly<Record<string, string>> = emptyAnchors) {
  const href = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const view = href ? workspaceView(new URL(href), values, fallback, parameter, anchors) : fallback;
  const setView = useCallback((next: T) => {
    const url = workspaceViewUrl(new URL(window.location.href), parameter, next, context);
    if (url.href === window.location.href) return;
    window.history.pushState(window.history.state, "", url);
    window.dispatchEvent(new Event(workspaceNavigationEvent));
  }, [parameter, context]);
  useEffect(() => {
    if (!href || !new URL(href).hash) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(workspaceAnchor(new URL(href).hash));
      target?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [href, view]);
  return [view, setView] as const;
}
