import { describe, expect, it } from "vitest";
import { recipePreparationText, recipeStepsFromPreparation } from "./recipe-preparation";

describe("recipe preparation", () => {
  it("joins stored instructions in display order", () => {
    expect(recipePreparationText([
      { position: 1, instruction: "Sauce köcheln lassen." },
      { position: 0, instruction: "Zwiebeln schneiden." },
    ])).toBe("Zwiebeln schneiden.\n\nSauce köcheln lassen.");
  });

  it("saves a single free-text preparation entry and ignores blank input", () => {
    expect(recipeStepsFromPreparation("  Alles verrühren.  ")).toEqual([
      { instruction: "Alles verrühren.", ingredients: [] },
    ]);
    expect(recipeStepsFromPreparation(" \n ")).toEqual([]);
  });
});
