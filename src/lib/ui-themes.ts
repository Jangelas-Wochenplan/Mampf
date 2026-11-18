export const UI_THEMES = [
  { id: "garden", name: "Garten", style: "Warm & vertraut", mode: "light" },
  { id: "nordic", name: "Nordlicht", style: "Klar & minimal", mode: "light" },
  { id: "ocean", name: "Meeresbrise", style: "Frisch & ruhig", mode: "light" },
  { id: "terracotta", name: "Toskana", style: "Sonnig & rustikal", mode: "light" },
  { id: "sakura", name: "Sakura", style: "Sanft & verspielt", mode: "light" },
  { id: "citrus", name: "Zitrus", style: "Leicht & lebendig", mode: "light" },
  { id: "midnight", name: "Mitternacht", style: "Dunkel & elegant", mode: "dark" },
  { id: "forest-night", name: "Waldnacht", style: "Dunkel & natürlich", mode: "dark" },
  { id: "bistro-noir", name: "Bistro Noir", style: "Dunkel & warm", mode: "dark" },
  { id: "mono", name: "Monochrom", style: "Dunkel & reduziert", mode: "dark" },
] as const;

export type UIThemeId = (typeof UI_THEMES)[number]["id"];

const UI_THEME_STORAGE_KEY = "mampf-ui-theme";
const UI_THEME_IDS = new Set<string>(UI_THEMES.map((theme) => theme.id));

export function isUIThemeId(value: unknown): value is UIThemeId {
  return typeof value === "string" && UI_THEME_IDS.has(value);
}

export function readSavedUITheme(): UIThemeId {
  if (typeof window === "undefined") return "garden";
  try {
    const savedTheme = window.localStorage.getItem(UI_THEME_STORAGE_KEY);
    return isUIThemeId(savedTheme) ? savedTheme : "garden";
  } catch {
    return "garden";
  }
}

export function saveUITheme(theme: UIThemeId): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}
