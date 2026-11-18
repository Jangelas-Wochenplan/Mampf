alter table public.recipes
  add column category text not null default ''
  check (length(category) <= 50);

create table public.recipe_ratings (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (recipe_id, user_id)
);

alter table public.recipe_ratings enable row level security;
grant select, insert, update on public.recipe_ratings to authenticated;

create policy recipe_ratings_read_member on public.recipe_ratings
  for select to authenticated
  using (public.is_recipe_member(recipe_id));

create policy recipe_ratings_insert_own_member on public.recipe_ratings
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_recipe_member(recipe_id)
  );

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
begin
  saved_recipe_id := public.save_recipe(recipe_payload, target_recipe_id);

  update public.recipes
  set category = btrim(coalesce(recipe_payload ->> 'category', ''))
  where id = saved_recipe_id;

  return saved_recipe_id;
end;
$$;

revoke all on function public.save_recipe_with_category(jsonb, uuid) from public, anon;
grant execute on function public.save_recipe_with_category(jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
