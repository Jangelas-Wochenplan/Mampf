import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const appOrigin = Deno.env.get("APP_ORIGIN");

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
if (!appUrl.pathname.endsWith("/")) appUrl.pathname = `${appUrl.pathname}/`;

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

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.headers.get("Origin") !== appUrl.origin) {
    return respond({ error: "Origin is not allowed." }, 403);
  }
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const accessToken = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return respond({ error: "Sign in before inviting a household member." }, 401);

  const { data: authData, error: authError } = await adminClient.auth.getUser(accessToken);
  if (authError || !authData.user) return respond({ error: "Your session is invalid or expired." }, 401);

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return respond({ error: "Invitation request must contain valid JSON." }, 400);
  }
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    return respond({ error: "Invitation request must contain an email address and household." }, 400);
  }
  const payload = requestBody as { email?: unknown; household_id?: unknown };
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const householdId = typeof payload.household_id === "string" ? payload.household_id : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !householdId) {
    return respond({ error: "Enter a valid email address." }, 400);
  }

  const { data: membership, error: membershipError } = await adminClient
    .from("household_members")
    .select("role")
    .eq("household_id", householdId)
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Could not verify household invitation permissions.", membershipError);
    return respond({ error: "Household permissions could not be verified." }, 500);
  }
  if (membership?.role !== "owner") {
    return respond({ error: "Only the household owner can invite new members." }, 403);
  }

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const tokenHashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(tokenHashBuffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  const { error: previousInviteError } = await adminClient
    .from("household_invitations")
    .delete()
    .eq("household_id", householdId)
    .eq("email", email)
    .is("accepted_at", null);
  if (previousInviteError) {
    console.error("Could not replace the previous household invitation.", previousInviteError);
    return respond({ error: "Could not prepare a new household invitation." }, 500);
  }

  const { error: insertError } = await adminClient.from("household_invitations").insert({
    household_id: householdId,
    email,
    token_hash: tokenHash,
    invited_by: authData.user.id,
  });
  if (insertError) {
    console.error("Could not save household invitation.", insertError);
    if (insertError.code === "23505") {
      return respond({ error: "An open invitation for this email already exists." }, 409);
    }
    return respond({ error: "Could not create the household invitation." }, 500);
  }

  const emailInvitationUrl = new URL(appUrl);
  emailInvitationUrl.searchParams.set("household_invite", token);
  emailInvitationUrl.searchParams.set("set_password", "true");
  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: emailInvitationUrl.toString(),
  });
  if (inviteError) {
    if (/already registered|already exists/i.test(inviteError.message)) {
      const invitationUrl = new URL(appUrl);
      invitationUrl.searchParams.set("household_invite", token);
      return respond({ sent: false, invite_url: invitationUrl.toString() });
    }
    const { error: cleanupError } = await adminClient
      .from("household_invitations")
      .delete()
      .eq("token_hash", tokenHash);
    if (cleanupError) console.error("Could not remove a failed household invitation.", cleanupError);
    console.error("Could not send household invitation email.", inviteError);
    return respond({ error: "The invitation email could not be sent. Check Supabase Auth email settings." }, 502);
  }

  return respond({ sent: true });
});
