import type { RecipeIngredient, RecipeStep } from "../types";

export interface RecipeStepDraftIngredient {
  ingredient_index: number;
  quantity: string;
  unit: string;
}

export interface RecipeStepDraft {
  instruction: string;
  ingredients: RecipeStepDraftIngredient[];
}

export interface RecipeStepPayload {
  instruction: string;
  ingredients: Array<{
    ingredient_index: number;
    quantity: string | null;
    unit: string;
  }>;
}

interface RecipeIngredientDraftValue {
  quantity: string;
  unit: string;
}

export function normalizeRecipeStepDrafts(steps: RecipeStepDraft[]): RecipeStepDraft[] {
  const populated = steps.filter((step) => step.instruction.trim());
  return [...populated, { instruction: "", ingredients: [] }];
}

export function recipeStepsToDraft(
  steps: RecipeStep[],
  ingredients: RecipeIngredient[],
  ingredientDrafts: RecipeIngredientDraftValue[],
): RecipeStepDraft[] {
  if (steps.length === 0) return normalizeRecipeStepDrafts([]);
  const ingredientIndexes = new Map(ingredients.map((ingredient, index) => [ingredient.id, index]));

  const drafts = steps
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((step) => ({
      instruction: step.instruction,
      ingredients: step.step_ingredients.flatMap((stepIngredient) => {
        const ingredientIndex = ingredientIndexes.get(stepIngredient.recipe_ingredient_id);
        if (ingredientIndex === undefined) return [];
        const baseIngredient = ingredientDrafts[ingredientIndex];
        if (!baseIngredient) return [];
        return [{
          ingredient_index: ingredientIndex,
          quantity: stepIngredient.quantity === null
            ? baseIngredient.quantity
            : String(stepIngredient.quantity),
          unit: stepIngredient.unit || baseIngredient.unit,
        }];
      }),
    }));
  return normalizeRecipeStepDrafts(drafts);
}

export function recipeStepsForSave(
  steps: RecipeStepDraft[],
  ingredientIndexMap: Map<number, number>,
): RecipeStepPayload[] {
  return steps.flatMap((step) => {
    const instruction = step.instruction.trim();
    if (!instruction) return [];
    return [{
      instruction,
      ingredients: step.ingredients.flatMap((ingredient) => {
        const ingredientIndex = ingredientIndexMap.get(ingredient.ingredient_index);
        if (ingredientIndex === undefined) return [];
        return [{
          ingredient_index: ingredientIndex,
          quantity: ingredient.quantity.trim() || null,
          unit: ingredient.unit.trim(),
        }];
      }),
    }];
  });
}
