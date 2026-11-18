export interface PantryImageFormat {
  extension: string;
  contentType: string;
}

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
