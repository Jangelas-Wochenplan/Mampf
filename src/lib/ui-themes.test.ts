import { afterEach, describe, expect, it, vi } from "vitest";
import { readSavedDarkMode, saveDarkMode, UI_THEME } from "./ui-themes";

function installStorage(values: Record<string, string> = {}) {
  const entries = new Map(Object.entries(values));
  const storage = {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
    removeItem: vi.fn((key: string) => entries.delete(key)),
  };
  vi.stubGlobal("window", { localStorage: storage });
  return storage;
}

describe("UI theme and dark mode preferences", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps Meeresbrise as the only design", () => {
    expect(UI_THEME).toMatchObject({ id: "ocean", name: "Meeresbrise" });
  });

  it("defaults to light mode and restores the saved dark mode", () => {
    installStorage();
    expect(readSavedDarkMode()).toBe(false);

    installStorage({ "mampf-ui-dark-mode": "true" });
    expect(readSavedDarkMode()).toBe(true);
  });

  it("migrates existing dark designs to dark mode", () => {
    installStorage({ "mampf-ui-theme": "bistro-noir" });
    expect(readSavedDarkMode()).toBe(true);
  });

  it("saves the mode and removes the old design preference", () => {
    const storage = installStorage({ "mampf-ui-theme": "sakura" });

    expect(saveDarkMode(true)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith("mampf-ui-dark-mode", "true");
    expect(storage.removeItem).toHaveBeenCalledWith("mampf-ui-theme");
  });
});
