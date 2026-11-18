import { describe, expect, it } from "vitest";
import { chooseRecipesForWeek } from "./meal-planning";

const days = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-11-${String(16 + index).padStart(2, "0")}`,
  excluded: false,
}));

describe("chooseRecipesForWeek", () => {
  it("avoids recipes used in the previous four weeks while fresh choices remain", () => {
    const result = chooseRecipesForWeek(
      [{ id: "recent", title: "Recent" }, { id: "new", title: "New" }],
      days.slice(0, 1),
      [{ recipeId: "recent", usedAt: "2026-11-10T12:00:00.000Z" }],
      new Date("2026-11-18T12:00:00.000Z"),
      () => 0,
    );

    expect(result[0].recipeId).toBe("new");
  });

  it("allows recent recipes when that is the only way to fill a day", () => {
    const result = chooseRecipesForWeek(
      [{ id: "only", title: "Only recipe" }],
      days.slice(0, 1),
      [{ recipeId: "only", usedAt: "2026-11-10T12:00:00.000Z" }],
      new Date("2026-11-18T12:00:00.000Z"),
      () => 0,
    );

    expect(result[0].recipeId).toBe("only");
  });

  it("leaves excluded days empty and avoids duplicates until choices run out", () => {
    const result = chooseRecipesForWeek(
      [{ id: "a", title: "A" }, { id: "b", title: "B" }],
      [{ ...days[0], excluded: true }, ...days.slice(1, 4)],
      [],
      new Date("2026-11-18T12:00:00.000Z"),
      () => 0,
    );

    expect(result[0].recipeId).toBeNull();
    expect(result.slice(1, 3).map(({ recipeId }) => recipeId)).toEqual(["a", "b"]);
  });
});
