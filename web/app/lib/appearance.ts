export type Appearance = "light" | "dark";

export const appearanceStorageKey = "ticklens.appearance.v1";

export const appearanceBootstrapScript = `(() => {
  let appearance;
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
