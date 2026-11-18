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

alter table public.meal_plans
  add column if not exists shopping_archived_at timestamptz;

alter table public.shopping_list_items
  add column if not exists is_custom boolean not null default false;

create or replace function public.refresh_shopping_list_archive(target_plan_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if exists (
    select 1 from public.shopping_list_items
    where plan_id = target_plan_id and not checked
  ) then
    update public.meal_plans set shopping_archived_at = null where id = target_plan_id;
  elsif exists (
    select 1 from public.shopping_list_items
    where plan_id = target_plan_id
  ) then
    update public.meal_plans
    set shopping_archived_at = coalesce(shopping_archived_at, now())
    where id = target_plan_id;
  else
    update public.meal_plans set shopping_archived_at = null where id = target_plan_id;
  end if;
end
$function$;

create or replace function public.sync_shopping_list_archive()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_shopping_list_archive(old.plan_id);
    return old;
  end if;

  perform public.refresh_shopping_list_archive(new.plan_id);
  if tg_op = 'UPDATE' and old.plan_id is distinct from new.plan_id then
    perform public.refresh_shopping_list_archive(old.plan_id);
  end if;
  return new;
end
$function$;

drop trigger if exists shopping_list_archive_sync on public.shopping_list_items;
create trigger shopping_list_archive_sync
after insert or update or delete on public.shopping_list_items
for each row execute function public.sync_shopping_list_archive();

update public.meal_plans plan
set shopping_archived_at = coalesce(plan.shopping_archived_at, now())
where exists (
  select 1 from public.shopping_list_items item
  where item.plan_id = plan.id
)
and not exists (
  select 1 from public.shopping_list_items item
  where item.plan_id = plan.id and not item.checked
);

revoke all on function public.save_meal_plan(date, jsonb, jsonb) from public, anon;
create or replace function public.save_meal_plan(
  plan_start_date date,
  days_payload jsonb,
  shopping_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  current_household_id uuid;
  saved_plan_id uuid;
  day_record record;
  shopping_record record;
  custom_sort_offset integer;
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
  if plan_start_date is null or extract(isodow from plan_start_date) <> 1 then
    raise exception 'Meal plans must start on a Monday' using errcode = '22023';
  end if;
  if jsonb_typeof(days_payload) is distinct from 'array'
    or jsonb_typeof(shopping_payload) is distinct from 'array'
  then
    raise exception 'A weekly plan must contain seven days and a shopping list' using errcode = '22023';
  end if;
  if jsonb_array_length(days_payload) <> 7 then
    raise exception 'A weekly plan must contain seven days and a shopping list' using errcode = '22023';
  end if;

  insert into public.meal_plans (household_id, start_date, created_by)
  values (current_household_id, plan_start_date, current_user_id)
  on conflict (household_id, start_date) do update
  set start_date = excluded.start_date
  returning id into saved_plan_id;

  delete from public.meal_plan_days where plan_id = saved_plan_id;
  delete from public.shopping_list_items
  where plan_id = saved_plan_id and not is_custom;
  select coalesce(max(sort_order) + 1, 0) into custom_sort_offset
  from public.shopping_list_items
  where plan_id = saved_plan_id and is_custom;

  for day_record in select value from jsonb_array_elements(days_payload)
  loop
    if (day_record.value ->> 'day_date')::date < plan_start_date
      or (day_record.value ->> 'day_date')::date > plan_start_date + 6
    then
      raise exception 'Plan days must fall within the selected week' using errcode = '22023';
    end if;
    if coalesce((day_record.value ->> 'excluded')::boolean, false)
      and nullif(day_record.value ->> 'recipe_id', '') is not null
    then
      raise exception 'Excluded days cannot contain a recipe' using errcode = '22023';
    end if;
    insert into public.meal_plan_days (plan_id, day_date, excluded, recipe_id)
    values (
      saved_plan_id,
      (day_record.value ->> 'day_date')::date,
      coalesce((day_record.value ->> 'excluded')::boolean, false),
      nullif(day_record.value ->> 'recipe_id', '')::uuid
    );
  end loop;

  for shopping_record in select value from jsonb_array_elements(shopping_payload)
  loop
    if length(btrim(coalesce(shopping_record.value ->> 'name', ''))) = 0 then
      raise exception 'Shopping list items must have a name' using errcode = '22023';
    end if;
    insert into public.shopping_list_items (plan_id, name, quantity, unit, sort_order)
    values (
      saved_plan_id,
      btrim(shopping_record.value ->> 'name'),
      nullif(shopping_record.value ->> 'quantity', '')::numeric,
      coalesce(shopping_record.value ->> 'unit', ''),
      custom_sort_offset + coalesce(nullif(shopping_record.value ->> 'sort_order', '')::integer, 0)
    );
  end loop;

  return saved_plan_id;
end
$function$;

revoke all on function public.refresh_shopping_list_archive(uuid) from public, anon;
revoke all on function public.sync_shopping_list_archive() from public, anon;
grant execute on function public.refresh_shopping_list_archive(uuid) to authenticated;
grant execute on function public.sync_shopping_list_archive() to authenticated;
grant execute on function public.save_meal_plan(date, jsonb, jsonb) to authenticated;

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

  alter table public.recipes
    drop constraint if exists recipes_image_url_check;
  alter table public.recipes
    add constraint recipes_image_url_check
    check (
      image_url is null
      or (
        length(image_url) <= 2048
        and (
          image_url ~* '^https?://'
          or image_url ~ '^storage://recipe-images/[0-9a-f-]{36}/[A-Za-z0-9-]+[.](jpg|png|webp|gif)$'
        )
      )
    );
end
$recipe_link_constraints$;

create or replace function public.save_recipe(recipe_payload jsonb, target_recipe_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_household_id uuid;
  saved_recipe_id uuid;
  ingredient_record record;
  step_record record;
  step_ingredient jsonb;
  ingredient_ids uuid[] := array[]::uuid[];
  ingredient_id uuid;
  step_id uuid;
  ingredient_index integer;
  step_position integer := 0;
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
  if jsonb_typeof(recipe_payload) is distinct from 'object' then
    raise exception 'Recipe payload must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(recipe_payload -> 'ingredients') is distinct from 'array'
    or (
      recipe_payload ? 'steps'
      and jsonb_typeof(recipe_payload -> 'steps') is distinct from 'array'
    )
  then
    raise exception 'Recipe ingredients and optional steps must be arrays' using errcode = '22023';
  end if;
  if jsonb_array_length(recipe_payload -> 'ingredients') = 0
    or length(btrim(coalesce(recipe_payload ->> 'title', ''))) not between 1 and 120
  then
    raise exception 'Recipe title and ingredients are required' using errcode = '22023';
  end if;

  if target_recipe_id is null then
    insert into public.recipes (
      household_id, title, description, prep_minutes, servings, emoji, created_by
    ) values (
      current_household_id,
      btrim(recipe_payload ->> 'title'),
      coalesce(recipe_payload ->> 'description', ''),
      nullif(recipe_payload ->> 'prep_minutes', '')::integer,
      coalesce(nullif(recipe_payload ->> 'servings', '')::integer, 4),
      coalesce(nullif(recipe_payload ->> 'emoji', ''), '🍲'),
      current_user_id
    )
    returning id into saved_recipe_id;
  else
    update public.recipes
    set title = btrim(recipe_payload ->> 'title'),
        description = coalesce(recipe_payload ->> 'description', ''),
        prep_minutes = nullif(recipe_payload ->> 'prep_minutes', '')::integer,
        servings = coalesce(nullif(recipe_payload ->> 'servings', '')::integer, 4),
        emoji = coalesce(nullif(recipe_payload ->> 'emoji', ''), '🍲'),
        updated_at = now()
    where id = target_recipe_id and household_id = current_household_id
    returning id into saved_recipe_id;
    if saved_recipe_id is null then
      raise exception 'Recipe not found in your household' using errcode = 'P0002';
    end if;
    delete from public.recipe_ingredients where recipe_id = saved_recipe_id;
    delete from public.recipe_steps where recipe_id = saved_recipe_id;
  end if;

  for ingredient_record in
    select value
    from jsonb_array_elements(recipe_payload -> 'ingredients') with ordinality as items(value, position)
    order by position
  loop
    if length(btrim(coalesce(ingredient_record.value ->> 'name', ''))) = 0 then
      raise exception 'Ingredient names cannot be empty' using errcode = '22023';
    end if;
    insert into public.recipe_ingredients (recipe_id, name, quantity, unit, sort_order)
    values (
      saved_recipe_id,
      btrim(ingredient_record.value ->> 'name'),
      nullif(ingredient_record.value ->> 'quantity', '')::numeric,
      coalesce(ingredient_record.value ->> 'unit', ''),
      cardinality(ingredient_ids)
    )
    returning id into ingredient_id;
    ingredient_ids := array_append(ingredient_ids, ingredient_id);
  end loop;

  for step_record in
    select value, position
    from jsonb_array_elements(coalesce(recipe_payload -> 'steps', '[]'::jsonb)) with ordinality as items(value, position)
    order by position
  loop
    if length(btrim(coalesce(step_record.value ->> 'instruction', ''))) = 0 then
      raise exception 'Step instructions cannot be empty' using errcode = '22023';
    end if;
    insert into public.recipe_steps (recipe_id, instruction, position)
    values (saved_recipe_id, btrim(step_record.value ->> 'instruction'), step_position)
    returning id into step_id;
    step_position := step_position + 1;

    for step_ingredient in
      select value from jsonb_array_elements(coalesce(step_record.value -> 'ingredients', '[]'::jsonb))
    loop
      ingredient_index := nullif(step_ingredient ->> 'ingredient_index', '')::integer;
      if ingredient_index is null or ingredient_index < 0 or ingredient_index >= cardinality(ingredient_ids) then
        raise exception 'A step references an unknown ingredient' using errcode = '22023';
      end if;
      insert into public.recipe_step_ingredients (
        step_id, recipe_ingredient_id, quantity, unit
      ) values (
        step_id,
        ingredient_ids[ingredient_index + 1],
        nullif(step_ingredient ->> 'quantity', '')::numeric,
        coalesce(step_ingredient ->> 'unit', '')
      );
    end loop;
  end loop;

  return saved_recipe_id;
end;
$$;

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
  recipe_image_path text := nullif(btrim(coalesce(recipe_payload ->> 'recipe_image_path', '')), '');
begin
  if recipe_image_path is not null and (
    recipe_image_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9-]+\.(jpg|png|webp|gif)$'
    or not exists (
      select 1
      from public.household_members hm
      where hm.user_id = (select auth.uid())
        and recipe_image_path like (hm.household_id::text || '/%')
    )
  ) then
    raise exception 'Recipe image path must belong to your household' using errcode = '22023';
  end if;

  saved_recipe_id := public.save_recipe(recipe_payload, target_recipe_id);

  update public.recipes
  set category = btrim(coalesce(recipe_payload ->> 'category', '')),
      source_url = new_source_url,
      image_url = case
        when recipe_image_path is not null
          then 'storage://recipe-images/' || recipe_image_path
        when public.recipes.source_url is distinct from new_source_url
          then null
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
      perform public.save_recipe_with_category(
        recipe || jsonb_build_object('steps', '[]'::jsonb),
        null
      );
    end if;
  end loop;
end
$seed$;

create table if not exists public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  category text not null default '' check (length(category) <= 60),
  barcode text not null default '' check (length(barcode) <= 64),
  quantity numeric(12, 3) not null default 0 check (quantity >= 0),
  unit text not null default '' check (length(unit) <= 40),
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (image_path is null or image_path like (household_id::text || '/%'))
);

alter table public.pantry_items
  add column if not exists category text not null default '' check (length(category) <= 60);

create index if not exists pantry_items_household_name on public.pantry_items (household_id, lower(name));
create index if not exists pantry_items_household_category on public.pantry_items (household_id, category);
create unique index if not exists pantry_items_household_barcode on public.pantry_items (household_id, barcode)
  where barcode <> '';

alter table public.pantry_items enable row level security;
grant select, insert, update, delete on public.pantry_items to authenticated;

drop policy if exists pantry_items_member_access on public.pantry_items;
create policy pantry_items_member_access on public.pantry_items
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create or replace function public.add_pantry_stock(
  p_item_id uuid,
  p_quantity numeric,
  p_name text,
  p_category text,
  p_barcode text,
  p_unit text,
  p_image_path text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Added pantry quantity must be greater than zero' using errcode = '22023';
  end if;

  update public.pantry_items as item
  set name = p_name,
      category = coalesce(p_category, ''),
      barcode = coalesce(p_barcode, ''),
      quantity = item.quantity + p_quantity,
      unit = coalesce(p_unit, ''),
      image_path = p_image_path,
      updated_at = now()
  where item.id = p_item_id
  returning item.id into updated_id;

  if updated_id is null then
    raise exception 'Pantry item was not found or is inaccessible' using errcode = 'P0002';
  end if;

  return updated_id;
end
$function$;

revoke all on function public.add_pantry_stock(uuid, numeric, text, text, text, text, text) from public, anon;
grant execute on function public.add_pantry_stock(uuid, numeric, text, text, text, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pantry-images',
  'pantry-images',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = false,
    file_size_limit = 8388608,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists pantry_images_member_access on storage.objects;
create policy pantry_images_member_access on storage.objects
  for all to authenticated
  using (
    bucket_id = 'pantry-images'
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id::text = (storage.foldername(name))[1]
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'pantry-images'
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id::text = (storage.foldername(name))[1]
        and hm.user_id = (select auth.uid())
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-images',
  'recipe-images',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = false,
    file_size_limit = 8388608,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists recipe_images_member_access on storage.objects;
create policy recipe_images_member_access on storage.objects
  for all to authenticated
  using (
    bucket_id = 'recipe-images'
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id::text = (storage.foldername(name))[1]
        and hm.user_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'recipe-images'
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id::text = (storage.foldername(name))[1]
        and hm.user_id = (select auth.uid())
    )
  );

notify pgrst, 'reload schema';
