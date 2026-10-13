"use client";

import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

/** Printing expands presentation only. It never navigates or writes research data. */
export function useResearchPrint(prepare: () => Promise<unknown>) {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    let expanded: HTMLDetailsElement[] = [];
    const before = () => {
      flushSync(() => setPrinting(true));
      expanded = Array.from(document.querySelectorAll<HTMLDetailsElement>('.research-page main details:not([open])'));
      expanded.forEach((detail) => { detail.open = true; });
    };
    const after = () => {
      expanded.forEach((detail) => { detail.open = false; });
      expanded = [];
      setPrinting(false);
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      expanded.forEach((detail) => { detail.open = false; });
    };
  }, []);
  const print = useCallback(async () => {
    await prepare();
    flushSync(() => setPrinting(true));
    // Let dynamically loaded panels and their ResizeObservers finish before capture.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try { window.print(); } finally { setPrinting(false); }
  }, [prepare]);
  return [printing, print] as const;
}
