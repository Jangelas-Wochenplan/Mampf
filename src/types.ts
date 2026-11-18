export type HouseholdRole = "owner" | "member";
export type AppView = "home" | "plan" | "recipes" | "shopping";

export interface Household {
  id: string;
  name: string;
}

export interface RecipeIngredient {
  id: string;
  name: string;
  quantity: number | null;
  unit: string;
  sort_order: number;
}

export interface RecipeStepIngredient {
  id: string;
  recipe_ingredient_id: string;
  quantity: number | null;
  unit: string;
  recipe_ingredient?: Pick<RecipeIngredient, "name">;
}

export interface RecipeStep {
  id: string;
  instruction: string;
  position: number;
  step_ingredients: RecipeStepIngredient[];
}

export interface RecipeRating {
  user_id: string;
  rating: number;
}

export interface Recipe {
  id: string;
  household_id: string;
  title: string;
  description: string;
  category: string;
  prep_minutes: number | null;
  servings: number;
  emoji: string;
  created_at: string;
  recipe_ingredients: RecipeIngredient[];
  recipe_steps: RecipeStep[];
  recipe_ratings: RecipeRating[];
}

export interface PlanDay {
  id: string;
  plan_id: string;
  day_date: string;
  excluded: boolean;
  recipe_id: string | null;
  recipe?: Pick<Recipe, "id" | "title" | "description" | "prep_minutes" | "emoji"> | null;
}

export interface MealPlan {
  id: string;
  household_id: string;
  start_date: string;
  plan_days: PlanDay[];
}

export interface ShoppingItem {
  id: string;
  plan_id: string;
  name: string;
  quantity: number | null;
  unit: string;
  checked: boolean;
  sort_order: number;
}
