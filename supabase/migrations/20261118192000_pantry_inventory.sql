create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  barcode text not null default '' check (length(barcode) <= 64),
  quantity numeric(12, 3) not null default 0 check (quantity >= 0),
  unit text not null default '' check (length(unit) <= 40),
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (image_path is null or image_path like (household_id::text || '/%'))
);

create index pantry_items_household_name on public.pantry_items (household_id, lower(name));
create unique index pantry_items_household_barcode on public.pantry_items (household_id, barcode)
  where barcode <> '';

alter table public.pantry_items enable row level security;
grant select, insert, update, delete on public.pantry_items to authenticated;

drop policy if exists pantry_items_member_access on public.pantry_items;
create policy pantry_items_member_access on public.pantry_items
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

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

notify pgrst, 'reload schema';
