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
