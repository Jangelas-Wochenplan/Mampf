import type { RecipeRating } from "../types";

export function averageRating(ratings: RecipeRating[]): number | null {
  if (ratings.length === 0) return null;
  return ratings.reduce((sum, entry) => sum + entry.rating, 0) / ratings.length;
}

export function ratingByUser(ratings: RecipeRating[], userId: string): number {
  return ratings.find((entry) => entry.user_id === userId)?.rating ?? 0;
}
