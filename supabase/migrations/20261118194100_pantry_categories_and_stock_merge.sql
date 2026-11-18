alter table public.pantry_items
  add column if not exists category text not null default '' check (length(category) <= 60);

create index if not exists pantry_items_household_category
  on public.pantry_items (household_id, category);

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

notify pgrst, 'reload schema';
