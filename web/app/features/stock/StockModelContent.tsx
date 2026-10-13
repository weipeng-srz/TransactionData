"use client";

import { useState, type ReactNode } from "react";

/** Delay expensive prediction work until requested, then retain every model control. */
export default function StockModelContent({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return active || visited ? children : null;
}
