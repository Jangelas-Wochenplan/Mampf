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

## GitHub Pages deployment

The workflow in `.github/workflows/deploy-pages.yml` builds and deploys the app to GitHub Pages whenever changes reach `main`. In **Repository → Settings → Pages**, select **GitHub Actions** as the build and deployment source.

Add these repository variables under **Settings → Secrets and variables → Actions → Variables** before deployment:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

These are public browser configuration values, not secrets. The site is served at `https://jangelas-wochenplan.github.io/Mampf/`; Supabase authentication and row-level security protect household data. The Vite build uses relative asset paths so it works from the repository subpath.

## Supabase setup

1. Create a Supabase project and configure the two public runtime variables above in the app environment.
2. Keep public sign-ups disabled in **Authentication → Settings → User Signups**. The app creates accounts only through one-time owner setup and household invitation links.
3. Link the Supabase CLI to the new project and apply the database migrations:

   ```sh
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   This is for a fresh project. For an existing Mampf database initialized manually, use the consolidated script `supabase/setup_existing_database.sql` in the SQL Editor. Do not run `supabase db push` until the migration history is reconciled; the CLI may try to recreate tables that already exist.

   The consolidated script includes the optional example recipes, skips recipes with matching titles, and expects exactly one household.

4. In Supabase **Authentication → URL Configuration**, set the site URL to `https://jangelas-wochenplan.github.io/Mampf/` and allow `https://jangelas-wochenplan.github.io/Mampf/**` as a redirect URL. Configure email delivery if you want to use password-reset emails; household invitations are shared manually and do not send email.
5. Set the Edge Functions' server-side `APP_ORIGIN` secret to the app URL, including `/Mampf/`, and deploy the account, invitation, and recipe-image functions:

   ```sh
   supabase secrets set APP_ORIGIN=https://jangelas-wochenplan.github.io/Mampf/
   supabase functions deploy invite-household-member
   supabase functions deploy login-with-username
   supabase functions deploy complete-household-registration
   supabase functions deploy resolve-recipe-image
   ```

   For local development, `APP_ORIGIN` may use `http://localhost:<port>/`. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. The service-role key is never sent to the browser.
6. In the Supabase SQL Editor, create Jan's one-time setup link:

   ```sql
   select 'https://jangelas-wochenplan.github.io/Mampf/?owner_setup='
     || public.create_owner_setup_invite() as setup_url;
   ```

   Open the returned link privately. The registration form fixes the username to `Jan` and lets Jan enter an email address and choose a password. The link can be used once, expires after seven days, and can only be generated before a household has been created. After registration, create the household in the app; Jan becomes its owner.
7. As Jan, use **Mitglied einladen** to generate a one-time link and share it manually. The invited person chooses their email, username, and password while registering. These links are stored as hashes, expire after seven days, and can be used once. RLS policies restrict household data to its members.

The migrations create the household, profile, invitation, recipe, meal-plan, shopping-list, and pantry schema. Recipes support optional categories, one editable star rating per household member, and an external recipe link. Cooking mode provides a portion-adjustable ingredient checklist; preparation steps are no longer shown, and legacy step data is retained in the database but removed when a recipe is next saved. Household members can track pantry quantities, barcodes, and photos; photos use a private Supabase Storage bucket, and pantry amounts are compared against the weekly shopping list with matching metric units converted. The comparison shows how much is already available and the remaining amount to buy; creating a plan does not automatically change pantry quantities. Barcode scanning uses the browser's `BarcodeDetector` API where available, with manual barcode entry as a fallback. The profile flyout provides the Meeresbrise design and a locally saved light/dark mode toggle. When saving a recipe, the `resolve-recipe-image` Edge Function checks a public recipe page for an Open Graph, Twitter, or direct image to use as its cover. Deploy it with the other functions above. Recipe and plan edits are committed through database functions so their related rows are saved atomically. GitHub Pages hosts the static app; Supabase must be configured separately for authentication and shared data.
