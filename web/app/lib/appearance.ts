export type Appearance = "light" | "dark";

export const appearanceStorageKey = "ticklens.appearance.v1";

export const appearanceBootstrapScript = `(() => {
  const key = ${JSON.stringify(appearanceStorageKey)};
  let appearance;
  try {
    const stored = localStorage.getItem(key);
    if (stored === "light" || stored === "dark") appearance = stored;
  } catch {}
  if (!appearance) {
    try {
      appearance = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      appearance = "light";
    }
  }
  const root = document.documentElement;
  root.dataset.appearance = appearance;
  root.style.colorScheme = appearance;
})();`;
