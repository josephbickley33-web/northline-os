-- =====================================================================
-- Northline SaaS migration 001: multi-tenancy, trials, invites, billing state,
-- platform super-admin, leads and alerts.
--
-- Apply AFTER supabase/schema.sql (deploy.sh always runs schema.sql, then every file in
-- supabase/migrations/ in order, in one request). Safe to run more than once:
--   * new tables/columns use IF NOT EXISTS
--   * existing rows with no organisation are moved into the default org "Northline (demo)"
--   * constraints are swapped only when the old one is still present
--   * every function is CREATE OR REPLACE and every policy is dropped and recreated
-- Existing auth users, profiles and business data are kept.
-- =====================================================================

-- ------------------------------------------------------------ organisations
create table if not exists public.organisations (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(name) between 2 and 120),
  slug                    text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  plan                    text not null default 'trial' check (plan in ('trial','starter','professional','enterprise')),
  status                  text not null default 'trial' check (status in ('trial','active','past_due','cancelled')),
  trial_ends_at           timestamptz default (now() + interval '14 days'),
  vehicle_limit           integer check (vehicle_limit is null or vehicle_limit >= 0),
  brand_colour            text not null default '#0f9d9a' check (brand_colour ~ '^#[0-9a-fA-F]{6}$'),
  logo_url                text check (logo_url is null or (logo_url ~ '^https://' and length(logo_url) <= 500)),
  stripe_customer_id      text,
  stripe_subscription_id  text,
  billing_email           text,
  created_by              uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- The default organisation that owns everything created before multi-tenancy.
insert into public.organisations(id, name, slug, plan, status, trial_ends_at, vehicle_limit)
values ('00000000-0000-4000-8000-000000000001', 'Northline (demo)', 'northline-demo', 'enterprise', 'active', null, 500)
on conflict (id) do nothing;

-- Platform super-admins (the product owner). Not readable or writable by clients.
create table if not exists public.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Staff invites. Token is the secret part of the invite link.
create table if not exists public.org_invites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  email        text,
  role         text not null default 'driver' check (role in ('admin','duty','planner','workshop','warehouse','driver')),
  token        text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '14 days'),
  accepted_by  uuid references auth.users(id) on delete set null,
  accepted_at  timestamptz,
  revoked      boolean not null default false
);

-- Sales-site "Book a demo" requests. Anonymous visitors may insert; nobody can read except the platform admin (via function).
create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (length(name) between 1 and 120),
  company     text check (company is null or length(company) <= 160),
  email       text not null check (length(email) between 3 and 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone       text check (phone is null or length(phone) <= 40),
  fleet_size  text check (fleet_size is null or length(fleet_size) <= 40),
  message     text check (message is null or length(message) <= 2000),
  source      text check (source is null or length(source) <= 60),
  handled     boolean not null default false
);

-- ------------------------------------------------- org_id on every business table
alter table public.profiles add column if not exists org_id uuid references public.organisations(id) on delete set null;

do $$ declare t text; begin
  foreach t in array array['depots','vehicles','drivers_hours','jobs','stock_items','stock_movements','board_channels',
    'board_posts','board_replies','info_articles','ai_models','ai_decisions','audit_log'] loop
    execute format('alter table public.%I add column if not exists org_id uuid references public.organisations(id) on delete cascade', t);
  end loop;
end $$;

-- One-off backfill: move every pre-existing row into the default org. Recorded in
-- schema_migrations so a re-run never sweeps later org-less sign-ups into the default org.
create table if not exists public.schema_migrations (id text primary key, applied_at timestamptz not null default now());
alter table public.schema_migrations enable row level security;

do $$ declare t text; begin
  if not exists (select 1 from public.schema_migrations where id = '001_backfill') then
    foreach t in array array['profiles','depots','vehicles','drivers_hours','jobs','stock_items','stock_movements','board_channels',
      'board_posts','board_replies','info_articles','ai_models','ai_decisions'] loop
      execute format('update public.%I set org_id = %L where org_id is null', t, '00000000-0000-4000-8000-000000000001');
    end loop;
    -- audit_log is append-only (trigger); lift that for this one-off backfill only, last,
    -- so the audit rows written by the updates above are included.
    alter table public.audit_log disable trigger audit_log_no_change;
    update public.audit_log set org_id = '00000000-0000-4000-8000-000000000001' where org_id is null;
    alter table public.audit_log enable trigger audit_log_no_change;
    -- The founding admin(s) of the original single-company system become platform super-admins.
    insert into public.platform_admins(user_id)
      select id from public.profiles
       where role = 'admin' and active and org_id = '00000000-0000-4000-8000-000000000001'
    on conflict do nothing;
    insert into public.schema_migrations(id) values ('001_backfill');
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['depots','vehicles','drivers_hours','jobs','stock_items','stock_movements','board_channels',
    'board_posts','board_replies','info_articles','ai_models','ai_decisions'] loop
    execute format('alter table public.%I alter column org_id set not null', t);
  end loop;
end $$;

-- ------------------------------------------- per-organisation uniqueness (swap keys)
do $$
begin
  -- board_posts -> board_channels FK must go before the channel PK changes
  if exists (select 1 from pg_constraint where conname='board_posts_channel_id_fkey') then
    alter table public.board_posts drop constraint board_posts_channel_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname='ai_decisions_model_fkey') then
    alter table public.ai_decisions drop constraint ai_decisions_model_fkey;
  end if;

  if exists (select 1 from pg_constraint where conname='depots_pkey' and pg_get_constraintdef(oid) = 'PRIMARY KEY (code)') then
    alter table public.depots drop constraint depots_pkey;
    alter table public.depots add constraint depots_pkey primary key (org_id, code);
  end if;
  if exists (select 1 from pg_constraint where conname='board_channels_pkey' and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') then
    alter table public.board_channels drop constraint board_channels_pkey;
    alter table public.board_channels add constraint board_channels_pkey primary key (org_id, id);
  end if;
  if exists (select 1 from pg_constraint where conname='info_articles_pkey' and pg_get_constraintdef(oid) = 'PRIMARY KEY (slug)') then
    alter table public.info_articles drop constraint info_articles_pkey;
    alter table public.info_articles add constraint info_articles_pkey primary key (org_id, slug);
  end if;
  if exists (select 1 from pg_constraint where conname='ai_models_pkey' and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') then
    alter table public.ai_models drop constraint ai_models_pkey;
    alter table public.ai_models add constraint ai_models_pkey primary key (org_id, id);
  end if;

  if exists (select 1 from pg_constraint where conname='vehicles_reg_key') then
    alter table public.vehicles drop constraint vehicles_reg_key;
  end if;
  if not exists (select 1 from pg_constraint where conname='vehicles_org_reg_key') then
    alter table public.vehicles add constraint vehicles_org_reg_key unique (org_id, reg);
  end if;
  if exists (select 1 from pg_constraint where conname='jobs_ref_key') then
    alter table public.jobs drop constraint jobs_ref_key;
  end if;
  if not exists (select 1 from pg_constraint where conname='jobs_org_ref_key') then
    alter table public.jobs add constraint jobs_org_ref_key unique (org_id, ref);
  end if;
  if exists (select 1 from pg_constraint where conname='stock_items_sku_depot_key') then
    alter table public.stock_items drop constraint stock_items_sku_depot_key;
  end if;
  if not exists (select 1 from pg_constraint where conname='stock_items_org_sku_depot_key') then
    alter table public.stock_items add constraint stock_items_org_sku_depot_key unique (org_id, sku, depot);
  end if;
  if exists (select 1 from pg_constraint where conname='drivers_hours_driver_name_day_key') then
    alter table public.drivers_hours drop constraint drivers_hours_driver_name_day_key;
  end if;
  if not exists (select 1 from pg_constraint where conname='drivers_hours_org_driver_day_key') then
    alter table public.drivers_hours add constraint drivers_hours_org_driver_day_key unique (org_id, driver_name, day);
  end if;

  if not exists (select 1 from pg_constraint where conname='board_posts_org_channel_fkey') then
    alter table public.board_posts add constraint board_posts_org_channel_fkey
      foreign key (org_id, channel_id) references public.board_channels(org_id, id) on delete cascade;
  end if;
end $$;

create index if not exists profiles_org_idx on public.profiles(org_id);
create index if not exists vehicles_org_idx on public.vehicles(org_id);
create index if not exists jobs_org_idx on public.jobs(org_id);
create index if not exists stock_org_idx on public.stock_items(org_id);
create index if not exists hours_org_idx on public.drivers_hours(org_id);
create index if not exists posts_org_idx on public.board_posts(org_id, created_at desc);
create index if not exists replies_org_idx on public.board_replies(org_id);
create index if not exists decisions_org_idx on public.ai_decisions(org_id, status);
create index if not exists audit_org_idx on public.audit_log(org_id, at desc);
create index if not exists moves_org_idx on public.stock_movements(org_id);
create index if not exists invites_org_idx on public.org_invites(org_id);

-- ================================================================ helpers
-- The caller's organisation. For server-side jobs with no signed-in user (seed scripts,
-- migrations) a session setting northline.org_id may supply it; clients cannot set that.
create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select org_id from public.profiles where id = auth.uid()),
    case when auth.uid() is null and current_user not in ('anon','authenticated')
         then nullif(current_setting('northline.org_id', true), '')::uuid end)
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Role helper now also requires the member to belong to an organisation.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active and org_id is not null
$$;

-- Can this organisation still write data? Trial running, paid, or in the payment grace period.
create or replace function public.org_writable(p_org uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select o.status in ('active','past_due') or (o.status = 'trial' and (o.trial_ends_at is null or o.trial_ends_at > now()))
                     from public.organisations o where o.id = coalesce(p_org, public.current_org_id())), false)
$$;

-- Feature gates by plan. Trials get the Professional feature set.
create or replace function public.org_has_feature(p_feature text, p_org uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case p_feature
      when 'ai'           then o.plan in ('trial','professional','enterprise')
      when 'integrations' then o.plan = 'enterprise'
      else true end
    from public.organisations o where o.id = coalesce(p_org, public.current_org_id())), false)
$$;

create or replace function public.slugify(p text) returns text
language sql immutable as $$
  select coalesce(nullif(trim(both '-' from left(regexp_replace(lower(coalesce(p,'')), '[^a-z0-9]+', '-', 'g'), 48)), ''), 'company')
$$;

-- org_id defaults to the caller's organisation, so the app never has to send it.
do $$ declare t text; begin
  foreach t in array array['depots','vehicles','drivers_hours','jobs','stock_items','stock_movements','board_channels',
    'board_posts','board_replies','info_articles','ai_models','ai_decisions'] loop
    execute format('alter table public.%I alter column org_id set default public.current_org_id()', t);
  end loop;
end $$;

-- Child rows take the organisation of their parent row (and RLS then checks it is the caller's).
create or replace function public.inherit_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'board_replies' then
    select org_id into new.org_id from public.board_posts where id = new.post_id;
  elsif tg_table_name = 'stock_movements' then
    select org_id into new.org_id from public.stock_items where id = new.item_id;
  end if;
  return new;
end $$;
drop trigger if exists inherit_org on public.board_replies;
create trigger inherit_org before insert on public.board_replies for each row execute function public.inherit_org();
drop trigger if exists inherit_org on public.stock_movements;
create trigger inherit_org before insert on public.stock_movements for each row execute function public.inherit_org();

-- Nobody moves a row between organisations.
create or replace function public.freeze_org() returns trigger
language plpgsql as $$
begin
  if new.org_id is distinct from old.org_id and coalesce(current_setting('northline.trusted', true), '') <> 'on' then
    raise exception 'Records cannot be moved between organisations';
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['depots','vehicles','drivers_hours','jobs','stock_items','board_channels',
    'board_posts','board_replies','info_articles','ai_models','ai_decisions'] loop
    execute format('drop trigger if exists freeze_org on public.%I', t);
    execute format('create trigger freeze_org before update on public.%I for each row execute function public.freeze_org()', t);
  end loop;
end $$;

-- Vehicle limit per plan (sold vehicles do not count). Upserts of an existing registration are allowed.
create or replace function public.enforce_vehicle_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim integer; used integer;
begin
  select vehicle_limit into lim from public.organisations where id = new.org_id;
  if lim is null then return new; end if;
  if exists (select 1 from public.vehicles where org_id = new.org_id and reg = new.reg) then return new; end if;
  select count(*) into used from public.vehicles where org_id = new.org_id and status <> 'Sold';
  if used >= lim then
    raise exception 'Vehicle limit reached: your plan allows % vehicles. An admin can raise it in Admin, then Billing.', lim
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists enforce_vehicle_limit on public.vehicles;
create trigger enforce_vehicle_limit before insert on public.vehicles for each row execute function public.enforce_vehicle_limit();

-- ----------------------------------------------------------- audit, org-aware
create or replace function public.write_audit_org(p_org uuid, p_action text, p_entity text, p_entity_id text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log(org_id, actor, actor_name, action, entity, entity_id, detail)
  values (p_org, auth.uid(), coalesce(public.actor_name(), 'System'), p_action, p_entity, p_entity_id, p_detail)
$$;

create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  select public.write_audit_org(public.current_org_id(), p_action, p_entity, p_entity_id, p_detail)
$$;

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  key text := coalesce(rec->>'id', rec->>'slug', rec->>'ref', rec->>'reg');
begin
  perform public.write_audit_org(coalesce(nullif(rec->>'org_id','')::uuid,
      case when tg_table_name = 'organisations' then (rec->>'id')::uuid end, public.current_org_id()),
    lower(tg_op) || ' ' || tg_table_name, tg_table_name, key,
    case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)) else rec end);
  return null;
end $$;

-- ------------------------------------------------- organisation provisioning
-- Starter content for a new organisation: board channels, AI model register (copied from the
-- default org's register when present) and the information pages.
create or replace function public.provision_org(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tpl uuid := '00000000-0000-4000-8000-000000000001';
begin
  insert into public.board_channels(org_id, id, name, sort) values
    (p_org,'general','General',1),(p_org,'night','Night operations',2),(p_org,'safety','Safety and compliance',3)
  on conflict do nothing;
  insert into public.ai_models(org_id, id, name, technique, mode, live, locked, gate, owner)
    select p_org, id, name, technique, case when locked then mode else 'Shadow only' end, locked, locked, gate, owner
      from public.ai_models where org_id = tpl
  on conflict do nothing;
  insert into public.info_articles(org_id, slug, title, body, sort)
    select p_org, slug, title, body, sort from public.info_articles where org_id = tpl and slug in ('hours','licence','ai')
  on conflict do nothing;
  insert into public.info_articles(org_id, slug, title, body, sort) values (p_org, 'welcome', 'Getting started',
'Welcome to Northline. Your free trial includes the full Professional feature set for 14 days.

- Add vehicles in Fleet, or import a spreadsheet in Admin, then Data.
- Invite your team in Admin, then Members. Each person gets the role you choose.
- AI models start in shadow mode. Switch one live in Admin, then AI gates, when you are ready.
- Choose a plan in Admin, then Billing, before the trial ends.', 0)
  on conflict do nothing;
end $$;

create or replace function public.unique_slug(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare base text := public.slugify(p_name); s text := base; n int := 1;
begin
  if length(s) < 2 then s := s || '-co'; base := s; end if;
  while exists (select 1 from public.organisations where slug = s) loop
    n := n + 1; s := left(base, 44) || '-' || n;
  end loop;
  return s;
end $$;

create or replace function public.new_trial_org(p_name text, p_owner uuid, p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare oid uuid;
begin
  insert into public.organisations(name, slug, plan, status, trial_ends_at, vehicle_limit, created_by, billing_email)
  values (left(trim(p_name), 120), public.unique_slug(p_name), 'trial', 'trial', now() + interval '14 days', 25, p_owner, p_email)
  returning id into oid;
  perform public.provision_org(oid);
  return oid;
end $$;

-- ---------------------------------------------------------- new sign-ups
-- raw_user_meta_data may carry:
--   invite   : token from an invite link  -> joins that org with the invited role, active
--   org_name : company name ("Start free trial") -> creates a 14-day trial org, user is its admin
--   neither  : account with no organisation (can start a trial or accept an invite later)
-- The very first account on an empty system becomes admin of the default org and platform admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  fname text := coalesce(nullif(meta->>'full_name',''), split_part(coalesce(new.email,''),'@',1));
  inv public.org_invites;
  oid uuid; r text := 'driver'; act boolean := false; ttl text := null; msg text;
begin
  perform pg_advisory_xact_lock(hashtext('northline_bootstrap_admin'));
  if coalesce(meta->>'invite','') <> '' then
    select * into inv from public.org_invites
     where token = meta->>'invite' and not revoked and accepted_at is null and expires_at > now()
       and (email is null or lower(email) = lower(new.email))
     for update;
    if inv.id is not null then
      oid := inv.org_id; r := inv.role; act := true; msg := 'Joined by invite';
      update public.org_invites set accepted_by = new.id, accepted_at = now() where id = inv.id and email is not null;
    end if;
  end if;
  if oid is null and coalesce(trim(meta->>'org_name'),'') <> '' then
    oid := public.new_trial_org(meta->>'org_name', new.id, new.email);
    r := 'admin'; act := true; ttl := 'Founding administrator'; msg := 'Started a free trial';
  end if;
  if oid is null and not exists (select 1 from public.profiles) and not exists (select 1 from public.platform_admins) then
    oid := '00000000-0000-4000-8000-000000000001'; r := 'admin'; act := true; ttl := 'Founding administrator';
    msg := 'First member bootstrapped as admin';
    insert into public.platform_admins(user_id) values (new.id) on conflict do nothing;
  end if;
  insert into public.profiles(id, email, full_name, role, active, title, org_id)
  values (new.id, new.email, fname, r, act, ttl, oid)
  on conflict (id) do nothing;
  insert into public.audit_log(org_id, actor, actor_name, action, entity, entity_id, detail)
  values (oid, new.id, coalesce(new.email,'new user'), coalesce(msg, 'Signed up without an organisation'),
          'profiles', new.id::text, jsonb_build_object('email', new.email));
  return new;
end $$;

-- Signed-in account with no organisation: start a trial now.
create or replace function public.create_organisation(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; oid uuid;
begin
  select * into me from public.profiles where id = auth.uid() for update;
  if me.id is null then raise exception 'Sign in first'; end if;
  if me.org_id is not null then raise exception 'You already belong to an organisation'; end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Enter your company name'; end if;
  oid := public.new_trial_org(p_name, me.id, me.email);
  perform set_config('northline.trusted', 'on', true);
  update public.profiles set org_id = oid, role = 'admin', active = true, title = coalesce(title, 'Founding administrator') where id = me.id;
  perform set_config('northline.trusted', '', true);
  perform public.write_audit_org(oid, 'Started a free trial', 'organisations', oid::text, jsonb_build_object('name', p_name));
  return oid;
end $$;

-- Signed-in account with no organisation: accept an invite link.
create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; inv public.org_invites;
begin
  select * into me from public.profiles where id = auth.uid() for update;
  if me.id is null then raise exception 'Sign in first'; end if;
  if me.org_id is not null then raise exception 'You already belong to an organisation'; end if;
  select * into inv from public.org_invites
   where token = p_token and not revoked and accepted_at is null and expires_at > now() for update;
  if inv.id is null then raise exception 'This invite link is not valid any more. Ask your admin for a new one.'; end if;
  if inv.email is not null and lower(inv.email) <> lower(me.email) then
    raise exception 'This invite was sent to a different email address';
  end if;
  perform set_config('northline.trusted', 'on', true);
  update public.profiles set org_id = inv.org_id, role = inv.role, active = true where id = me.id;
  perform set_config('northline.trusted', '', true);
  if inv.email is not null then update public.org_invites set accepted_by = me.id, accepted_at = now() where id = inv.id; end if;
  perform public.write_audit_org(inv.org_id, 'Joined by invite', 'profiles', me.id::text, jsonb_build_object('email', me.email, 'role', inv.role));
  return inv.org_id;
end $$;

-- Public, minimal invite preview for the sign-up screen (company name and role only).
create or replace function public.invite_preview(p_token text)
returns table(org_name text, role text, email text, brand_colour text, logo_url text)
language sql stable security definer set search_path = public as $$
  select o.name, i.role, i.email, o.brand_colour, o.logo_url from public.org_invites i join public.organisations o on o.id = i.org_id
   where i.token = p_token and not i.revoked and i.accepted_at is null and i.expires_at > now()
$$;

-- Org admins create invites (email-specific or an open link).
create or replace function public.create_invite(p_email text default null, p_role text default 'driver')
returns public.org_invites language plpgsql security definer set search_path = public as $$
declare inv public.org_invites;
begin
  if not public.has_role('admin') then raise exception 'Only an admin can invite staff'; end if;
  if p_role not in ('admin','duty','planner','workshop','warehouse','driver') then raise exception 'Unknown role'; end if;
  insert into public.org_invites(org_id, email, role, created_by)
  values (public.current_org_id(), nullif(lower(trim(coalesce(p_email,''))), ''), p_role, auth.uid())
  returning * into inv;
  perform public.write_audit('Invite created', 'org_invites', inv.id::text, jsonb_build_object('email', inv.email, 'role', inv.role));
  return inv;
end $$;

-- ------------------------------------------------- profile guard, org-aware
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare trusted boolean := coalesce(current_setting('northline.trusted', true), '') = 'on';
begin
  if tg_op = 'UPDATE' then
    if new.org_id is distinct from old.org_id and auth.uid() is not null and not trusted then
      raise exception 'Members cannot be moved between organisations';
    end if;
    if (new.role, new.active, new.email, new.id) is distinct from (old.role, old.active, old.email, old.id)
       and auth.uid() is not null and not trusted and not public.has_role('admin') then
      raise exception 'Only an admin can change role or approval';
    end if;
    if old.role = 'admin' and old.active and old.org_id is not null and not (new.role = 'admin' and new.active)
       and not exists (select 1 from public.profiles where role='admin' and active and id <> old.id and org_id = old.org_id) then
      raise exception 'Cannot remove the last active admin';
    end if;
    return new;
  else
    if old.role = 'admin' and old.active and old.org_id is not null
       and not exists (select 1 from public.profiles where role='admin' and active and id <> old.id and org_id = old.org_id) then
      raise exception 'Cannot remove the last active admin';
    end if;
    return old;
  end if;
end $$;

-- Driver linking stays inside the organisation.
create or replace function public.link_driver() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid; n int;
begin
  if new.driver_id is null and coalesce(new.driver_name,'') <> '' then
    select count(*), min(id::text)::uuid into n, pid from public.profiles
      where org_id = new.org_id and (lower(full_name) = lower(trim(new.driver_name)) or lower(email) = lower(trim(new.driver_name)));
    if n = 1 then new.driver_id := pid; end if;
  elsif new.driver_id is not null then
    if not exists (select 1 from public.profiles where id = new.driver_id and org_id = new.org_id) then
      raise exception 'That driver is not a member of this organisation';
    end if;
    if coalesce(new.driver_name,'') = '' then
      select full_name into new.driver_name from public.profiles where id = new.driver_id;
    end if;
  end if;
  return new;
end $$;

create or replace function public.link_member_records() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.active and new.org_id is not null and coalesce(new.full_name,'') <> '' then
    update public.jobs set driver_id = new.id
      where org_id = new.org_id and driver_id is null and lower(trim(driver_name)) = lower(trim(new.full_name));
    update public.drivers_hours set driver_id = new.id
      where org_id = new.org_id and driver_id is null and lower(trim(driver_name)) = lower(trim(new.full_name));
  end if;
  return null;
end $$;
drop trigger if exists link_member_records on public.profiles;
create trigger link_member_records after insert or update of active, full_name, org_id on public.profiles
  for each row execute function public.link_member_records();

-- AI decisions: only within your organisation, only while the org can write, only with the AI feature.
create or replace function public.decide_ai(p_id bigint, p_decision text, p_note text default null)
returns public.ai_decisions language plpgsql security definer set search_path = public as $$
declare d public.ai_decisions;
begin
  if not public.has_role('admin','duty','planner') then raise exception 'Your role cannot decide AI proposals'; end if;
  if not public.org_writable() then raise exception 'Your trial or subscription has ended. An admin can choose a plan in Admin, then Billing.'; end if;
  if not public.org_has_feature('ai') then raise exception 'AI approvals are included in the Professional and Enterprise plans'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  update public.ai_decisions
     set status = p_decision, approver = auth.uid(), approver_name = public.actor_name(), decided_at = now(), note = p_note
   where id = p_id and status = 'pending' and org_id = public.current_org_id()
   returning * into d;
  if d.id is null then raise exception 'Proposal not found or already decided'; end if;
  perform public.write_audit('AI proposal ' || p_decision, 'ai_decisions', d.id::text,
    jsonb_build_object('subject', d.subject, 'proposal', d.proposal, 'model', d.model,
                       'confidence', d.confidence, 'interval', d.confidence_interval, 'note', p_note));
  return d;
end $$;

-- Remove example rows from YOUR organisation only.
create or replace function public.clear_example_data() returns void
language plpgsql security definer set search_path = public as $$
declare o uuid := public.current_org_id();
begin
  if not public.has_role('admin') then raise exception 'Admins only'; end if;
  delete from public.board_posts where example and org_id = o;
  delete from public.ai_decisions where example and org_id = o;
  delete from public.stock_movements where example and org_id = o;
  delete from public.stock_items where example and org_id = o;
  delete from public.jobs where example and org_id = o;
  delete from public.drivers_hours where example and org_id = o;
  delete from public.vehicles where example and org_id = o;
  delete from public.depots where example and org_id = o
    and code not in (select distinct depot from public.vehicles where depot is not null and org_id = o);
  perform public.write_audit('Cleared example data', null, null, null);
end $$;

-- ----------------------------------------------------- organisation guard
-- Members may only change name, colour and logo. Plan, status, limits and Stripe ids change only
-- through the Stripe webhook (service role) or the platform admin functions.
create or replace function public.guard_org() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated','anon') and coalesce(current_setting('northline.trusted', true), '') <> 'on'
     and (new.id, new.slug, new.plan, new.status, new.trial_ends_at, new.vehicle_limit, new.stripe_customer_id, new.stripe_subscription_id, new.created_by)
         is distinct from (old.id, old.slug, old.plan, old.status, old.trial_ends_at, old.vehicle_limit, old.stripe_customer_id, old.stripe_subscription_id, old.created_by) then
    raise exception 'Plan, status and limits are managed by billing';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_org on public.organisations;
create trigger guard_org before update on public.organisations for each row execute function public.guard_org();
drop trigger if exists audit_organisations on public.organisations;
create trigger audit_organisations after update on public.organisations for each row execute function public.audit_row_change();

-- What the app needs to know about the caller's organisation.
create or replace function public.org_summary()
returns table(id uuid, name text, slug text, plan text, status text, trial_ends_at timestamptz, trial_days_left integer,
              vehicle_limit integer, vehicles_used integer, members integer, brand_colour text, logo_url text,
              writable boolean, has_ai boolean, has_integrations boolean, billing_linked boolean, is_platform_admin boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.slug, o.plan, o.status, o.trial_ends_at,
         case when o.status = 'trial' and o.trial_ends_at is not null
              then greatest(0, ceil(extract(epoch from (o.trial_ends_at - now())) / 86400))::int end,
         o.vehicle_limit,
         (select count(*)::int from public.vehicles v where v.org_id = o.id and v.status <> 'Sold'),
         (select count(*)::int from public.profiles p where p.org_id = o.id and p.active),
         o.brand_colour, o.logo_url, public.org_writable(o.id), public.org_has_feature('ai', o.id),
         public.org_has_feature('integrations', o.id), o.stripe_subscription_id is not null, public.is_platform_admin()
    from public.organisations o where o.id = public.current_org_id()
$$;

-- --------------------------------------------------- platform super-admin
create or replace function public.platform_orgs()
returns table(id uuid, name text, slug text, plan text, status text, trial_ends_at timestamptz, vehicle_limit integer,
              vehicles integer, members integer, admins text, created_at timestamptz, stripe_linked boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Platform admins only'; end if;
  return query
  select o.id, o.name, o.slug, o.plan, o.status, o.trial_ends_at, o.vehicle_limit,
         (select count(*)::int from public.vehicles v where v.org_id = o.id and v.status <> 'Sold'),
         (select count(*)::int from public.profiles p where p.org_id = o.id and p.active),
         (select string_agg(p.email, ', ') from public.profiles p where p.org_id = o.id and p.role = 'admin' and p.active),
         o.created_at, o.stripe_subscription_id is not null
    from public.organisations o order by o.created_at;
end $$;

create or replace function public.platform_update_org(p_org uuid, p_plan text default null, p_status text default null,
  p_trial_ends_at timestamptz default null, p_vehicle_limit integer default null, p_clear_limit boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Platform admins only'; end if;
  perform set_config('northline.trusted', 'on', true);
  update public.organisations set
    plan = coalesce(p_plan, plan), status = coalesce(p_status, status),
    trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at),
    vehicle_limit = case when p_clear_limit then null else coalesce(p_vehicle_limit, vehicle_limit) end
  where id = p_org;
  perform set_config('northline.trusted', '', true);
  perform public.write_audit_org(p_org, 'Platform admin changed plan or status', 'organisations', p_org::text,
    jsonb_build_object('plan', p_plan, 'status', p_status, 'trial_ends_at', p_trial_ends_at, 'vehicle_limit', p_vehicle_limit));
end $$;

create or replace function public.platform_leads()
returns setof public.leads language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Platform admins only'; end if;
  return query select * from public.leads order by created_at desc limit 500;
end $$;

create or replace function public.platform_mark_lead(p_id uuid, p_handled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Platform admins only'; end if;
  update public.leads set handled = p_handled where id = p_id;
end $$;

-- ------------------------------------------------------------------ alerts
-- Computed live for the bell in the app. SECURITY INVOKER: each person only gets alerts for rows
-- their role can already see, inside their own organisation.
create or replace function public.alerts()
returns table(kind text, severity text, title text, detail text, ref text, view text, due date)
language sql stable security invoker set search_path = public as $$
  select 'mot', case when mot_due < current_date then 'bad' else 'watch' end,
         'MOT ' || case when mot_due < current_date then 'overdue' else 'due ' || to_char(mot_due, 'DD Mon') end || ': ' || reg,
         coalesce(type,'') || coalesce(' · ' || depot, ''), reg, 'fleet', mot_due
    from public.vehicles where mot_due is not null and mot_due <= current_date + 30 and status <> 'Sold'
  union all
  select 'stock', case when qty <= 0 then 'bad' else 'watch' end, 'Low stock: ' || name,
         sku || ' at ' || depot || ': ' || qty || ' on hand, reorder at ' || reorder_point, sku, 'stock', null
    from public.stock_items where qty <= reorder_point
  union all
  select 'job', case when status = 'Held' then 'bad' else 'watch' end, 'Job ' || ref || ' ' || lower(status),
         coalesce(customer,'') || coalesce(' · ' || origin || ' → ' || destination, ''), ref, 'command', null
    from public.jobs where status in ('At risk','Held','Late')
  union all
  select 'approval', 'watch', 'Waiting for approval: ' || coalesce(subject, 'AI proposal'), proposal, id::text, 'ai', null
    from public.ai_decisions where status = 'pending'
  union all
  select 'member', 'watch', 'New member waiting: ' || coalesce(nullif(full_name,''), email), email, id::text, 'admin', null
    from public.profiles where not active and org_id is not null and public.has_role('admin')
  union all
  select 'trial', case when s.trial_days_left <= 3 then 'bad' else 'watch' end,
         'Free trial: ' || s.trial_days_left || ' day' || case when s.trial_days_left = 1 then '' else 's' end || ' left',
         'Choose a plan in Admin, then Billing', s.slug, 'admin', null
    from public.org_summary() s where s.status = 'trial' and s.trial_days_left <= 7 and public.has_role('admin')
$$;

-- ============================================================= RLS policies
do $$ declare t text; begin
  foreach t in array array['organisations','platform_admins','org_invites','leads','schema_migrations'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Tenant isolation: RESTRICTIVE policies are ANDed with the role policies from schema.sql,
-- so a row is visible/writable only if the role rule allows it AND it belongs to your org.
do $$ declare t text; begin
  foreach t in array array['depots','vehicles','drivers_hours','jobs','stock_items','stock_movements','board_channels',
    'board_posts','board_replies','info_articles','ai_models','ai_decisions'] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated
      using (org_id = public.current_org_id())
      with check (org_id = public.current_org_id() and public.org_writable())', t);
  end loop;
end $$;

drop policy if exists tenant_isolation on public.profiles;
create policy tenant_isolation on public.profiles as restrictive for all to authenticated
  using (id = auth.uid() or (org_id is not null and org_id = public.current_org_id()))
  with check (id = auth.uid() or (org_id is not null and org_id = public.current_org_id()));

drop policy if exists tenant_isolation on public.audit_log;
create policy tenant_isolation on public.audit_log as restrictive for all to authenticated
  using (org_id = public.current_org_id());

-- Organisations: members read their own; org admins edit name, colour and logo (column grants below).
drop policy if exists org_select on public.organisations;
create policy org_select on public.organisations for select to authenticated
  using (id = public.current_org_id() or public.is_platform_admin());
drop policy if exists org_update on public.organisations;
create policy org_update on public.organisations for update to authenticated
  using (id = public.current_org_id() and public.has_role('admin'))
  with check (id = public.current_org_id() and public.has_role('admin'));

-- Invites: org admins see and revoke their own org's invites. Creation goes through create_invite().
drop policy if exists invites_select on public.org_invites;
create policy invites_select on public.org_invites for select to authenticated
  using (org_id = public.current_org_id() and public.has_role('admin'));
drop policy if exists invites_update on public.org_invites;
create policy invites_update on public.org_invites for update to authenticated
  using (org_id = public.current_org_id() and public.has_role('admin'))
  with check (org_id = public.current_org_id() and public.has_role('admin'));

-- Leads: insert-only for website visitors. Nobody reads them through the API (platform_leads() only).
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to anon, authenticated with check (not handled);

-- ------------------------------------------------------------------ grants
grant usage on schema public to anon, authenticated;
revoke all on public.organisations, public.platform_admins, public.org_invites, public.leads, public.schema_migrations
  from anon, authenticated;
grant select on public.organisations to authenticated;
grant update (name, brand_colour, logo_url) on public.organisations to authenticated;
grant select on public.org_invites to authenticated;
grant update (revoked) on public.org_invites to authenticated;
grant insert (name, company, email, phone, fleet_size, message, source) on public.leads to anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.app_role(), public.has_role(text[]), public.is_active(), public.actor_name(),
  public.log_audit(text,text,text,jsonb), public.decide_ai(bigint,text,text), public.clear_example_data(),
  public.current_org_id(), public.is_platform_admin(), public.org_writable(uuid), public.org_has_feature(text,uuid),
  public.create_organisation(text), public.accept_invite(text), public.invite_preview(text),
  public.create_invite(text,text), public.org_summary(), public.alerts(),
  public.platform_orgs(), public.platform_update_org(uuid,text,text,timestamptz,integer,boolean),
  public.platform_leads(), public.platform_mark_lead(uuid,boolean)
  to authenticated;
grant execute on function public.invite_preview(text) to anon;
