import { describe, expect, it } from "vitest";
import { extractRecipeImageUrl } from "../../supabase/functions/_shared/recipe-image-metadata";

describe("recipe image metadata", () => {
  it("extracts a quoted Open Graph image and decodes HTML entities", () => {
    const html = '<meta content="https://cdn.example.com/food.jpg?size=large&amp;crop=1" property="og:image">';

    expect(extractRecipeImageUrl(html, new URL("https://recipes.example.com/post")))
      .toBe("https://cdn.example.com/food.jpg?size=large&crop=1");
  });

  it("resolves relative image source links", () => {
    const html = '<link rel="alternate image_src" href="/assets/cover.jpg">';

    expect(extractRecipeImageUrl(html, new URL("https://recipes.example.com/post/")))
      .toBe("https://recipes.example.com/assets/cover.jpg");
  });

  it("skips invalid image candidates", () => {
    const html = '<meta property="og:image" content="javascript:alert(1)"><meta property="twitter:image" content="https://cdn.example.com/food.jpg">';

    expect(extractRecipeImageUrl(html, new URL("https://recipes.example.com/post")))
      .toBe("https://cdn.example.com/food.jpg");
  });
});
