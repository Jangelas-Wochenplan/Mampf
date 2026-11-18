import { describe, expect, it } from "vitest";
import { isPantryImageCandidate, pantryImageFormat } from "./pantry-images";

describe("pantryImageFormat", () => {
  it("uses supported image MIME types", () => {
    expect(pantryImageFormat({ type: "image/jpeg", name: "photo" })).toEqual({
      extension: "jpg",
      contentType: "image/jpeg",
    });
  });

  it("falls back to a supported file extension when the browser omits its MIME type", () => {
    expect(pantryImageFormat({ type: "", name: "photo.JPEG" })).toEqual({
      extension: "jpg",
      contentType: "image/jpeg",
    });
  });

  it("rejects unsupported image formats", () => {
    expect(pantryImageFormat({ type: "image/heic", name: "photo.heic" })).toBeNull();
    expect(isPantryImageCandidate({ type: "image/heic", name: "photo.heic" })).toBe(true);
    expect(isPantryImageCandidate({ type: "image/svg+xml", name: "photo.svg" })).toBe(false);
  });
});
