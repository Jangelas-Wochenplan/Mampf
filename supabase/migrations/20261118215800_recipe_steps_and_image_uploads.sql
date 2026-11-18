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
