import { describe, expect, it } from "vitest";
import { aggregateIngredients } from "./shopping-list";

describe("aggregateIngredients", () => {
  it("combines duplicate names and converts compatible metric units", () => {
    const result = aggregateIngredients([
      { name: "Tomaten", quantity: 500, unit: "g" },
      { name: " tomaten ", quantity: 0.5, unit: "kg" },
      { name: "Milch", quantity: 250, unit: "ml" },
      { name: "Milch", quantity: 1, unit: "l" },
    ]);

    expect(result).toEqual([
      { key: "tomaten|mass|g", name: "Tomaten", quantity: 1, unit: "kg" },
      { key: "milch|volume|ml", name: "Milch", quantity: 1.25, unit: "l" },
    ]);
  });

  it("keeps incompatible units separate", () => {
    const result = aggregateIngredients([
      { name: "Mehl", quantity: 1, unit: "Tasse" },
      { name: "Mehl", quantity: 100, unit: "g" },
    ]);

    expect(result).toHaveLength(2);
  });
});
