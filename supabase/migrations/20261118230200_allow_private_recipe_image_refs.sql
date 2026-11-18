alter table public.recipes
  drop constraint if exists recipes_image_url_check,
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
