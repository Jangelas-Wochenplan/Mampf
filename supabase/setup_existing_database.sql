-- Consolidated setup for an existing Mampf database.
-- The household, recipe, and meal-plan tables must already exist.

do $preflight$
begin
  if to_regclass('public.recipes') is null
    or to_regclass('public.meal_plans') is null
    or to_regclass('public.meal_plan_days') is null
    or to_regprocedure('public.save_recipe(jsonb,uuid)') is null
    or to_regprocedure('public.save_meal_plan(date,jsonb,jsonb)') is null
  then
    raise exception 'Apply the initial Mampf schema before this consolidated setup.';
  end if;
end
$preflight$;

alter table public.recipes
  add column if not exists category text not null default '';

do $category_constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.recipes'::regclass
      and conname = 'recipes_category_check'
  ) then
    alter table public.recipes
      add constraint recipes_category_check check (length(category) <= 50);
  end if;
end
$category_constraint$;

create table if not exists public.recipe_ratings (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (recipe_id, user_id)
);

alter table public.recipe_ratings enable row level security;
grant select, insert, update on public.recipe_ratings to authenticated;

drop policy if exists recipe_ratings_read_member on public.recipe_ratings;
create policy recipe_ratings_read_member on public.recipe_ratings
  for select to authenticated
  using (public.is_recipe_member(recipe_id));

drop policy if exists recipe_ratings_insert_own_member on public.recipe_ratings;
create policy recipe_ratings_insert_own_member on public.recipe_ratings
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_recipe_member(recipe_id)
  );

drop policy if exists recipe_ratings_update_own_member on public.recipe_ratings;
create policy recipe_ratings_update_own_member on public.recipe_ratings
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_recipe_member(recipe_id)
  )
  with check (
    user_id = (select auth.uid())
    and public.is_recipe_member(recipe_id)
  );

alter table public.recipes
  add column if not exists source_url text not null default '',
  add column if not exists image_url text;

do $recipe_link_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.recipes'::regclass
      and conname = 'recipes_source_url_check'
  ) then
    alter table public.recipes
      add constraint recipes_source_url_check
      check (length(source_url) <= 2048 and (source_url = '' or source_url ~* '^https?://'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.recipes'::regclass
      and conname = 'recipes_image_url_check'
  ) then
    alter table public.recipes
      add constraint recipes_image_url_check
      check (image_url is null or (length(image_url) <= 2048 and image_url ~* '^https?://'));
  end if;
end
$recipe_link_constraints$;

create or replace function public.save_recipe_with_category(
  recipe_payload jsonb,
  target_recipe_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_recipe_id uuid;
  new_source_url text := btrim(coalesce(recipe_payload ->> 'source_url', ''));
begin
  saved_recipe_id := public.save_recipe(recipe_payload, target_recipe_id);

  update public.recipes
  set category = btrim(coalesce(recipe_payload ->> 'category', '')),
      source_url = new_source_url,
      image_url = case
        when public.recipes.source_url is distinct from new_source_url then null
        else public.recipes.image_url
      end
  where id = saved_recipe_id;

  return saved_recipe_id;
end;
$$;

revoke all on function public.save_recipe_with_category(jsonb, uuid) from public, anon;
grant execute on function public.save_recipe_with_category(jsonb, uuid) to authenticated;
revoke insert, update on public.recipes from authenticated;

create or replace function public.delete_recipe_and_update_plans(
  target_recipe_id uuid,
  plans_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_household_id uuid;
  affected_plan_count integer;
  plan_record record;
  plan_start_date date;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select household_id into current_household_id
  from public.household_members
  where user_id = current_user_id;
  if current_household_id is null then
    raise exception 'Household membership required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.recipes
    where id = target_recipe_id and household_id = current_household_id
  ) then
    raise exception 'Recipe not found in your household' using errcode = 'P0002';
  end if;

  if jsonb_typeof(plans_payload) is distinct from 'array' then
    raise exception 'Affected meal plans are required' using errcode = '22023';
  end if;

  select count(*) into affected_plan_count
  from public.meal_plans meal_plan
  where meal_plan.household_id = current_household_id
    and exists (
      select 1
      from public.meal_plan_days plan_day
      where plan_day.plan_id = meal_plan.id
        and plan_day.recipe_id = target_recipe_id
    );

  if jsonb_array_length(plans_payload) <> affected_plan_count
    or (
      select count(distinct value ->> 'start_date')
      from jsonb_array_elements(plans_payload)
    ) <> affected_plan_count
  then
    raise exception 'All affected meal plans must be refreshed' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.meal_plans meal_plan
    where meal_plan.household_id = current_household_id
      and exists (
        select 1
        from public.meal_plan_days plan_day
        where plan_day.plan_id = meal_plan.id
          and plan_day.recipe_id = target_recipe_id
      )
      and not exists (
        select 1
        from jsonb_array_elements(plans_payload) payload
        where payload.value ->> 'start_date' = meal_plan.start_date::text
      )
  ) or exists (
    select 1
    from jsonb_array_elements(plans_payload) payload
    where not exists (
      select 1
      from public.meal_plans meal_plan
      where meal_plan.household_id = current_household_id
        and meal_plan.start_date::text = payload.value ->> 'start_date'
        and exists (
          select 1
          from public.meal_plan_days plan_day
          where plan_day.plan_id = meal_plan.id
            and plan_day.recipe_id = target_recipe_id
        )
    )
  ) then
    raise exception 'Meal plan list does not match the affected plans' using errcode = '22023';
  end if;

  for plan_record in select value from jsonb_array_elements(plans_payload)
  loop
    if jsonb_typeof(plan_record.value -> 'days_payload') is distinct from 'array'
      or jsonb_typeof(plan_record.value -> 'shopping_payload') is distinct from 'array'
    then
      raise exception 'Each affected plan needs days and a shopping list' using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(plan_record.value -> 'days_payload') day_payload
      where day_payload.value ->> 'recipe_id' = target_recipe_id::text
    ) then
      raise exception 'Deleted recipe must be removed from affected days' using errcode = '22023';
    end if;

    plan_start_date := (plan_record.value ->> 'start_date')::date;
    perform public.save_meal_plan(
      plan_start_date,
      plan_record.value -> 'days_payload',
      plan_record.value -> 'shopping_payload'
    );
  end loop;

  delete from public.recipes
  where id = target_recipe_id and household_id = current_household_id;
end;
$$;

revoke all on function public.delete_recipe_and_update_plans(uuid, jsonb) from public, anon;
grant execute on function public.delete_recipe_and_update_plans(uuid, jsonb) to authenticated;
revoke delete on public.recipes from authenticated;

notify pgrst, 'reload schema';

do $seed$
declare
  household_count integer;
  target_household_id uuid;
  owner_user_id uuid;
  recipe jsonb;
  examples jsonb := $recipes$[
    {"title":"Spaghetti Bolognese","description":"Der italienische Familienklassiker mit Tomatensauce.","category":"Familienklassiker","prep_minutes":35,"servings":4,"emoji":"🍝","ingredients":[{"name":"Spaghetti","quantity":400,"unit":"g"},{"name":"Rinderhackfleisch","quantity":400,"unit":"g"},{"name":"Zwiebel","quantity":1,"unit":"Stück"},{"name":"Passierte Tomaten","quantity":500,"unit":"ml"},{"name":"Tomatenmark","quantity":2,"unit":"EL"},{"name":"Parmesan","quantity":40,"unit":"g"},{"name":"Olivenöl","quantity":1,"unit":"EL"}],"steps":[{"instruction":"Zwiebel würfeln. Öl erhitzen und Hackfleisch mit Zwiebel krümelig anbraten.","ingredients":[{"ingredient_index":1,"quantity":400,"unit":"g"},{"ingredient_index":2,"quantity":1,"unit":"Stück"},{"ingredient_index":6,"quantity":1,"unit":"EL"}]},{"instruction":"Tomatenmark kurz rösten, passierte Tomaten zugeben und die Sauce 20 Minuten köcheln lassen.","ingredients":[{"ingredient_index":3,"quantity":500,"unit":"ml"},{"ingredient_index":4,"quantity":2,"unit":"EL"}]},{"instruction":"Spaghetti in Salzwasser bissfest kochen und abgießen.","ingredients":[{"ingredient_index":0,"quantity":400,"unit":"g"}]},{"instruction":"Mit Sauce anrichten und Parmesan darüberreiben.","ingredients":[{"ingredient_index":0,"quantity":400,"unit":"g"},{"ingredient_index":5,"quantity":40,"unit":"g"}]}]},
    {"title":"Kichererbsen-Curry mit Basmatireis","description":"Cremiges Curry mit Kokosmilch und frischem Spinat.","category":"Vegetarisch","prep_minutes":30,"servings":4,"emoji":"🍛","ingredients":[{"name":"Basmatireis","quantity":300,"unit":"g"},{"name":"Kichererbsen","quantity":2,"unit":"Dose"},{"name":"Kokosmilch","quantity":400,"unit":"ml"},{"name":"Currypaste","quantity":2,"unit":"EL"},{"name":"Zwiebel","quantity":1,"unit":"Stück"},{"name":"Babyspinat","quantity":150,"unit":"g"},{"name":"Pflanzenöl","quantity":1,"unit":"EL"}],"steps":[{"instruction":"Reis nach Packungsanleitung garen.","ingredients":[{"ingredient_index":0,"quantity":300,"unit":"g"}]},{"instruction":"Zwiebel würfeln und in Öl glasig anbraten. Currypaste kurz mitrösten.","ingredients":[{"ingredient_index":4,"quantity":1,"unit":"Stück"},{"ingredient_index":6,"quantity":1,"unit":"EL"},{"ingredient_index":3,"quantity":2,"unit":"EL"}]},{"instruction":"Kichererbsen und Kokosmilch zugeben und 15 Minuten köcheln lassen.","ingredients":[{"ingredient_index":1,"quantity":2,"unit":"Dose"},{"ingredient_index":2,"quantity":400,"unit":"ml"}]},{"instruction":"Spinat unterheben und mit Reis servieren.","ingredients":[{"ingredient_index":5,"quantity":150,"unit":"g"},{"ingredient_index":0,"quantity":300,"unit":"g"}]}]},
    {"title":"Ofenkartoffeln mit Kräuterquark","description":"Knusprige Kartoffeln mit frischem Schnittlauchquark.","category":"Lieblingsessen","prep_minutes":45,"servings":4,"emoji":"🥔","ingredients":[{"name":"Kartoffeln","quantity":800,"unit":"g"},{"name":"Magerquark","quantity":500,"unit":"g"},{"name":"Schmand","quantity":100,"unit":"g"},{"name":"Schnittlauch","quantity":1,"unit":"Bund"},{"name":"Zitrone","quantity":1,"unit":"Stück"},{"name":"Olivenöl","quantity":2,"unit":"EL"}],"steps":[{"instruction":"Backofen auf 220 °C vorheizen. Kartoffeln waschen, halbieren und auf ein Blech legen.","ingredients":[{"ingredient_index":0,"quantity":800,"unit":"g"}]},{"instruction":"Kartoffeln mit Öl, Salz und Pfeffer mischen und etwa 35 Minuten goldbraun backen.","ingredients":[{"ingredient_index":5,"quantity":2,"unit":"EL"}]},{"instruction":"Quark und Schmand verrühren. Schnittlauch schneiden und unterheben.","ingredients":[{"ingredient_index":1,"quantity":500,"unit":"g"},{"ingredient_index":2,"quantity":100,"unit":"g"},{"ingredient_index":3,"quantity":1,"unit":"Bund"}]},{"instruction":"Quark mit Zitronensaft abschmecken und mit den Kartoffeln servieren.","ingredients":[{"ingredient_index":4,"quantity":1,"unit":"Stück"}]}]},
    {"title":"Hähnchen-Fajita-Wraps","description":"Bunte Wraps mit würziger Hähnchen-Paprika-Pfanne.","category":"Schnell & einfach","prep_minutes":30,"servings":4,"emoji":"🌮","ingredients":[{"name":"Hähnchenbrust","quantity":500,"unit":"g"},{"name":"Paprika","quantity":2,"unit":"Stück"},{"name":"Zwiebel","quantity":1,"unit":"Stück"},{"name":"Weizentortillas","quantity":4,"unit":"Stück"},{"name":"Naturjoghurt","quantity":150,"unit":"g"},{"name":"Limette","quantity":1,"unit":"Stück"},{"name":"Pflanzenöl","quantity":1,"unit":"EL"}],"steps":[{"instruction":"Hähnchen und Gemüse in Streifen schneiden.","ingredients":[{"ingredient_index":0,"quantity":500,"unit":"g"},{"ingredient_index":1,"quantity":2,"unit":"Stück"},{"ingredient_index":2,"quantity":1,"unit":"Stück"}]},{"instruction":"Öl erhitzen. Hähnchen anbraten, Gemüse zugeben und bissfest garen.","ingredients":[{"ingredient_index":6,"quantity":1,"unit":"EL"},{"ingredient_index":0,"quantity":500,"unit":"g"},{"ingredient_index":1,"quantity":2,"unit":"Stück"},{"ingredient_index":2,"quantity":1,"unit":"Stück"}]},{"instruction":"Joghurt mit Limettensaft verrühren und würzen.","ingredients":[{"ingredient_index":4,"quantity":150,"unit":"g"},{"ingredient_index":5,"quantity":1,"unit":"Stück"}]},{"instruction":"Tortillas erwärmen, füllen und mit Limettenjoghurt servieren.","ingredients":[{"ingredient_index":3,"quantity":4,"unit":"Stück"},{"ingredient_index":4,"quantity":150,"unit":"g"}]}]},
    {"title":"Ofenlachs mit Brokkoli und Kartoffeln","description":"Ein unkompliziertes Blechgericht mit Zitrone und zartem Lachs.","category":"Sonntagsessen","prep_minutes":40,"servings":4,"emoji":"🐟","ingredients":[{"name":"Lachsfilet","quantity":4,"unit":"Stück"},{"name":"Kartoffeln","quantity":600,"unit":"g"},{"name":"Brokkoli","quantity":1,"unit":"Kopf"},{"name":"Zitrone","quantity":1,"unit":"Stück"},{"name":"Olivenöl","quantity":2,"unit":"EL"}],"steps":[{"instruction":"Backofen auf 200 °C vorheizen. Kartoffeln würfeln, mit Öl mischen und 15 Minuten backen.","ingredients":[{"ingredient_index":1,"quantity":600,"unit":"g"},{"ingredient_index":4,"quantity":2,"unit":"EL"}]},{"instruction":"Brokkoli in Röschen teilen, zu den Kartoffeln geben und weitere 10 Minuten backen.","ingredients":[{"ingredient_index":2,"quantity":1,"unit":"Kopf"}]},{"instruction":"Lachs und Zitronenscheiben auf das Blech legen und etwa 12 Minuten fertig garen.","ingredients":[{"ingredient_index":0,"quantity":4,"unit":"Stück"},{"ingredient_index":3,"quantity":1,"unit":"Stück"}]},{"instruction":"Lachs mit Kartoffeln und Brokkoli anrichten.","ingredients":[{"ingredient_index":0,"quantity":4,"unit":"Stück"},{"ingredient_index":2,"quantity":1,"unit":"Kopf"}]}]},
    {"title":"Linsen-Bolognese","description":"Herzhafte vegetarische Tomatensauce mit roten Linsen.","category":"Vegetarisch","prep_minutes":35,"servings":4,"emoji":"🍝","ingredients":[{"name":"Spaghetti","quantity":400,"unit":"g"},{"name":"Rote Linsen","quantity":200,"unit":"g"},{"name":"Passierte Tomaten","quantity":500,"unit":"ml"},{"name":"Zwiebel","quantity":1,"unit":"Stück"},{"name":"Möhren","quantity":2,"unit":"Stück"},{"name":"Gemüsebrühe","quantity":300,"unit":"ml"}],"steps":[{"instruction":"Zwiebel und Möhren fein würfeln und in etwas Öl anschwitzen.","ingredients":[{"ingredient_index":3,"quantity":1,"unit":"Stück"},{"ingredient_index":4,"quantity":2,"unit":"Stück"}]},{"instruction":"Linsen, Tomaten und Brühe zugeben und etwa 20 Minuten köcheln lassen.","ingredients":[{"ingredient_index":1,"quantity":200,"unit":"g"},{"ingredient_index":2,"quantity":500,"unit":"ml"},{"ingredient_index":5,"quantity":300,"unit":"ml"}]},{"instruction":"Spaghetti in Salzwasser bissfest kochen und abgießen.","ingredients":[{"ingredient_index":0,"quantity":400,"unit":"g"}]},{"instruction":"Linsen-Bolognese mit Spaghetti vermengen und servieren.","ingredients":[{"ingredient_index":0,"quantity":400,"unit":"g"},{"ingredient_index":1,"quantity":200,"unit":"g"}]}]},
    {"title":"Käsespätzle mit Röstzwiebeln","description":"Würzige Spätzle mit geschmolzenem Käse und knusprigen Zwiebeln.","category":"Familienklassiker","prep_minutes":25,"servings":4,"emoji":"🧀","ingredients":[{"name":"Spätzle","quantity":600,"unit":"g"},{"name":"Bergkäse, gerieben","quantity":200,"unit":"g"},{"name":"Zwiebel","quantity":2,"unit":"Stück"},{"name":"Butter","quantity":2,"unit":"EL"},{"name":"Gemischter Salat","quantity":150,"unit":"g"}],"steps":[{"instruction":"Spätzle nach Packungsanleitung garen und abgießen.","ingredients":[{"ingredient_index":0,"quantity":600,"unit":"g"}]},{"instruction":"Zwiebeln in Ringe schneiden und in Butter goldbraun braten.","ingredients":[{"ingredient_index":2,"quantity":2,"unit":"Stück"},{"ingredient_index":3,"quantity":2,"unit":"EL"}]},{"instruction":"Spätzle und Käse abwechselnd in eine Pfanne geben und schmelzen lassen.","ingredients":[{"ingredient_index":0,"quantity":600,"unit":"g"},{"ingredient_index":1,"quantity":200,"unit":"g"}]},{"instruction":"Mit Röstzwiebeln und frischem Salat servieren.","ingredients":[{"ingredient_index":2,"quantity":2,"unit":"Stück"},{"ingredient_index":4,"quantity":150,"unit":"g"}]}]},
    {"title":"Tomaten-Mozzarella-Pasta","description":"Schnelle Pasta mit Kirschtomaten, Mozzarella und Basilikum.","category":"Schnell & einfach","prep_minutes":25,"servings":4,"emoji":"🍅","ingredients":[{"name":"Penne","quantity":400,"unit":"g"},{"name":"Kirschtomaten","quantity":300,"unit":"g"},{"name":"Mozzarella","quantity":2,"unit":"Stück"},{"name":"Basilikum","quantity":1,"unit":"Bund"},{"name":"Knoblauch","quantity":2,"unit":"Zehe"},{"name":"Olivenöl","quantity":2,"unit":"EL"}],"steps":[{"instruction":"Penne in Salzwasser bissfest kochen und etwas Nudelwasser auffangen.","ingredients":[{"ingredient_index":0,"quantity":400,"unit":"g"}]},{"instruction":"Tomaten halbieren, Knoblauch hacken und beides in Olivenöl kurz anbraten.","ingredients":[{"ingredient_index":1,"quantity":300,"unit":"g"},{"ingredient_index":4,"quantity":2,"unit":"Zehe"},{"ingredient_index":5,"quantity":2,"unit":"EL"}]},{"instruction":"Penne und etwas Nudelwasser zu den Tomaten geben und durchschwenken.","ingredients":[{"ingredient_index":0,"quantity":400,"unit":"g"},{"ingredient_index":1,"quantity":300,"unit":"g"}]},{"instruction":"Mozzarella zupfen, mit Basilikum unterheben und sofort servieren.","ingredients":[{"ingredient_index":2,"quantity":2,"unit":"Stück"},{"ingredient_index":3,"quantity":1,"unit":"Bund"}]}]},
    {"title":"Chili sin Carne mit Reis","description":"Würziges Bohnen-Chili mit Mais und lockerem Reis.","category":"Vegetarisch","prep_minutes":35,"servings":4,"emoji":"🌶️","ingredients":[{"name":"Kidneybohnen","quantity":2,"unit":"Dose"},{"name":"Mais","quantity":1,"unit":"Dose"},{"name":"Gehackte Tomaten","quantity":400,"unit":"g"},{"name":"Paprika","quantity":1,"unit":"Stück"},{"name":"Zwiebel","quantity":1,"unit":"Stück"},{"name":"Basmatireis","quantity":300,"unit":"g"},{"name":"Chilipulver","quantity":1,"unit":"TL"}],"steps":[{"instruction":"Reis nach Packungsanleitung garen.","ingredients":[{"ingredient_index":5,"quantity":300,"unit":"g"}]},{"instruction":"Zwiebel und Paprika würfeln und in etwas Öl anbraten.","ingredients":[{"ingredient_index":4,"quantity":1,"unit":"Stück"},{"ingredient_index":3,"quantity":1,"unit":"Stück"}]},{"instruction":"Bohnen und Mais abspülen. Mit Tomaten und Chili 20 Minuten köcheln lassen.","ingredients":[{"ingredient_index":0,"quantity":2,"unit":"Dose"},{"ingredient_index":1,"quantity":1,"unit":"Dose"},{"ingredient_index":2,"quantity":400,"unit":"g"},{"ingredient_index":6,"quantity":1,"unit":"TL"}]},{"instruction":"Chili abschmecken und mit Reis servieren.","ingredients":[{"ingredient_index":5,"quantity":300,"unit":"g"}]}]},
    {"title":"Shakshuka mit Fladenbrot","description":"Eier in würziger Tomaten-Paprika-Sauce direkt aus der Pfanne.","category":"Ausprobieren","prep_minutes":30,"servings":4,"emoji":"🍳","ingredients":[{"name":"Eier","quantity":6,"unit":"Stück"},{"name":"Gehackte Tomaten","quantity":800,"unit":"g"},{"name":"Paprika","quantity":1,"unit":"Stück"},{"name":"Zwiebel","quantity":1,"unit":"Stück"},{"name":"Knoblauch","quantity":2,"unit":"Zehe"},{"name":"Fladenbrot","quantity":300,"unit":"g"},{"name":"Paprikapulver","quantity":1,"unit":"TL"}],"steps":[{"instruction":"Zwiebel und Paprika würfeln, Knoblauch hacken und in etwas Öl anbraten.","ingredients":[{"ingredient_index":3,"quantity":1,"unit":"Stück"},{"ingredient_index":2,"quantity":1,"unit":"Stück"},{"ingredient_index":4,"quantity":2,"unit":"Zehe"}]},{"instruction":"Tomaten und Paprikapulver zugeben und die Sauce 10 Minuten köcheln lassen.","ingredients":[{"ingredient_index":1,"quantity":800,"unit":"g"},{"ingredient_index":6,"quantity":1,"unit":"TL"}]},{"instruction":"Mulden in die Sauce drücken, Eier hineinschlagen und zugedeckt stocken lassen.","ingredients":[{"ingredient_index":0,"quantity":6,"unit":"Stück"}]},{"instruction":"Shakshuka mit warmem Fladenbrot servieren.","ingredients":[{"ingredient_index":5,"quantity":300,"unit":"g"}]}]}
  ]$recipes$::jsonb;
begin
  select count(*) into household_count from public.households;
  if household_count <> 1 then
    raise exception 'This seed expects exactly one household; select a target household explicitly.';
  end if;

  select member.household_id, member.user_id
  into target_household_id, owner_user_id
  from public.household_members member
  where member.role = 'owner'
  limit 1;
  if target_household_id is null or owner_user_id is null then
    raise exception 'The household owner could not be found.';
  end if;

  perform set_config('request.jwt.claim.sub', owner_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  for recipe in select value from jsonb_array_elements(examples)
  loop
    if not exists (
      select 1
      from public.recipes existing
      where existing.household_id = target_household_id
        and lower(existing.title) = lower(recipe ->> 'title')
    ) then
      perform public.save_recipe_with_category(recipe, null);
    end if;
  end loop;
end
$seed$;
