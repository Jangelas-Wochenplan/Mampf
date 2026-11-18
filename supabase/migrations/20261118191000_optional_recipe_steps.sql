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
