export const UI_THEME = {
  id: "ocean",
  name: "Meeresbrise",
  style: "Frisch & ruhig",
} as const;

const UI_DARK_MODE_STORAGE_KEY = "mampf-ui-dark-mode";
const LEGACY_THEME_STORAGE_KEY = "mampf-ui-theme";
const LEGACY_DARK_THEMES = new Set(["midnight", "forest-night", "bistro-noir", "mono"]);

export function readSavedDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const savedMode = window.localStorage.getItem(UI_DARK_MODE_STORAGE_KEY);
    if (savedMode === "true" || savedMode === "false") return savedMode === "true";
    return LEGACY_DARK_THEMES.has(window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY) ?? "");
  } catch {
    return false;
  }
}

export function saveDarkMode(enabled: boolean): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(UI_DARK_MODE_STORAGE_KEY, String(enabled));
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
