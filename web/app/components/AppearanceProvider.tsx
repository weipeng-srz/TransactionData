"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { appearanceStorageKey, type Appearance } from "../lib/appearance";

type AppearanceContextValue = {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  toggleAppearance: () => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function systemAppearance(): Appearance {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storedAppearance(): Appearance | null {
  try {
    const stored = localStorage.getItem(appearanceStorageKey);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function currentAppearance(): Appearance {
  if (typeof document === "undefined") return "light";
  const applied = document.documentElement.dataset.appearance;
  if (applied === "light" || applied === "dark") return applied;
  return storedAppearance() ?? systemAppearance();
}

function applyAppearance(appearance: Appearance, persist: boolean) {
  const root = document.documentElement;
  root.dataset.appearance = appearance;
  root.style.colorScheme = appearance;
  if (!persist) return;
  try {
    localStorage.setItem(appearanceStorageKey, appearance);
  } catch {
    // The selected appearance remains active when browser storage is unavailable.
  }
}

export default function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>("light");

  const setAppearance = useCallback((next: Appearance) => {
    applyAppearance(next, true);
    setAppearanceState(next);
  }, []);

  const toggleAppearance = useCallback(() => {
    const next = currentAppearance() === "dark" ? "light" : "dark";
    applyAppearance(next, true);
    setAppearanceState(next);
  }, []);

  useEffect(() => {
    const initial = currentAppearance();
    applyAppearance(initial, false);
    const syncFrame = window.requestAnimationFrame(() => setAppearanceState(initial));

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncStoredAppearance = (event: StorageEvent) => {
      if (event.key !== appearanceStorageKey) return;
      const next = event.newValue === "light" || event.newValue === "dark" ? event.newValue : systemAppearance();
      applyAppearance(next, false);
      setAppearanceState(next);
    };
    const syncSystemAppearance = (event: MediaQueryListEvent) => {
      if (storedAppearance()) return;
      const next: Appearance = event.matches ? "dark" : "light";
      applyAppearance(next, false);
      setAppearanceState(next);
    };

    window.addEventListener("storage", syncStoredAppearance);
    media.addEventListener("change", syncSystemAppearance);
    return () => {
      window.cancelAnimationFrame(syncFrame);
      window.removeEventListener("storage", syncStoredAppearance);
      media.removeEventListener("change", syncSystemAppearance);
    };
  }, []);

  const value = useMemo(() => ({ appearance, setAppearance, toggleAppearance }), [appearance, setAppearance, toggleAppearance]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance must be used within AppearanceProvider");
  return value;
}
