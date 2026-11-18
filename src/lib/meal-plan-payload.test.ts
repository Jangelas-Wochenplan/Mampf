import { describe, expect, it } from "vitest";
import { serializeMealPlan } from "./meal-plan-payload";

describe("serializeMealPlan", () => {
  it("recalculates the shopping list from the remaining recipes after a deletion", () => {
    const recipes = new Map([
      ["kept", {
        servings: 2,
        recipe_ingredients: [{ name: "Kartoffeln", quantity: 300, unit: "g" }],
      }],
    ]);

    const result = serializeMealPlan(
      [
        { date: "2026-11-16", excluded: false, recipeId: "kept" },
        { date: "2026-11-17", excluded: false, recipeId: null },
      ],
      recipes,
    );

    expect(result.days_payload.map(({ recipe_id }) => recipe_id)).toEqual(["kept", null]);
    expect(result.shopping_payload).toEqual([
      { name: "Kartoffeln", quantity: 600, unit: "g", sort_order: 0 },
    ]);
  });
});
