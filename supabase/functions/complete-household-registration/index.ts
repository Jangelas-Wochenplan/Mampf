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

async function removeUser(userId: string) {
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) console.error("Could not remove an account whose registration failed.", error);
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
    return respond({ error: "Registration request must contain valid JSON." }, 400);
  }
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    return respond({ error: "Enter the invitation, email, username, and password." }, 400);
  }

  const payload = requestBody as {
    invitation_token?: unknown;
    owner_setup_token?: unknown;
    email?: unknown;
    username?: unknown;
    password?: unknown;
  };
  const invitationToken = typeof payload.invitation_token === "string" ? payload.invitation_token : "";
  const ownerSetupToken = typeof payload.owner_setup_token === "string" ? payload.owner_setup_token : "";
  const isOwnerSetup = ownerSetupToken.length > 0;
  const token = isOwnerSetup ? ownerSetupToken : invitationToken;
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const username = typeof payload.username === "string" ? payload.username.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    (isOwnerSetup && invitationToken.length > 0)
  ) {
    return respond({ error: "This invitation link is invalid, expired, or already used." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return respond({ error: "Enter a valid email address." }, 400);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,23}$/.test(username)) {
    return respond({ error: "Username must be 3-24 characters using letters, numbers, dot, dash, or underscore." }, 400);
  }
  if (isOwnerSetup && username.toLowerCase() !== "jan") {
    return respond({ error: "The initial owner username must be Jan." }, 400);
  }
  if (password.length < 8 || password.length > 256) {
    return respond({ error: "Password must be 8-256 characters." }, 400);
  }

  const tokenHashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(tokenHashBuffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  const invitationTable = isOwnerSetup ? "owner_setup_invitations" : "household_invitations";
  const { data: invitation, error: invitationError } = await adminClient
    .from(invitationTable)
    .select("id")
    .eq("token_hash", tokenHash)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (invitationError) {
    console.error("Could not validate the registration link.", invitationError);
    return respond({ error: "Could not validate this registration link." }, 500);
  }
  if (!invitation) return respond({ error: "This invitation link is invalid, expired, or already used." }, 400);

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (createError || !created.user) {
    const usernameConflict = createError?.message.includes("profiles_username_case_insensitive") ?? false;
    if (createError?.code === "23505" || /already registered|already exists/i.test(createError?.message ?? "")) {
      return respond({
        error: usernameConflict
          ? "That username is already in use."
          : "That email address is already registered. Sign in with that account or use another email.",
      }, 409);
    }
    console.error("Could not create invited account.", createError);
    return respond({ error: "Could not create the account." }, 500);
  }

  const { error: profileError } = await adminClient.from("profiles").insert({
    user_id: created.user.id,
    email,
    username,
  });
  if (profileError) {
    await removeUser(created.user.id);
    if (profileError.code === "23505") {
      return respond({ error: "That email address or username is already in use." }, 409);
    }
    console.error("Could not create invited user profile.", profileError);
    return respond({ error: "Could not finish setting up the account." }, 500);
  }

  const { error: acceptError } = isOwnerSetup
    ? await adminClient.rpc("claim_owner_setup_invite", {
      invite_token_hash: tokenHash,
      target_user_id: created.user.id,
    })
    : await adminClient.rpc("accept_household_invite_for_user", {
      invite_token_hash: tokenHash,
      target_user_id: created.user.id,
    });
  if (acceptError) {
    await removeUser(created.user.id);
    if (acceptError.code === "23505" || acceptError.code === "22023") {
      return respond({
        error: isOwnerSetup
          ? "This setup link is no longer valid or the initial owner has already been created."
          : "This invitation is no longer valid or this account already belongs to a household.",
      }, 409);
    }
    console.error("Could not complete the registration link.", acceptError);
    return respond({ error: "Could not finish setting up the account." }, 500);
  }

  const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email, password });
  if (signInError || !signInData.session) {
    console.error("Account was created but automatic sign-in failed.", signInError);
    return respond({ registered: true });
  }

  return respond({ registered: true, session: signInData.session });
});
