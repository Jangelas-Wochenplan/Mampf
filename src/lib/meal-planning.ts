export interface RecipeCandidate {
  id: string;
  title: string;
}

export interface RecipeUsage {
  recipeId: string;
  usedAt: string;
}

export interface PlannedDay {
  date: string;
  excluded: boolean;
}

export interface GeneratedDay extends PlannedDay {
  recipeId: string | null;
}

const RECENT_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

export function chooseRecipesForWeek(
  recipes: RecipeCandidate[],
  days: PlannedDay[],
  usage: RecipeUsage[],
  now: Date = new Date(),
  random: () => number = Math.random,
): GeneratedDay[] {
  const recentRecipeIds = new Set(
    usage
      .filter(({ usedAt }) => {
        const time = new Date(usedAt).getTime();
        return Number.isFinite(time) && time >= now.getTime() - RECENT_WINDOW_MS && time <= now.getTime();
      })
      .map(({ recipeId }) => recipeId),
  );
  const selectedThisWeek = new Set<string>();

  return days.map((day) => {
    if (day.excluded || recipes.length === 0) return { ...day, recipeId: null };

    const notRepeated = recipes.filter(({ id }) => !selectedThisWeek.has(id));
    const fresh = notRepeated.filter(({ id }) => !recentRecipeIds.has(id));
    const candidates = fresh.length > 0 ? fresh : notRepeated.length > 0 ? notRepeated : recipes;
    const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)));
    const chosen = candidates[index];
    selectedThisWeek.add(chosen.id);
    return { ...day, recipeId: chosen.id };
  });
}
