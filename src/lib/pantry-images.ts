export interface PantryImageFormat {
  extension: string;
  contentType: string;
}

export interface PreparedPantryImage {
  file: File;
  format: PantryImageFormat;
}

const TARGET_PANTRY_IMAGE_BYTES = 7.5 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2048;

const formats: Record<string, PantryImageFormat> = {
  "image/jpeg": { extension: "jpg", contentType: "image/jpeg" },
  "image/png": { extension: "png", contentType: "image/png" },
  "image/webp": { extension: "webp", contentType: "image/webp" },
  "image/gif": { extension: "gif", contentType: "image/gif" },
};

const extensions: Record<string, PantryImageFormat> = {
  jpg: formats["image/jpeg"],
  jpeg: formats["image/jpeg"],
  png: formats["image/png"],
  webp: formats["image/webp"],
  gif: formats["image/gif"],
};

export function pantryImageFormat(file: Pick<File, "type" | "name">): PantryImageFormat | null {
  const contentType = file.type.toLowerCase().split(";")[0].trim();
  if (formats[contentType]) return formats[contentType];
  if (contentType) return null;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return extensions[extension] ?? null;
}

function isHeicImage(file: Pick<File, "type" | "name">): boolean {
  const contentType = file.type.toLowerCase().split(";")[0].trim();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return contentType === "image/heic"
    || contentType === "image/heif"
    || extension === "heic"
    || extension === "heif";
}

export function isPantryImageCandidate(file: Pick<File, "type" | "name">): boolean {
  return pantryImageFormat(file) !== null || isHeicImage(file);
}

async function compressAsJpeg(file: File): Promise<PreparedPantryImage> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("Dieses Bild ist zu groß oder im HEIC-Format. Bitte wähle ein JPEG-, PNG- oder WebP-Bild unter 7,5 MB.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Dieses Bildformat kann hier nicht verarbeitet werden. Bitte wähle ein JPEG-, PNG- oder WebP-Bild.");
  }
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Das Bild konnte nicht für den Upload vorbereitet werden.");
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height)) * 0.82 ** attempt;
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const quality = Math.max(0.48, 0.84 - attempt * 0.07);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= TARGET_PANTRY_IMAGE_BYTES) {
        const baseName = file.name.replace(/\.[^.]+$/, "") || "vorrat";
        return {
          file: new File([blob], `${baseName}.jpg`, { type: "image/jpeg" }),
          format: formats["image/jpeg"],
        };
      }
    }
    throw new Error("Das Bild konnte nicht auf die erlaubte Uploadgröße verkleinert werden.");
  } finally {
    bitmap.close();
  }
}

export async function preparePantryImage(file: File): Promise<PreparedPantryImage> {
  const format = pantryImageFormat(file);
  if (!format && !isHeicImage(file)) {
    throw new Error("Bitte wähle ein JPEG-, PNG-, WebP- oder GIF-Bild aus.");
  }
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Das Bild ist größer als 40 MB und kann nicht verarbeitet werden.");
  }
  if (format && file.size <= TARGET_PANTRY_IMAGE_BYTES) return { file, format };
  return compressAsJpeg(file);
}
