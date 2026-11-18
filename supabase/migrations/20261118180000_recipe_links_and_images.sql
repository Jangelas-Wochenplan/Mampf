alter table public.recipes
  add column source_url text not null default ''
    check (length(source_url) <= 2048 and (source_url = '' or source_url ~* '^https?://')),
  add column image_url text
    check (image_url is null or (length(image_url) <= 2048 and image_url ~* '^https?://'));

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

notify pgrst, 'reload schema';
