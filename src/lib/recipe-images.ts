export const RECIPE_IMAGE_BUCKET = "recipe-images";

const storageReferencePrefix = `storage://${RECIPE_IMAGE_BUCKET}/`;
const previewWidth = 800;
const previewHeight = 450;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recipePageUrl(sourceUrl: string): URL {
  const url = new URL(sourceUrl);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Bitte gib einen gültigen öffentlichen HTTP- oder HTTPS-Link an.");
  }
  if (
    !hostname.includes(".") ||
    hostname.includes(":") ||
    /^[\d.]+$/.test(hostname) ||
    ["localhost", "metadata.google.internal"].includes(hostname) ||
    [".localhost", ".local", ".internal", ".test", ".invalid", ".example"].some((suffix) =>
      hostname.endsWith(suffix)
    ) ||
    (url.port && url.port !== (url.protocol === "https:" ? "443" : "80"))
  ) {
    throw new Error("Der Rezeptlink muss auf eine öffentliche Website zeigen.");
  }
  return url;
}

export function recipePreviewImageUrl(sourceUrl: string, metadata: unknown): string {
  const pageUrl = recipePageUrl(sourceUrl);
  const data = isRecord(metadata) && isRecord(metadata.data) ? metadata.data : null;
  const image = data && isRecord(data.image) ? data.image : null;
  const imageUrl = image && typeof image.url === "string" ? image.url : "";
  const fallbackUrl = new URL("/favicon.ico", pageUrl);

  if (!imageUrl) return fallbackUrl.toString();
  try {
    const candidate = new URL(imageUrl, pageUrl);
    if (
      !["http:", "https:"].includes(candidate.protocol) ||
      candidate.username ||
      candidate.password ||
      (pageUrl.protocol === "https:" && candidate.protocol !== "https:")
    ) {
      return fallbackUrl.toString();
    }
    return candidate.toString();
  } catch {
    return fallbackUrl.toString();
  }
}

function compressRemoteImage(imageUrl: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Das Vorschaubild konnte nicht verarbeitet werden."));
        return;
      }

      const targetRatio = previewWidth / previewHeight;
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      let sourceWidth = image.naturalWidth;
      let sourceHeight = image.naturalHeight;
      let sourceX = 0;
      let sourceY = 0;
      if (sourceRatio > targetRatio) {
        sourceWidth = image.naturalHeight * targetRatio;
        sourceX = (image.naturalWidth - sourceWidth) / 2;
      } else if (sourceRatio < targetRatio) {
        sourceHeight = image.naturalWidth / targetRatio;
        sourceY = (image.naturalHeight - sourceHeight) / 2;
      }

      canvas.width = previewWidth;
      canvas.height = previewHeight;
      try {
        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          previewWidth,
          previewHeight,
        );
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Das Vorschaubild konnte nicht komprimiert werden."));
            return;
          }
          resolve(new File([blob], "recipe-preview.jpg", { type: "image/jpeg" }));
        }, "image/jpeg", 0.75);
      } catch {
        reject(new Error("Die Bildquelle erlaubt keinen sicheren Abruf des Vorschaubilds."));
      }
    };
    image.onerror = () => reject(new Error("Das Vorschaubild konnte nicht geladen werden."));
    image.src = imageUrl;
  });
}

export async function fetchRecipePreviewImage(sourceUrl: string): Promise<File> {
  const pageUrl = recipePageUrl(sourceUrl);
  const metadataUrl = new URL("https://api.microlink.io/");
  metadataUrl.searchParams.set("url", pageUrl.toString());

  let response: Response;
  try {
    response = await fetch(metadataUrl);
  } catch {
    throw new Error("Der Bilddienst Microlink konnte nicht erreicht werden.");
  }
  if (!response.ok) {
    throw new Error(`Microlink konnte keine Bildvorschau ermitteln (HTTP ${response.status}).`);
  }

  let metadata: unknown;
  try {
    metadata = await response.json();
  } catch {
    throw new Error("Microlink hat eine ungültige Antwort zurückgegeben.");
  }
  return compressRemoteImage(recipePreviewImageUrl(pageUrl.toString(), metadata));
}

export function recipeImageStoragePath(imageUrl: string | null): string | null {
  if (!imageUrl?.startsWith(storageReferencePrefix)) return null;
  const path = imageUrl.slice(storageReferencePrefix.length);
  if (!path || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Der gespeicherte Rezeptbildpfad ist ungültig.");
  }
  return path;
}
