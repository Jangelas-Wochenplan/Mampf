import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractRecipeImageUrl } from "../_shared/recipe-image-metadata.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const appOrigin = Deno.env.get("APP_ORIGIN");
const maxHeadBytes = 2 * 1024 * 1024;
const maxRedirects = 3;
const browserUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

if (!supabaseUrl || !serviceRoleKey || !appOrigin) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and APP_ORIGIN are required.");
}

const appUrl = new URL(appOrigin);
if (
  !["https:", "http:"].includes(appUrl.protocol) ||
  (appUrl.protocol === "http:" && !["localhost", "127.0.0.1"].includes(appUrl.hostname)) ||
  appUrl.search ||
  appUrl.hash ||
  appUrl.username ||
  appUrl.password
) {
  throw new Error("APP_ORIGIN must be an HTTPS app URL (HTTP is allowed for localhost development).");
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const corsHeaders = {
  "Access-Control-Allow-Origin": appUrl.origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  Vary: "Origin",
};

class PreviewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [first, second, third] = octets;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 168 || (second === 0 && (third === 0 || third === 2)))) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113)
  );
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (!normalized || normalized.startsWith("::ffff:")) return false;
  if (!normalized.startsWith("2") && !normalized.startsWith("3")) return false;
  return !(
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("2001:0:") ||
    normalized.startsWith("2001:10:") ||
    normalized.startsWith("2001:20:") ||
    normalized.startsWith("2002:") ||
    normalized.startsWith("3fff:")
  );
}

async function validatePublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PreviewError("Bitte gib einen gültigen Rezeptlink an.", 400);
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port && url.port !== (url.protocol === "https:" ? "443" : "80")
  ) {
    throw new PreviewError("Nur öffentliche HTTP- und HTTPS-Links werden unterstützt.", 400);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname.includes(".") ||
    hostname.includes(":") ||
    /^[\d.]+$/.test(hostname) ||
    ["localhost", "metadata.google.internal"].includes(hostname) ||
    [".localhost", ".local", ".internal", ".test", ".invalid", ".example"].some((suffix) =>
      hostname.endsWith(suffix)
    )
  ) {
    throw new PreviewError("Der Rezeptlink muss auf eine öffentliche Website zeigen.", 400);
  }

  let addresses: string[] = [];
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      addresses = [...addresses, ...await Deno.resolveDns(hostname, recordType)];
    } catch {
      // A host can legitimately have only one address family.
    }
  }
  if (!addresses.length || addresses.some((address) =>
    address.includes(":") ? !isPublicIpv6(address) : !isPublicIpv4(address)
  )) {
    throw new PreviewError("Die Website ist nicht öffentlich erreichbar.", 400);
  }

  url.hash = "";
  return url;
}

async function readHtml(response: Response): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return html + decoder.decode();
    total += value.byteLength;
    html += decoder.decode(value, { stream: true });
    const headEnd = /<\/head\s*>/i.exec(html);
    if (headEnd) {
      await reader.cancel();
      return html.slice(0, headEnd.index + headEnd[0].length);
    }
    if (total > maxHeadBytes) {
      await reader.cancel();
      throw new PreviewError("Der HTML-Kopf der Rezeptseite ist zu groß, um ein Titelbild auszulesen.", 413);
    }
  }
}

function isInstagramPage(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return hostname === "instagram.com" || hostname.endsWith(".instagram.com");
}

async function resolveImage(rawUrl: string): Promise<string | null> {
  let pageUrl = await validatePublicUrl(rawUrl);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    let response: Response;
    try {
      response = await fetch(pageUrl, {
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml,image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9",
          "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
          "User-Agent": browserUserAgent,
        },
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirectCount === maxRedirects) {
          throw new PreviewError("Die Rezeptseite leitet zu oft weiter.", 422);
        }
        pageUrl = await validatePublicUrl(new URL(location, pageUrl).toString());
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        if (isInstagramPage(pageUrl) && [401, 403, 429].includes(response.status)) {
          throw new PreviewError("Instagram blockiert den öffentlichen Bildabruf für diesen Beitrag. Lade das Titelbild bitte direkt hoch.", 422);
        }
        throw new PreviewError("Die Rezeptseite konnte nicht geladen werden.", 422);
      }

      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      if (contentType.startsWith("image/")) {
        await response.body?.cancel();
        if (appUrl.protocol === "https:" && pageUrl.protocol !== "https:") return null;
        return pageUrl.toString();
      }
      if (!["text/html", "application/xhtml+xml"].includes(contentType)) {
        await response.body?.cancel();
        return null;
      }

      const html = await readHtml(response);
      const imageUrl = extractRecipeImageUrl(html, pageUrl);
      if (!imageUrl) {
        if (isInstagramPage(pageUrl)) {
          throw new PreviewError("Instagram stellt für diesen Beitrag keine öffentliche Bildvorschau bereit. Lade das Titelbild bitte direkt hoch.", 422);
        }
        return null;
      }
      const validatedImageUrl = await validatePublicUrl(imageUrl);
      if (appUrl.protocol === "https:" && validatedImageUrl.protocol !== "https:") return null;
      return validatedImageUrl.toString();
    } catch (error) {
      if (error instanceof PreviewError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new PreviewError("Die Rezeptseite hat nicht rechtzeitig geantwortet.", 504);
      }
      throw new PreviewError("Die Rezeptseite konnte nicht sicher geladen werden.", 502);
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.headers.get("Origin") !== appUrl.origin) {
    return respond({ error: "Origin is not allowed." }, 403);
  }
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const accessToken = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return respond({ error: "Sign in before resolving a recipe link." }, 401);
  const { data: authData, error: authError } = await adminClient.auth.getUser(accessToken);
  if (authError || !authData.user) return respond({ error: "Your session is invalid or expired." }, 401);
  let body: unknown;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return respond({ error: "The recipe link request is too large." }, 413);
  }
  try {
    body = await request.json();
  } catch {
    return respond({ error: "The request must contain valid JSON." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return respond({ error: "A recipe ID is required." }, 400);
  }
  const recipeId = "recipe_id" in body && typeof body.recipe_id === "string" ? body.recipe_id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recipeId)) {
    return respond({ error: "A valid recipe ID is required." }, 400);
  }

  const { data: recipe, error: recipeError } = await adminClient
    .from("recipes")
    .select("id, household_id, source_url, image_url")
    .eq("id", recipeId)
    .maybeSingle();
  if (recipeError) {
    console.error("Could not load recipe for image lookup.", recipeError);
    return respond({ error: "The recipe could not be loaded." }, 500);
  }
  if (!recipe) return respond({ error: "The recipe was not found." }, 404);

  const { data: membership, error: membershipError } = await adminClient
    .from("household_members")
    .select("user_id")
    .eq("household_id", recipe.household_id)
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Could not verify household membership for recipe image lookup.", membershipError);
    return respond({ error: "Household membership could not be verified." }, 500);
  }
  if (!membership) return respond({ error: "Join a household before adding recipe links." }, 403);
  if (!recipe.source_url) return respond({ image_url: null });
  if (recipe.image_url) return respond({ image_url: recipe.image_url });

  try {
    const imageUrl = await resolveImage(recipe.source_url);
    if (!imageUrl) return respond({ image_url: null });

    const { data: updatedRecipe, error: updateError } = await adminClient
      .from("recipes")
      .update({ image_url: imageUrl })
      .eq("id", recipeId)
      .eq("source_url", recipe.source_url)
      .select("id")
      .maybeSingle();
    if (updateError) {
      console.error("Could not save recipe image URL.", updateError);
      return respond({ error: "The recipe image could not be saved." }, 500);
    }
    if (!updatedRecipe) return respond({ error: "The recipe link changed during image lookup." }, 409);

    return respond({ image_url: imageUrl });
  } catch (error) {
    const previewError = error instanceof PreviewError
      ? error
      : new PreviewError("Das Titelbild konnte nicht ermittelt werden.", 502);
    return respond({ error: previewError.message }, previewError.status);
  }
});
