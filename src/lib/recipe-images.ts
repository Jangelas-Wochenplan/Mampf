export const RECIPE_IMAGE_BUCKET = "recipe-images";

const storageReferencePrefix = `storage://${RECIPE_IMAGE_BUCKET}/`;

export function recipeImageStoragePath(imageUrl: string | null): string | null {
  if (!imageUrl?.startsWith(storageReferencePrefix)) return null;
  const path = imageUrl.slice(storageReferencePrefix.length);
  if (!path || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Der gespeicherte Rezeptbildpfad ist ungültig.");
  }
  return path;
}
