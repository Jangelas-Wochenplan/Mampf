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
    update public.meal_plans
    set shopping_archived_at = null
    where id = target_plan_id;
  elsif exists (
    select 1 from public.shopping_list_items
    where plan_id = target_plan_id
  ) then
    update public.meal_plans
    set shopping_archived_at = coalesce(shopping_archived_at, now())
    where id = target_plan_id;
  else
    update public.meal_plans
    set shopping_archived_at = null
    where id = target_plan_id;
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

notify pgrst, 'reload schema';
