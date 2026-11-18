import type { PlannedDay } from "./meal-planning";
import { aggregateIngredients } from "./shopping-list";

interface RecipeShoppingInfo {
  servings: number;
  recipe_ingredients: Array<{
    name: string;
    quantity: number | null;
    unit: string;
  }>;
}

export function serializeMealPlan(
  days: Array<PlannedDay & { recipeId: string | null }>,
  recipesById: ReadonlyMap<string, RecipeShoppingInfo>,
) {
  const ingredientAmounts = days.flatMap((day) => {
    if (day.excluded || !day.recipeId) return [];
    const recipe = recipesById.get(day.recipeId);
    if (!recipe) return [];
    return recipe.recipe_ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity === null ? null : ingredient.quantity * (4 / recipe.servings),
      unit: ingredient.unit,
    }));
  });
  return {
    days_payload: days.map((day) => ({
      day_date: day.date,
      excluded: day.excluded,
      recipe_id: day.excluded ? null : day.recipeId,
    })),
    shopping_payload: aggregateIngredients(ingredientAmounts).map((item, index) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      sort_order: index,
    })),
  };
}
