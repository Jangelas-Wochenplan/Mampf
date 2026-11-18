export type HouseholdRole = "owner" | "member";
export type AppView = "home" | "plan" | "recipes" | "shopping" | "pantry";

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
  source_url: string;
  image_url: string | null;
  prep_minutes: number | null;
  servings: number;
  emoji: string;
  created_at: string;
  recipe_ingredients: RecipeIngredient[];
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
  shopping_archived_at: string | null;
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
  is_custom: boolean;
}

export interface ArchivedShoppingList {
  id: string;
  start_date: string;
  shopping_archived_at: string;
  shopping_items: ShoppingItem[];
}

export interface PantryItem {
  id: string;
  household_id: string;
  name: string;
  category: string;
  barcode: string;
  quantity: number;
  unit: string;
  image_path: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}
