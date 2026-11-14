-- =====================================================================
-- Northline Operating System: database schema for Supabase (Postgres 15+)
-- Safe to run more than once (idempotent).
-- Roles: admin, duty, planner, workshop, warehouse, driver
-- Access mirrors the app's ACCESS map:
--   admin     home command network fleet people stock finance ai board info admin
--   duty      home command network fleet people ai board info
--   planner   home command network stock finance ai board info
--   workshop  home fleet board info
--   warehouse home stock board info
--   driver    home board info  (plus their own jobs and hours)
-- =====================================================================


-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null default '',
  role        text not null default 'driver'
              check (role in ('admin','duty','planner','workshop','warehouse','driver')),
  depot       text,
  title       text,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.depots (
  code             text primary key,
  name             text not null,
  region           text,
  pallet_locations integer,
  occupancy_pct    numeric(5,1),
  notes            text,
  example          boolean not null default false
);

create table if not exists public.vehicles (
  id            bigint generated always as identity primary key,
  reg           text not null unique,
  type          text,
  depot         text,
  status        text not null default 'Available',
  mot_due       date,
  next_service  date,
  odometer      integer,
  notes         text,
  example       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.drivers_hours (
  id               bigint generated always as identity primary key,
  driver_id        uuid references public.profiles(id) on delete set null,
  driver_name      text not null,
  day              date not null default current_date,
  driving_minutes  integer not null default 0 check (driving_minutes >= 0),
  weekly_minutes   integer not null default 0 check (weekly_minutes >= 0),
  break_minutes    integer not null default 0 check (break_minutes >= 0),
  notes            text,
  example          boolean not null default false,
  updated_at       timestamptz not null default now(),
  unique (driver_name, day)
);

create table if not exists public.jobs (
  id               bigint generated always as identity primary key,
  ref              text not null unique,
  customer         text,
  origin           text,
  destination      text,
  pallets          integer,
  delivery_window  text,
  status           text not null default 'Planned',
  vehicle_reg      text,
  driver_id        uuid references public.profiles(id) on delete set null,
  driver_name      text,
  rate_gbp         numeric(10,2),
  cost_gbp         numeric(10,2),
  notes            text,
  example          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.stock_items (
  id             bigint generated always as identity primary key,
  sku            text not null,
  name           text not null,
  depot          text not null,
  qty            integer not null default 0,
  reorder_point  integer not null default 0,
  location       text,
  example        boolean not null default false,
  updated_at     timestamptz not null default now(),
  unique (sku, depot)
);

create table if not exists public.stock_movements (
  id          bigint generated always as identity primary key,
  item_id     bigint not null references public.stock_items(id) on delete cascade,
  change      integer not null check (change <> 0),
  reason      text,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  example     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.board_channels (
  id    text primary key,
  name  text not null,
  sort  integer not null default 0
);

create table if not exists public.board_posts (
  id           bigint generated always as identity primary key,
  channel_id   text not null references public.board_channels(id) on delete cascade,
  author_id    uuid default auth.uid() references public.profiles(id) on delete set null,
  author_name  text,
  author_role  text,
  body         text not null check (length(body) between 1 and 4000),
  removed      boolean not null default false,
  example      boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.board_replies (
  id           bigint generated always as identity primary key,
  post_id      bigint not null references public.board_posts(id) on delete cascade,
  author_id    uuid default auth.uid() references public.profiles(id) on delete set null,
  author_name  text,
  author_role  text,
  body         text not null check (length(body) between 1 and 4000),
  example      boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.info_articles (
  slug        text primary key,
  title       text not null,
  body        text not null default '',   -- plain text: blank line = new paragraph, "- " = bullet
  sort        integer not null default 0,
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.ai_models (
  id          text primary key,
  name        text not null,
  technique   text,
  mode        text,
  live        boolean not null default false,
  locked      boolean not null default false,  -- locked models (legal hours guard) cannot be switched off
  gate        text,
  owner       text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.ai_decisions (
  id                   bigint generated always as identity primary key,
  subject              text,              -- job ref, vehicle reg or SKU
  proposal             text not null,
  reason               text,
  model                text references public.ai_models(id) on delete set null,
  confidence           numeric(4,3) check (confidence between 0 and 1),
  confidence_interval  text,
  owner                text,
  status               text not null default 'pending' check (status in ('pending','approved','rejected')),
  approver             uuid references public.profiles(id) on delete set null,
  approver_name        text,
  decided_at           timestamptz,
  note                 text,
  example              boolean not null default false,
  created_at           timestamptz not null default now()
);

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_name  text,
  action      text not null,
  entity      text,
  entity_id   text,
  detail      jsonb
);

create index if not exists jobs_driver_idx on public.jobs(driver_id);
create index if not exists hours_driver_idx on public.drivers_hours(driver_id);
create index if not exists posts_channel_idx on public.board_posts(channel_id, created_at desc);
create index if not exists replies_post_idx on public.board_replies(post_id);
create index if not exists audit_at_idx on public.audit_log(at desc);
create index if not exists decisions_status_idx on public.ai_decisions(status);

-- ------------------------------------------------------- role helpers
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = any(roles), false)
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null
$$;

create or replace function public.actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name,''), email, 'System') from public.profiles where id = auth.uid()
$$;

-- ----------------------------------------------------------- audit core
create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log(actor, actor_name, action, entity, entity_id, detail)
  values (auth.uid(), coalesce(public.actor_name(), 'System'), p_action, p_entity, p_entity_id, p_detail)
$$;

-- Callable from the app (sign-in, CSV import and so on). Actor is always the caller.
create or replace function public.log_audit(p_action text, p_entity text default null, p_entity_id text default null, p_detail jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'Not an active member'; end if;
  perform public.write_audit(left(p_action, 200), p_entity, p_entity_id, p_detail);
end $$;

create or replace function public.audit_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_append_only();

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  key text := coalesce(rec->>'id', rec->>'slug', rec->>'ref', rec->>'reg');
begin
  perform public.write_audit(
    lower(tg_op) || ' ' || tg_table_name, tg_table_name, key,
    case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)) else rec end);
  return null;
end $$;

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after update or delete on public.profiles
  for each row execute function public.audit_row_change();
drop trigger if exists audit_ai_models on public.ai_models;
create trigger audit_ai_models after insert or update or delete on public.ai_models
  for each row execute function public.audit_row_change();
drop trigger if exists audit_ai_decisions on public.ai_decisions;
create trigger audit_ai_decisions after insert or delete on public.ai_decisions
  for each row execute function public.audit_row_change();
drop trigger if exists audit_info on public.info_articles;
create trigger audit_info after insert or update or delete on public.info_articles
  for each row execute function public.audit_row_change();

-- --------------------------------------------------- generic triggers
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','vehicles','drivers_hours','jobs','stock_items','info_articles','ai_models'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format('create trigger touch_%1$s before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- New sign-up: create a profile as an inactive driver. First ever user becomes the active admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_admin boolean;
begin
  perform pg_advisory_xact_lock(hashtext('northline_bootstrap_admin'));
  first_admin := not exists (select 1 from public.profiles where role = 'admin' and active);
  insert into public.profiles(id, email, full_name, role, active, title)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(coalesce(new.email,''),'@',1)),
          case when first_admin then 'admin' else 'driver' end,
          first_admin,
          case when first_admin then 'Founding administrator' else null end)
  on conflict (id) do nothing;
  insert into public.audit_log(actor, actor_name, action, entity, entity_id, detail)
  values (new.id, coalesce(new.email,'new user'),
          case when first_admin then 'First member bootstrapped as admin' else 'Signed up, awaiting approval' end,
          'profiles', new.id::text, jsonb_build_object('email', new.email));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change role, active or email; never remove the last active admin.
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (new.role, new.active, new.email, new.id) is distinct from (old.role, old.active, old.email, old.id)
       and auth.uid() is not null and not public.has_role('admin') then
      raise exception 'Only an admin can change role or approval';
    end if;
    if old.role = 'admin' and old.active and not (new.role = 'admin' and new.active)
       and not exists (select 1 from public.profiles where role='admin' and active and id <> old.id) then
      raise exception 'Cannot remove the last active admin';
    end if;
    return new;
  else
    if old.role = 'admin' and old.active
       and not exists (select 1 from public.profiles where role='admin' and active and id <> old.id) then
      raise exception 'Cannot remove the last active admin';
    end if;
    return old;
  end if;
end $$;

drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update or delete on public.profiles
  for each row execute function public.guard_profile();

-- Drivers may only change status and notes on their own jobs.
create or replace function public.guard_job() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() = 'driver' then
    if (to_jsonb(new) - 'status' - 'notes' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'notes' - 'updated_at') then
      raise exception 'Drivers can only update status and notes';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_job on public.jobs;
create trigger guard_job before update on public.jobs
  for each row execute function public.guard_job();

-- Link driver_name to a member automatically when the name matches exactly one profile.
create or replace function public.link_driver() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid; n int;
begin
  if new.driver_id is null and coalesce(new.driver_name,'') <> '' then
    select count(*), min(id::text)::uuid into n, pid from public.profiles
      where lower(full_name) = lower(trim(new.driver_name)) or lower(email) = lower(trim(new.driver_name));
    if n = 1 then new.driver_id := pid; end if;
  elsif new.driver_id is not null and coalesce(new.driver_name,'') = '' then
    select full_name into new.driver_name from public.profiles where id = new.driver_id;
  end if;
  return new;
end $$;

drop trigger if exists link_driver_jobs on public.jobs;
create trigger link_driver_jobs before insert or update on public.jobs
  for each row execute function public.link_driver();
drop trigger if exists link_driver_hours on public.drivers_hours;
create trigger link_driver_hours before insert or update on public.drivers_hours
  for each row execute function public.link_driver();

-- When a member is approved or renamed, link existing jobs and hours that carry their name.
create or replace function public.link_member_records() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.active and coalesce(new.full_name,'') <> '' then
    update public.jobs set driver_id = new.id
      where driver_id is null and lower(trim(driver_name)) = lower(trim(new.full_name));
    update public.drivers_hours set driver_id = new.id
      where driver_id is null and lower(trim(driver_name)) = lower(trim(new.full_name));
  end if;
  return null;
end $$;

drop trigger if exists link_member_records on public.profiles;
create trigger link_member_records after insert or update of active, full_name on public.profiles
  for each row execute function public.link_member_records();

-- Stamp author name and role on board posts and replies.
create or replace function public.stamp_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
    select coalesce(nullif(full_name,''), email), role into new.author_name, new.author_role
      from public.profiles where id = auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists stamp_post on public.board_posts;
create trigger stamp_post before insert on public.board_posts
  for each row execute function public.stamp_author();
drop trigger if exists stamp_reply on public.board_replies;
create trigger stamp_reply before insert on public.board_replies
  for each row execute function public.stamp_author();

-- Stock movements adjust quantity on hand.
create or replace function public.apply_stock_movement() returns trigger
language plpgsql as $$
begin
  update public.stock_items set qty = qty + new.change where id = new.item_id;
  return new;
end $$;

drop trigger if exists apply_movement on public.stock_movements;
create trigger apply_movement after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- The locked legal-hours guard can never be switched off.
create or replace function public.guard_model() returns trigger
language plpgsql as $$
begin
  if old.locked and (not new.live or not new.locked) then
    raise exception 'This model is a locked legal constraint and cannot be switched off';
  end if;
  return new;
end $$;

drop trigger if exists guard_model on public.ai_models;
create trigger guard_model before update on public.ai_models
  for each row execute function public.guard_model();

-- ------------------------------------------------------- app functions
-- Approve or reject an AI proposal. The only way to change a decision; always audited.
create or replace function public.decide_ai(p_id bigint, p_decision text, p_note text default null)
returns public.ai_decisions language plpgsql security definer set search_path = public as $$
declare d public.ai_decisions;
begin
  if not public.has_role('admin','duty','planner') then
    raise exception 'Your role cannot decide AI proposals';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  update public.ai_decisions
     set status = p_decision, approver = auth.uid(), approver_name = public.actor_name(),
         decided_at = now(), note = p_note
   where id = p_id and status = 'pending'
   returning * into d;
  if d.id is null then raise exception 'Proposal not found or already decided'; end if;
  perform public.write_audit('AI proposal ' || p_decision, 'ai_decisions', d.id::text,
    jsonb_build_object('subject', d.subject, 'proposal', d.proposal, 'model', d.model,
                       'confidence', d.confidence, 'interval', d.confidence_interval, 'note', p_note));
  return d;
end $$;

-- Remove all rows flagged as example data (admin only).
create or replace function public.clear_example_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin') then raise exception 'Admins only'; end if;
  delete from public.board_posts where example;
  delete from public.ai_decisions where example;
  delete from public.stock_movements where example;
  delete from public.stock_items where example;
  delete from public.jobs where example;
  delete from public.drivers_hours where example;
  delete from public.vehicles where example;
  delete from public.depots where example and code not in (select distinct depot from public.vehicles where depot is not null);
  perform public.write_audit('Cleared example data', null, null, null);
end $$;

-- ------------------------------------------------------------- RLS
do $$ declare t text; begin
  foreach t in array array['profiles','depots','vehicles','drivers_hours','jobs','stock_items','stock_movements',
    'board_channels','board_posts','board_replies','info_articles','ai_models','ai_decisions','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    -- drop every existing policy so re-runs replace them cleanly
    perform 1;
  end loop;
end $$;

do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' and tablename in
    ('profiles','depots','vehicles','drivers_hours','jobs','stock_items','stock_movements','board_channels',
     'board_posts','board_replies','info_articles','ai_models','ai_decisions','audit_log') loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- profiles: everyone active sees the staff directory; you always see yourself.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_delete_admin on public.profiles for delete to authenticated
  using (public.has_role('admin') and id <> auth.uid());

-- depots
create policy depots_select on public.depots for select to authenticated using (public.is_active());
create policy depots_write on public.depots for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- vehicles: fleet (admin, duty, workshop) write; planners read for planning.
create policy vehicles_select on public.vehicles for select to authenticated
  using (public.has_role('admin','duty','workshop','planner'));
create policy vehicles_write on public.vehicles for all to authenticated
  using (public.has_role('admin','duty','workshop')) with check (public.has_role('admin','duty','workshop'));

-- drivers' hours: people view (admin, duty) plus planners read; drivers read their own.
create policy hours_select on public.drivers_hours for select to authenticated
  using (public.has_role('admin','duty','planner') or (public.has_role('driver') and driver_id = auth.uid()));
create policy hours_write on public.drivers_hours for all to authenticated
  using (public.has_role('admin','duty')) with check (public.has_role('admin','duty'));

-- jobs: command/network (admin, duty, planner); drivers see and update only their own.
create policy jobs_select on public.jobs for select to authenticated
  using (public.has_role('admin','duty','planner') or (public.has_role('driver') and driver_id = auth.uid()));
create policy jobs_insert on public.jobs for insert to authenticated
  with check (public.has_role('admin','duty','planner'));
create policy jobs_update on public.jobs for update to authenticated
  using (public.has_role('admin','duty','planner') or (public.has_role('driver') and driver_id = auth.uid()))
  with check (public.has_role('admin','duty','planner') or (public.has_role('driver') and driver_id = auth.uid()));
create policy jobs_delete on public.jobs for delete to authenticated
  using (public.has_role('admin','duty','planner'));

-- stock: admin, planner, warehouse.
create policy stock_select on public.stock_items for select to authenticated
  using (public.has_role('admin','planner','warehouse'));
create policy stock_write on public.stock_items for all to authenticated
  using (public.has_role('admin','planner','warehouse')) with check (public.has_role('admin','planner','warehouse'));
create policy moves_select on public.stock_movements for select to authenticated
  using (public.has_role('admin','planner','warehouse'));
create policy moves_insert on public.stock_movements for insert to authenticated
  with check (public.has_role('admin','planner','warehouse') and created_by = auth.uid());

-- board: every active member reads and posts; authors and admin/duty moderate.
create policy channels_select on public.board_channels for select to authenticated using (public.is_active());
create policy channels_write on public.board_channels for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy posts_select on public.board_posts for select to authenticated using (public.is_active());
create policy posts_insert on public.board_posts for insert to authenticated
  with check (public.is_active() and author_id = auth.uid());
create policy posts_update on public.board_posts for update to authenticated
  using (public.is_active() and (author_id = auth.uid() or public.has_role('admin','duty')))
  with check (public.is_active() and (author_id = auth.uid() or public.has_role('admin','duty')));
create policy posts_delete on public.board_posts for delete to authenticated using (public.has_role('admin'));
create policy replies_select on public.board_replies for select to authenticated using (public.is_active());
create policy replies_insert on public.board_replies for insert to authenticated
  with check (public.is_active() and author_id = auth.uid());
create policy replies_delete on public.board_replies for delete to authenticated
  using (public.is_active() and (author_id = auth.uid() or public.has_role('admin','duty')));

-- information: everyone reads, admin writes.
create policy info_select on public.info_articles for select to authenticated using (public.is_active());
create policy info_write on public.info_articles for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- AI models: AI view reads; only admin changes.
create policy models_select on public.ai_models for select to authenticated
  using (public.has_role('admin','duty','planner'));
create policy models_write on public.ai_models for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- AI decisions: AI view reads and proposes; decisions only through decide_ai(); admin may delete.
create policy decisions_select on public.ai_decisions for select to authenticated
  using (public.has_role('admin','duty','planner'));
create policy decisions_insert on public.ai_decisions for insert to authenticated
  with check (public.has_role('admin','duty','planner') and status = 'pending' and approver is null);
create policy decisions_delete on public.ai_decisions for delete to authenticated
  using (public.has_role('admin'));

-- audit: admin reads; nobody writes directly (functions and triggers only).
create policy audit_select on public.audit_log for select to authenticated using (public.has_role('admin'));

-- ----------------------------------------------------------- grants
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
revoke update, delete, truncate on public.stock_movements from authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.app_role(), public.has_role(text[]), public.is_active(), public.actor_name(),
  public.log_audit(text,text,text,jsonb), public.decide_ai(bigint,text,text), public.clear_example_data()
  to authenticated;
-- internal helper; not callable by clients
revoke execute on function public.write_audit(text,text,text,jsonb) from authenticated;

-- --------------------------------------------------------- realtime
do $$ declare t text; begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['board_posts','board_replies','jobs','ai_decisions'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
