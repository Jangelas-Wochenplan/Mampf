import { describe, expect, it } from "vitest";
import { comparePantryAvailability } from "./pantry-matching";
import type { PantryItem, ShoppingItem } from "../types";

function pantryItem(name: string, quantity: number, unit: string): PantryItem {
  return {
    id: `${name}-${unit}`,
    household_id: "household",
    name,
    barcode: "",
    quantity,
    unit,
    image_path: null,
    image_url: null,
    created_at: "",
    updated_at: "",
  };
}

function shoppingItem(name: string, quantity: number | null, unit: string): ShoppingItem {
  return {
    id: "shopping-item",
    plan_id: "plan",
    name,
    quantity,
    unit,
    checked: false,
    sort_order: 0,
  };
}

describe("comparePantryAvailability", () => {
  it("sums matching stock and reports the amount still needed", () => {
    const result = comparePantryAvailability(shoppingItem("Tomaten", 500, "g"), [
      pantryItem("tomaten", 150, "g"),
      pantryItem("Tomaten", 100, "g"),
    ]);

    expect(result).toMatchObject({
      hasNameMatch: true,
      hasCompatibleUnit: true,
      availableQuantity: 250,
      amountToBuy: 250,
      fullyAvailable: false,
    });
  });

  it("converts compatible metric units and indicates when stock is sufficient", () => {
    const result = comparePantryAvailability(shoppingItem("Mehl", 1.5, "kg"), [
      pantryItem("Mehl", 700, "g"),
      pantryItem("Mehl", 1, "kg"),
    ]);

    expect(result.availableQuantity).toBe(1.7);
    expect(result.amountToBuy).toBe(0);
    expect(result.fullyAvailable).toBe(true);
  });

  it("does not claim coverage when a matching name has incompatible units", () => {
    const result = comparePantryAvailability(shoppingItem("Milch", 1, "l"), [
      pantryItem("Milch", 2, "Packung"),
    ]);

    expect(result).toMatchObject({
      hasNameMatch: true,
      hasCompatibleUnit: false,
      availableQuantity: null,
      amountToBuy: 1,
      fullyAvailable: false,
    });
  });

  it("keeps the full amount on the shopping list when there is no name match", () => {
    const result = comparePantryAvailability(shoppingItem("Zwiebel", 3, "Stück"), [
      pantryItem("Knoblauch", 2, "Zehe"),
    ]);

    expect(result).toMatchObject({
      hasNameMatch: false,
      hasCompatibleUnit: false,
      availableQuantity: 0,
      amountToBuy: 3,
      fullyAvailable: false,
    });
  });

  it("leaves unquantified shopping items unestimated", () => {
    const result = comparePantryAvailability(shoppingItem("Salz", null, "g"), [
      pantryItem("Salz", 200, "g"),
    ]);

    expect(result.availableQuantity).toBe(200);
    expect(result.amountToBuy).toBeNull();
    expect(result.fullyAvailable).toBe(false);
  });
});
