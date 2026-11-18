import { describe, expect, it } from "vitest";
import { averageRating, ratingByUser } from "./ratings";

describe("recipe ratings", () => {
  it("calculates the average of household members' ratings", () => {
    expect(averageRating([
      { user_id: "member-1", rating: 3 },
      { user_id: "member-2", rating: 5 },
    ])).toBe(4);
  });

  it("returns no average before the first rating", () => {
    expect(averageRating([])).toBeNull();
  });

  it("returns the current user's own rating", () => {
    expect(ratingByUser([
      { user_id: "member-1", rating: 3 },
      { user_id: "member-2", rating: 5 },
    ], "member-1")).toBe(3);
  });
});
