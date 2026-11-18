alter table public.household_invitations
  alter column email drop not null;

alter table public.household_invitations
  add column accepted_by uuid references auth.users(id) on delete set null;

drop index if exists public.household_invitations_pending_email;

create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null check (username ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{2,23}$'),
  created_at timestamptz not null default now()
);

create unique index profiles_username_case_insensitive
  on public.profiles (lower(username));

create unique index profiles_email_case_insensitive
  on public.profiles (lower(email));

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert, delete on public.profiles to service_role;

create table public.owner_setup_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.owner_setup_invitations enable row level security;
revoke all on public.owner_setup_invitations from public, anon, authenticated;
grant select, insert, update, delete on public.owner_setup_invitations to service_role;

create or replace function public.create_owner_setup_invite()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if exists (select 1 from public.households)
    or exists (
      select 1 from public.owner_setup_invitations
      where accepted_at is not null
    )
  then
    raise exception 'The initial owner setup has already been completed' using errcode = '23505';
  end if;

  delete from public.owner_setup_invitations where accepted_at is null;
  insert into public.owner_setup_invitations (token_hash, expires_at)
  values (
    encode(extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'), 'hex'),
    now() + interval '7 days'
  );
  return raw_token;
end;
$$;

revoke all on function public.create_owner_setup_invite() from public, anon, authenticated, service_role;

create or replace function public.claim_owner_setup_invite(
  invite_token_hash text,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.owner_setup_invitations%rowtype;
begin
  if target_user_id is null
    or invite_token_hash is null
    or invite_token_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Owner setup link is invalid or expired' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.user_id = target_user_id and lower(p.username) = 'jan'
  ) then
    raise exception 'The initial owner username must be Jan' using errcode = '22023';
  end if;

  if exists (select 1 from public.households)
    or exists (select 1 from public.household_members)
  then
    raise exception 'The initial owner setup has already been completed' using errcode = '23505';
  end if;

  select * into invitation
  from public.owner_setup_invitations oi
  where oi.token_hash = invite_token_hash
    and oi.expires_at > now()
    and oi.accepted_at is null
  for update;

  if not found then
    raise exception 'Owner setup link is invalid, expired, or already used' using errcode = '22023';
  end if;

  update public.owner_setup_invitations
  set accepted_at = now(), accepted_by = target_user_id
  where id = invitation.id;
end;
$$;

revoke all on function public.claim_owner_setup_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_owner_setup_invite(text, uuid) to service_role;

create or replace function public.accept_household_invite(invite_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  invitation public.household_invitations%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if invite_token_hash is null or invite_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation is invalid or expired' using errcode = '22023';
  end if;

  select * into invitation
  from public.household_invitations hi
  where hi.token_hash = invite_token_hash
    and hi.expires_at > now()
    and hi.accepted_at is null
  for update;

  if not found then
    raise exception 'Invitation is invalid, expired, or already used' using errcode = '22023';
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
  set accepted_at = now(), accepted_by = current_user_id
  where id = invitation.id;
  return invitation.household_id;
end;
$$;

create or replace function public.accept_household_invite_for_user(
  invite_token_hash text,
  target_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.household_invitations%rowtype;
begin
  if target_user_id is null
    or invite_token_hash is null
    or invite_token_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Invitation is invalid or expired' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p where p.user_id = target_user_id
  ) then
    raise exception 'User profile is missing' using errcode = '23503';
  end if;

  select * into invitation
  from public.household_invitations hi
  where hi.token_hash = invite_token_hash
    and hi.expires_at > now()
    and hi.accepted_at is null
  for update;

  if not found then
    raise exception 'Invitation is invalid, expired, or already used' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.household_members hm
    where hm.user_id = target_user_id
  ) then
    raise exception 'This account already belongs to a household' using errcode = '23505';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (invitation.household_id, target_user_id, 'member');

  update public.household_invitations
  set accepted_at = now(), accepted_by = target_user_id
  where id = invitation.id;

  return invitation.household_id;
end;
$$;

revoke all on function public.accept_household_invite_for_user(text, uuid) from public, anon, authenticated;
grant execute on function public.accept_household_invite_for_user(text, uuid) to service_role;

notify pgrst, 'reload schema';
