"use client";

import { useEffect } from "react";

const lightIcons = {
  "64x64": "/favicon.png",
  "192x192": "/trendsight-icon-192.png",
} as const;

const darkIcons = {
  "64x64": "/favicon-dark.png",
  "192x192": "/trendsight-icon-dark-192.png",
} as const;

export default function ThemeIconSync() {
  useEffect(() => {
    const root = document.documentElement;
    const syncIcons = () => {
      const icons = root.dataset.appearance === "dark" ? darkIcons : lightIcons;
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((link) => {
        const href = icons[link.sizes.value as keyof typeof icons];
        if (href && link.getAttribute("href") !== href) link.setAttribute("href", href);
      });
    };

    syncIcons();
    const appearanceObserver = new MutationObserver(syncIcons);
    const headObserver = new MutationObserver(syncIcons);
    appearanceObserver.observe(root, { attributes: true, attributeFilter: ["data-appearance"] });
    headObserver.observe(document.head, { childList: true, subtree: true });
    return () => {
      appearanceObserver.disconnect();
      headObserver.disconnect();
    };
  }, []);

  return null;
}
