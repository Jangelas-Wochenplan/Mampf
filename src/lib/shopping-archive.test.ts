import { describe, expect, it } from "vitest";
import { isShoppingListComplete } from "./shopping-archive";

describe("isShoppingListComplete", () => {
  it("archives a non-empty list only after every item is checked", () => {
    expect(isShoppingListComplete([{ checked: true }, { checked: true }])).toBe(true);
    expect(isShoppingListComplete([{ checked: true }, { checked: false }])).toBe(false);
  });

  it("does not archive an empty list", () => {
    expect(isShoppingListComplete([])).toBe(false);
  });
});
