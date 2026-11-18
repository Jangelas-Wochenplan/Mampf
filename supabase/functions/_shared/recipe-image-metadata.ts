function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    result[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

export function extractRecipeImageUrl(html: string, pageUrl: URL): string | null {
  const candidates: string[] = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = attributes(match[0]);
    const property = (tag.property ?? tag.name ?? "").toLowerCase();
    if (["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"].includes(property)) {
      if (tag.content) candidates.push(tag.content);
    }
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = attributes(match[0]);
    if (tag.rel?.toLowerCase().split(/\s+/).includes("image_src") && tag.href) {
      candidates.push(tag.href);
    }
  }
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = attributes(match[0]);
    const source = tag.src ?? tag["data-src"];
    if (source) candidates.push(source);
  }

  for (const candidate of candidates) {
    try {
      const imageUrl = new URL(candidate, pageUrl);
      if (
        ["http:", "https:"].includes(imageUrl.protocol) &&
        !imageUrl.username &&
        !imageUrl.password
      ) {
        return imageUrl.toString();
      }
    } catch {
      // Ignore malformed page metadata and continue with the next candidate.
    }
  }
  return null;
}
