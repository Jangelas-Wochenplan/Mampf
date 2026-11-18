create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz
);

create unique index household_invitations_pending_email
  on public.household_invitations (household_id, lower(email))
  where accepted_at is null;

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '',
  prep_minutes integer check (prep_minutes is null or prep_minutes > 0),
  servings integer not null default 4 check (servings between 1 and 100),
  emoji text not null default '🍲',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  quantity numeric(12, 3) check (quantity is null or quantity >= 0),
  unit text not null default '',
  sort_order integer not null default 0
);

create table public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  instruction text not null check (length(btrim(instruction)) > 0),
  position integer not null check (position >= 0),
  unique (recipe_id, position)
);

create table public.recipe_step_ingredients (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.recipe_steps(id) on delete cascade,
  recipe_ingredient_id uuid not null references public.recipe_ingredients(id) on delete cascade,
  quantity numeric(12, 3) check (quantity is null or quantity >= 0),
  unit text not null default ''
);

create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  start_date date not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (household_id, start_date)
);

create table public.meal_plan_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.meal_plans(id) on delete cascade,
  day_date date not null,
  excluded boolean not null default false,
  recipe_id uuid references public.recipes(id) on delete set null,
  unique (plan_id, day_date),
  check (not excluded or recipe_id is null)
);

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.meal_plans(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  quantity numeric(12, 3) check (quantity is null or quantity >= 0),
  unit text not null default '',
  checked boolean not null default false,
  sort_order integer not null default 0
);

create index recipes_household_created on public.recipes (household_id, created_at desc);
create index meal_plans_household_start on public.meal_plans (household_id, start_date desc);
create index meal_plan_days_date_recipe on public.meal_plan_days (day_date, recipe_id);
create index recipe_ingredients_recipe_order on public.recipe_ingredients (recipe_id, sort_order);
create index recipe_steps_recipe_order on public.recipe_steps (recipe_id, position);
create index shopping_list_plan_order on public.shopping_list_items (plan_id, sort_order);

create or replace function public.validate_recipe_step_ingredient()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  step_recipe_id uuid;
  ingredient_recipe_id uuid;
begin
  select recipe_id into step_recipe_id from public.recipe_steps where id = new.step_id;
  select recipe_id into ingredient_recipe_id from public.recipe_ingredients where id = new.recipe_ingredient_id;
  if step_recipe_id is null or ingredient_recipe_id is null or step_recipe_id <> ingredient_recipe_id then
    raise exception 'Step ingredients must belong to the same recipe' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger recipe_step_ingredient_same_recipe
  before insert or update on public.recipe_step_ingredients
  for each row execute function public.validate_recipe_step_ingredient();

create or replace function public.validate_meal_plan_day_recipe()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  plan_household_id uuid;
  recipe_household_id uuid;
begin
  if new.recipe_id is null then return new; end if;
  select household_id into plan_household_id from public.meal_plans where id = new.plan_id;
  select household_id into recipe_household_id from public.recipes where id = new.recipe_id;
  if plan_household_id is null or recipe_household_id is null or plan_household_id <> recipe_household_id then
    raise exception 'The meal must use a recipe from the plan household' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger meal_plan_day_same_household
  before insert or update on public.meal_plan_days
  for each row execute function public.validate_meal_plan_day_recipe();

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_household_owner(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
      and hm.role = 'owner'
  );
$$;

create or replace function public.is_plan_member(target_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.meal_plans mp
    where mp.id = target_plan_id
      and public.is_household_member(mp.household_id)
  );
$$;

create or replace function public.is_recipe_member(target_recipe_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.recipes r
    where r.id = target_recipe_id
      and public.is_household_member(r.household_id)
  );
$$;

create or replace function public.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_household_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if exists (select 1 from public.household_members where user_id = current_user_id) then
    raise exception 'You already belong to a household' using errcode = '23505';
  end if;
  if household_name is null or length(btrim(household_name)) not between 1 and 80 then
    raise exception 'Household name must be between 1 and 80 characters' using errcode = '22023';
  end if;

  insert into public.households (name, created_by)
  values (btrim(household_name), current_user_id)
  returning id into new_household_id;
  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, current_user_id, 'owner');
  return new_household_id;
end;
$$;

create or replace function public.accept_household_invite(invite_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_email text;
  invitation public.household_invitations%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if invite_token_hash is null or invite_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation is invalid or expired' using errcode = '22023';
  end if;

  select lower(u.email) into current_email
  from auth.users u
  where u.id = current_user_id;

  select * into invitation
  from public.household_invitations hi
  where hi.token_hash = invite_token_hash
    and lower(hi.email) = current_email
    and hi.expires_at > now()
    and hi.accepted_at is null
  for update;

  if not found then
    raise exception 'Invitation is invalid, expired, or for another account' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.household_members hm
    where hm.user_id = current_user_id
      and hm.household_id <> invitation.household_id
  ) then
    raise exception 'This account already belongs to another household' using errcode = '23505';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (invitation.household_id, current_user_id, 'member')
  on conflict (household_id, user_id) do nothing;
  update public.household_invitations
  set accepted_at = now()
  where id = invitation.id;
  return invitation.household_id;
end;
$$;

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
    or jsonb_typeof(recipe_payload -> 'steps') is distinct from 'array'
  then
    raise exception 'Recipe title, ingredients, and steps are required' using errcode = '22023';
  end if;
  if jsonb_array_length(recipe_payload -> 'ingredients') = 0
    or jsonb_array_length(recipe_payload -> 'steps') = 0
    or length(btrim(coalesce(recipe_payload ->> 'title', ''))) not between 1 and 120
  then
    raise exception 'Recipe title, ingredients, and steps are required' using errcode = '22023';
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
    from jsonb_array_elements(recipe_payload -> 'steps') with ordinality as items(value, position)
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

create or replace function public.save_meal_plan(
  plan_start_date date,
  days_payload jsonb,
  shopping_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_household_id uuid;
  saved_plan_id uuid;
  day_record record;
  shopping_record record;
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
  delete from public.shopping_list_items where plan_id = saved_plan_id;

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
      coalesce(nullif(shopping_record.value ->> 'sort_order', '')::integer, 0)
    );
  end loop;

  return saved_plan_id;
end;
$$;

revoke all on function public.is_household_member(uuid) from public, anon;
revoke all on function public.is_household_owner(uuid) from public, anon;
revoke all on function public.is_plan_member(uuid) from public, anon;
revoke all on function public.is_recipe_member(uuid) from public, anon;
revoke all on function public.create_household(text) from public, anon;
revoke all on function public.accept_household_invite(text) from public, anon;
revoke all on function public.save_recipe(jsonb, uuid) from public, anon;
revoke all on function public.save_meal_plan(date, jsonb, jsonb) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;
grant execute on function public.is_plan_member(uuid) to authenticated;
grant execute on function public.is_recipe_member(uuid) to authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;
grant execute on function public.save_recipe(jsonb, uuid) to authenticated;
grant execute on function public.save_meal_plan(date, jsonb, jsonb) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invitations enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps enable row level security;
alter table public.recipe_step_ingredients enable row level security;
alter table public.meal_plans enable row level security;
alter table public.meal_plan_days enable row level security;
alter table public.shopping_list_items enable row level security;

revoke all on public.household_invitations from anon, authenticated;
grant select on public.households, public.household_members to authenticated;
grant select, insert, delete on public.household_invitations to service_role;
grant select, insert, update, delete on public.recipes to authenticated;
grant select, insert, update, delete on public.recipe_ingredients, public.recipe_steps, public.recipe_step_ingredients to authenticated;
grant select, insert, update, delete on public.meal_plans, public.meal_plan_days, public.shopping_list_items to authenticated;

create policy households_read_member on public.households
  for select to authenticated using (public.is_household_member(id));

create policy household_members_read_household on public.household_members
  for select to authenticated using (public.is_household_member(household_id));

create policy recipes_read_member on public.recipes
  for select to authenticated using (public.is_household_member(household_id));
create policy recipes_insert_member on public.recipes
  for insert to authenticated with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
create policy recipes_update_member on public.recipes
  for update to authenticated using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy recipes_delete_member on public.recipes
  for delete to authenticated using (public.is_household_member(household_id));

create policy recipe_ingredients_member_access on public.recipe_ingredients
  for all to authenticated
  using (public.is_recipe_member(recipe_id))
  with check (public.is_recipe_member(recipe_id));
create policy recipe_steps_member_access on public.recipe_steps
  for all to authenticated
  using (public.is_recipe_member(recipe_id))
  with check (public.is_recipe_member(recipe_id));
create policy recipe_step_ingredients_member_access on public.recipe_step_ingredients
  for all to authenticated
  using (
    exists (
      select 1 from public.recipe_steps rs
      where rs.id = step_id and public.is_recipe_member(rs.recipe_id)
    )
  )
  with check (
    exists (
      select 1 from public.recipe_steps rs
      where rs.id = step_id and public.is_recipe_member(rs.recipe_id)
    )
  );

create policy meal_plans_read_member on public.meal_plans
  for select to authenticated using (public.is_household_member(household_id));
create policy meal_plans_insert_member on public.meal_plans
  for insert to authenticated
  with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
create policy meal_plans_update_member on public.meal_plans
  for update to authenticated using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy meal_plans_delete_member on public.meal_plans
  for delete to authenticated using (public.is_household_member(household_id));
create policy meal_plan_days_member_access on public.meal_plan_days
  for all to authenticated
  using (public.is_plan_member(plan_id))
  with check (public.is_plan_member(plan_id));
create policy shopping_list_items_member_access on public.shopping_list_items
  for all to authenticated
  using (public.is_plan_member(plan_id))
  with check (public.is_plan_member(plan_id));

notify pgrst, 'reload schema';
