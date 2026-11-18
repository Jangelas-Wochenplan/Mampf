import { describe, expect, it } from "vitest";
import { recipeImageStoragePath } from "./recipe-images";

describe("recipe image storage references", () => {
  it("extracts a private bucket path", () => {
    expect(recipeImageStoragePath("storage://recipe-images/household-id/image.jpg"))
      .toBe("household-id/image.jpg");
  });

  it("leaves external image URLs untouched", () => {
    expect(recipeImageStoragePath("https://images.example.com/recipe.jpg")).toBeNull();
    expect(recipeImageStoragePath(null)).toBeNull();
  });

  it("rejects malformed storage paths", () => {
    expect(() => recipeImageStoragePath("storage://recipe-images/../private.jpg")).toThrow();
    expect(() => recipeImageStoragePath("storage://recipe-images/household//image.jpg")).toThrow();
  });
});
