import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const appOrigin = Deno.env.get("APP_ORIGIN");

if (!supabaseUrl || !anonKey || !serviceRoleKey || !appOrigin) {
  throw new Error("SUPABASE_URL, an anon/publishable key, SUPABASE_SERVICE_ROLE_KEY, and APP_ORIGIN are required.");
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

const corsHeaders = {
  "Access-Control-Allow-Origin": appUrl.origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  Vary: "Origin",
};
const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const authClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.headers.get("Origin") !== appUrl.origin) {
    return respond({ error: "Origin is not allowed." }, 403);
  }
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return respond({ error: "Login request must contain valid JSON." }, 400);
  }
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    return respond({ error: "Enter a username and password." }, 400);
  }

  const payload = requestBody as { username?: unknown; password?: unknown };
  const username = typeof payload.username === "string" ? payload.username.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,23}$/.test(username) || !password || password.length > 256) {
    return respond({ error: "Invalid username or password." }, 401);
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("email")
    .ilike("username", username)
    .maybeSingle();
  if (profileError) {
    console.error("Could not look up the username.", profileError);
    return respond({ error: "Login is temporarily unavailable." }, 500);
  }
  if (!profile?.email) return respond({ error: "Invalid username or password." }, 401);

  const { data, error: signInError } = await authClient.auth.signInWithPassword({
    email: profile.email,
    password,
  });
  if (signInError || !data.session) {
    return respond({ error: "Invalid username or password." }, 401);
  }

  return respond({ session: data.session });
});
