import { describe, expect, it } from "vitest";
import { recipeImageStoragePath, recipePreviewImageUrl } from "./recipe-images";

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

  it("uses the image URL returned by Microlink", () => {
    expect(recipePreviewImageUrl("https://example.com/recipe", {
      data: { image: { url: "https://cdn.example.com/recipe.jpg" } },
    })).toBe("https://cdn.example.com/recipe.jpg");
  });

  it("falls back to the source site's favicon when Microlink has no safe image URL", () => {
    expect(recipePreviewImageUrl("https://example.com/recipe", { data: {} }))
      .toBe("https://example.com/favicon.ico");
    expect(recipePreviewImageUrl("https://example.com/recipe", {
      data: { image: { url: "javascript:alert(1)" } },
    })).toBe("https://example.com/favicon.ico");
  });

  it("does not send local or non-web source URLs to Microlink", () => {
    expect(() => recipePreviewImageUrl("http://127.0.0.1/admin", {})).toThrow();
    expect(() => recipePreviewImageUrl("http://printer.local/", {})).toThrow();
    expect(() => recipePreviewImageUrl("https://example.com:8443/recipe", {})).toThrow();
  });
});
