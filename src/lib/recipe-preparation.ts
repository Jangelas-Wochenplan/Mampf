import type { RecipeStep } from "../types";

export function recipePreparationText(steps: readonly Pick<RecipeStep, "instruction" | "position">[] | undefined): string {
  return (steps ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((step) => step.instruction.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function recipeStepsFromPreparation(preparation: string): Array<{ instruction: string; ingredients: [] }> {
  const instruction = preparation.trim();
  return instruction ? [{ instruction, ingredients: [] }] : [];
}
