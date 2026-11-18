# Mampf

Mampf is a private, invite-only dinner planner for one shared household. Members can manage the same recipe book and weekly plans, generate a consolidated shopping list, and follow recipes in a focused cooking mode.

## Local development

1. Install Node.js 20.19 or newer, 22.12 or newer, or 24 or newer.
2. Copy `.env.example` to `.env` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The publishable key is browser-safe; never put a Supabase service-role key in the frontend or commit local environment files.
3. Install dependencies and start Vite:

   ```sh
   npm install
   npm run dev
   ```

4. Run the focused logic tests and production build:

   ```sh
   npm test
   npm run build
   ```

Vite explicitly exposes only `VITE_` and `NEXT_PUBLIC_` variables to the browser. The supplied Supabase variables are used without renaming them.

## Supabase setup

1. Create a Supabase project and configure the two public runtime variables above in the app environment.
2. Disable public sign-ups in **Authentication → Settings → User Signups**, then create the first household owner account in **Authentication → Users**. Additional accounts are created from household invitations.
3. Link the Supabase CLI to the new project and apply the database migration:

   ```sh
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

4. In Supabase **Authentication → URL Configuration**, set the app's site URL and allow the app origin as a redirect URL (including the household-invitation query parameters). Configure email delivery and the invitation email template for the app's origin.
5. Set the invitation function's server-side `APP_ORIGIN` secret and deploy the function:

   ```sh
   supabase secrets set APP_ORIGIN=https://<your-app-origin>
   supabase functions deploy invite-household-member
   ```

   For local development, `APP_ORIGIN` may use `http://localhost:<port>`. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. The invitation function validates the caller as a household owner; the service-role key is never sent to the browser.
6. Sign in as the initial owner, create the household, then invite other members by email. New accounts receive an email invitation; for an existing Mampf account, share the generated one-time link. Invitation tokens are random, stored only as hashes, expire after seven days, and can be accepted only by the invited email account. RLS policies restrict household data to its members.

The migration creates the household, invitation, recipe, meal-plan, and shopping-list schema. Recipe and plan edits are committed through database functions so their related rows are saved atomically. No production hosting provider is assumed by this repository.
