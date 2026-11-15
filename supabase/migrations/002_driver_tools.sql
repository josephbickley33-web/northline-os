-- =====================================================================
-- Northline SaaS migration 002: driver mobile tools.
--   walkaround_checks  daily walkaround check with optional photos
--   defect_reports     defects raised by drivers, worked by the workshop
--   delivery_proofs    proof of delivery: receiver name, signature image, photos
-- Photos and signatures go to the private Storage bucket "driver-uploads", in a folder per
-- organisation: <org_id>/<kind>/<file>. Safe to run more than once.
-- =====================================================================

create table if not exists public.walkaround_checks (
  id             bigint generated always as identity primary key,
  org_id         uuid not null default public.current_org_id() references public.organisations(id) on delete cascade,
  vehicle_reg    text not null check (length(vehicle_reg) between 2 and 20),
  driver_id      uuid default auth.uid() references public.profiles(id) on delete set null,
  driver_name    text,
  odometer       integer check (odometer is null or odometer >= 0),
  items          jsonb not null default '[]'::jsonb,   -- [{"item":"Tyres and wheel fixings","ok":true}, ...]
  defects_found  boolean not null default false,
  notes          text check (notes is null or length(notes) <= 2000),
  photo_paths    text[] not null default '{}',
  created_at     timestamptz not null default now()
);

create table if not exists public.defect_reports (
  id            bigint generated always as identity primary key,
  org_id        uuid not null default public.current_org_id() references public.organisations(id) on delete cascade,
  vehicle_reg   text not null check (length(vehicle_reg) between 2 and 20),
  check_id      bigint references public.walkaround_checks(id) on delete set null,
  reported_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  reporter_name text,
  severity      text not null default 'minor' check (severity in ('minor','major','dangerous')),
  description   text not null check (length(description) between 3 and 2000),
  photo_paths   text[] not null default '{}',
  status        text not null default 'open' check (status in ('open','in_progress','fixed')),
  resolution    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.delivery_proofs (
  id              bigint generated always as identity primary key,
  org_id          uuid not null default public.current_org_id() references public.organisations(id) on delete cascade,
  job_id          bigint not null references public.jobs(id) on delete cascade,
  received_by     text not null check (length(received_by) between 1 and 120),
  signature_path  text,
  photo_paths     text[] not null default '{}',
  notes           text check (notes is null or length(notes) <= 2000),
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now()
);

create index if not exists checks_org_idx on public.walkaround_checks(org_id, created_at desc);
create index if not exists defects_org_idx on public.defect_reports(org_id, status);
create index if not exists pod_org_idx on public.delivery_proofs(org_id, job_id);

-- Stamp names, force the author to be the caller, and keep files inside the org folder.
create or replace function public.stamp_driver_record() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text; prefix text := new.org_id::text || '/'; p text;
begin
  select coalesce(nullif(full_name,''), email) into nm from public.profiles where id = auth.uid();
  if tg_table_name = 'walkaround_checks' then
    if auth.uid() is not null then new.driver_id := auth.uid(); new.driver_name := nm; end if;
    new.vehicle_reg := upper(trim(new.vehicle_reg));
    new.defects_found := new.defects_found or exists (select 1 from jsonb_array_elements(new.items) e where (e->>'ok')::boolean is false);
  elsif tg_table_name = 'defect_reports' then
    if tg_op = 'INSERT' then
      if auth.uid() is not null then new.reported_by := auth.uid(); new.reporter_name := nm; end if;
      new.vehicle_reg := upper(trim(new.vehicle_reg));
    end if;
    new.updated_at := now();
  elsif tg_table_name = 'delivery_proofs' then
    if auth.uid() is not null then new.created_by := auth.uid(); new.created_by_name := nm; end if;
    if not exists (select 1 from public.jobs where id = new.job_id and org_id = new.org_id) then
      raise exception 'Job not found';
    end if;
    if new.signature_path is not null and left(new.signature_path, length(prefix)) <> prefix then
      raise exception 'Files must be stored in your organisation folder';
    end if;
  end if;
  if tg_op = 'INSERT' then
    foreach p in array coalesce(new.photo_paths, '{}') loop
      if left(p, length(prefix)) <> prefix then raise exception 'Files must be stored in your organisation folder'; end if;
    end loop;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['walkaround_checks','defect_reports','delivery_proofs'] loop
    execute format('drop trigger if exists stamp_driver_record on public.%I', t);
    execute format('create trigger stamp_driver_record before insert or update on public.%I for each row execute function public.stamp_driver_record()', t);
    execute format('drop trigger if exists freeze_org on public.%I', t);
    execute format('create trigger freeze_org before update on public.%I for each row execute function public.freeze_org()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- A POD marks the job delivered.
create or replace function public.pod_delivers_job() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.jobs set status = 'Delivered' where id = new.job_id and org_id = new.org_id and status not in ('Delivered','Cancelled');
  perform public.write_audit_org(new.org_id, 'Proof of delivery', 'jobs', new.job_id::text, jsonb_build_object('received_by', new.received_by));
  return null;
end $$;
drop trigger if exists pod_delivers_job on public.delivery_proofs;
create trigger pod_delivers_job after insert on public.delivery_proofs for each row execute function public.pod_delivers_job();

-- ------------------------------------------------------------- policies
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname='public' and tablename in ('walkaround_checks','defect_reports','delivery_proofs') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['walkaround_checks','defect_reports','delivery_proofs'] loop
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated
      using (org_id = public.current_org_id())
      with check (org_id = public.current_org_id() and public.org_writable())', t);
  end loop;
end $$;

-- Walkaround checks: any active member records one; drivers see their own; fleet roles see all.
create policy checks_select on public.walkaround_checks for select to authenticated
  using (public.has_role('admin','duty','workshop') or (public.is_active() and driver_id = auth.uid()));
create policy checks_insert on public.walkaround_checks for insert to authenticated with check (public.is_active());

-- Defects: anyone active reports; reporter sees own; workshop, duty and admin see and work them.
create policy defects_select on public.defect_reports for select to authenticated
  using (public.has_role('admin','duty','workshop') or (public.is_active() and reported_by = auth.uid()));
create policy defects_insert on public.defect_reports for insert to authenticated with check (public.is_active() and status = 'open');
create policy defects_update on public.defect_reports for update to authenticated
  using (public.has_role('admin','duty','workshop')) with check (public.has_role('admin','duty','workshop'));

-- Proof of delivery: the job's driver, or the office roles, record it; office roles and the author read.
create policy pod_select on public.delivery_proofs for select to authenticated
  using (public.has_role('admin','duty','planner') or (public.is_active() and created_by = auth.uid()));
create policy pod_insert on public.delivery_proofs for insert to authenticated
  with check (public.has_role('admin','duty','planner')
              or (public.has_role('driver') and exists (select 1 from public.jobs j where j.id = job_id and j.driver_id = auth.uid())));

revoke all on public.walkaround_checks, public.defect_reports, public.delivery_proofs from anon, authenticated;
grant select, insert on public.walkaround_checks, public.defect_reports, public.delivery_proofs to authenticated;
grant update (status, resolution) on public.defect_reports to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Alerts now include open defects for fleet roles (alerts() is SECURITY INVOKER, so RLS still applies).
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
  select 'defect', case when severity = 'dangerous' then 'bad' else 'watch' end,
         'Defect on ' || vehicle_reg || ' (' || severity || ')', left(description, 140), id::text, 'fleet', null
    from public.defect_reports where status <> 'fixed' and public.has_role('admin','duty','workshop')
  union all
  select 'member', 'watch', 'New member waiting: ' || coalesce(nullif(full_name,''), email), email, id::text, 'admin', null
    from public.profiles where not active and org_id is not null and public.has_role('admin')
  union all
  select 'trial', case when s.trial_days_left <= 3 then 'bad' else 'watch' end,
         'Free trial: ' || s.trial_days_left || ' day' || case when s.trial_days_left = 1 then '' else 's' end || ' left',
         'Choose a plan in Admin, then Billing', s.slug, 'admin', null
    from public.org_summary() s where s.status = 'trial' and s.trial_days_left <= 7 and public.has_role('admin')
$$;
revoke execute on function public.stamp_driver_record(), public.pod_delivers_job() from public, anon, authenticated;
grant execute on function public.alerts() to authenticated;

-- ------------------------------------------------------------- storage
-- Private bucket, 10 MB per file, images only. Objects live under <org_id>/...
-- Skipped (with a notice) where the storage schema is not available.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not found: skipping bucket and storage policies';
    return;
  end if;
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('driver-uploads', 'driver-uploads', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "northline driver uploads insert" on storage.objects';
  execute 'drop policy if exists "northline driver uploads select" on storage.objects';
  execute $p$create policy "northline driver uploads insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'driver-uploads' and public.is_active() and public.org_writable()
                and (storage.foldername(name))[1] = public.current_org_id()::text)$p$;
  execute $p$create policy "northline driver uploads select" on storage.objects for select to authenticated
    using (bucket_id = 'driver-uploads' and public.is_active()
           and (storage.foldername(name))[1] = public.current_org_id()::text)$p$;
exception when insufficient_privilege then
  raise warning 'Could not create storage policies (insufficient privilege). Create them in Dashboard > Storage > Policies: %', sqlerrm;
end $$;
