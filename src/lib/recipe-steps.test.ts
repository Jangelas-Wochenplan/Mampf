import { describe, expect, it } from "vitest";
import type { RecipeIngredient, RecipeStep } from "../types";
import { normalizeRecipeStepDrafts, recipeStepsForSave, recipeStepsToDraft } from "./recipe-steps";

const ingredients: RecipeIngredient[] = [
  { id: "flour", name: "Mehl", quantity: 200, unit: "g", sort_order: 0 },
  { id: "milk", name: "Milch", quantity: 100, unit: "ml", sort_order: 1 },
];

const steps: RecipeStep[] = [
  {
    id: "step-2",
    instruction: "Milch hinzufügen",
    position: 1,
    step_ingredients: [{
      id: "step-milk",
      recipe_ingredient_id: "milk",
      quantity: null,
      unit: "",
      recipe_ingredient: { name: "Milch" },
    }],
  },
  {
    id: "step-1",
    instruction: "Mehl bereitstellen",
    position: 0,
    step_ingredients: [{
      id: "step-flour",
      recipe_ingredient_id: "flour",
      quantity: 100,
      unit: "g",
      recipe_ingredient: { name: "Mehl" },
    }],
  },
];

describe("recipe step drafts", () => {
  it("orders saved steps and restores linked ingredient quantities", () => {
    const draft = recipeStepsToDraft(steps, ingredients, [
      { quantity: "200", unit: "g" },
      { quantity: "100", unit: "ml" },
    ]);

    expect(draft).toEqual([
      {
        instruction: "Mehl bereitstellen",
        ingredients: [{ ingredient_index: 0, quantity: "100", unit: "g" }],
      },
      {
        instruction: "Milch hinzufügen",
        ingredients: [{ ingredient_index: 1, quantity: "100", unit: "ml" }],
      },
      { instruction: "", ingredients: [] },
    ]);
  });

  it("keeps one empty step after populated steps and removes blank gaps", () => {
    expect(normalizeRecipeStepDrafts([
      { instruction: "Erster Schritt", ingredients: [] },
      { instruction: "  ", ingredients: [] },
      { instruction: "Letzter Schritt", ingredients: [] },
    ])).toEqual([
      { instruction: "Erster Schritt", ingredients: [] },
      { instruction: "Letzter Schritt", ingredients: [] },
      { instruction: "", ingredients: [] },
    ]);

    expect(normalizeRecipeStepDrafts([])).toEqual([{ instruction: "", ingredients: [] }]);
  });

  it("remaps ingredient indexes and ignores blank steps when saving", () => {
    const payload = recipeStepsForSave([
      {
        instruction: "  ",
        ingredients: [],
      },
      {
        instruction: " Milch einrühren ",
        ingredients: [
          { ingredient_index: 2, quantity: " ", unit: " ml " },
          { ingredient_index: 9, quantity: "4", unit: "g" },
        ],
      },
    ], new Map([[2, 1]]));

    expect(payload).toEqual([{
      instruction: "Milch einrühren",
      ingredients: [{ ingredient_index: 1, quantity: null, unit: "ml" }],
    }]);
  });
});
