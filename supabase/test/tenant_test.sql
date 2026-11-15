-- LOCAL TESTING ONLY. Tenant isolation, trials, invites, limits, billing guards, platform admin, leads, alerts.
-- Run on a throwaway database after: auth_stub.sql, schema.sql, migrations/*.sql, seed.sql.
\set ON_ERROR_STOP 1
create schema if not exists t;
create or replace function t.expect_error(q text, label text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'PASS (blocked) %: %', label, sqlerrm; return; end;
  raise exception 'FAIL % : statement was allowed: %', label, q;
end $$;
create or replace function t.expect(cond boolean, label text) returns void language plpgsql as $$
begin if coalesce(cond,false) then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if; end $$;
create or replace function t.as_user(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant usage on schema t to authenticated, anon, service_role; grant execute on all functions in schema t to authenticated, anon, service_role;
create table if not exists t.ids(k text primary key, v text); grant all on t.ids to authenticated, anon, service_role;
grant all on all tables in schema public to service_role;  -- as on Supabase
insert into t.ids select 'postA', min(id)::text from board_posts where org_id='00000000-0000-4000-8000-000000000001';
insert into t.ids select 'itemA', min(id)::text from stock_items where org_id='00000000-0000-4000-8000-000000000001';

-- ---- accounts: A = default org founder (owner), B = a new haulier on a trial, X = org-less
insert into auth.users(id,email,raw_user_meta_data) values
 ('a0000000-0000-0000-0000-00000000000a','owner@a.test','{"full_name":"Owner A"}'),
 ('b0000000-0000-0000-0000-00000000000b','boss@b.test','{"full_name":"Boss B","org_name":"Bravo Haulage Ltd"}'),
 ('c0000000-0000-0000-0000-00000000000c','nobody@x.test','{"full_name":"No Org"}');

select t.expect((select role='admin' and active and org_id='00000000-0000-4000-8000-000000000001' from profiles where email='owner@a.test'), 'owner is admin of default org');
select t.expect((select count(*)=1 from platform_admins where user_id='a0000000-0000-0000-0000-00000000000a'), 'owner is platform admin');
select t.expect((select count(*)=1 from platform_admins), 'nobody else is platform admin');
select t.expect((select role='admin' and active and org_id is not null and org_id<>'00000000-0000-4000-8000-000000000001' from profiles where email='boss@b.test'), 'trial sign-up creates own org as admin');
select t.expect((select o.status='trial' and o.plan='trial' and o.trial_ends_at between now()+interval '13 days 23 hours' and now()+interval '14 days 1 minute' and o.vehicle_limit=25 and o.slug='bravo-haulage-ltd'
                   from organisations o join profiles p on p.org_id=o.id where p.email='boss@b.test'), '14-day trial, 25 vehicle limit, slug');
select t.expect((select org_id is null and not active from profiles where email='nobody@x.test'), 'plain sign-up has no org');
insert into t.ids select 'orgB', org_id::text from profiles where email='boss@b.test';
select t.expect((select count(*)>=3 from board_channels where org_id=(select v::uuid from t.ids where k='orgB')), 'new org provisioned with channels');
select t.expect((select count(*)=8 from ai_models where org_id=(select v::uuid from t.ids where k='orgB')), 'new org gets AI model register');
select t.expect((select bool_and(live = locked) from ai_models where org_id=(select v::uuid from t.ids where k='orgB')), 'new org models start in shadow except the legal guard');

-- ===== B admin: sees only B
select t.as_user('b0000000-0000-0000-0000-00000000000b'); set role authenticated;
select t.expect((select count(*) from vehicles)=0, 'B sees no A vehicles');
select t.expect((select count(*) from jobs)=0, 'B sees no A jobs');
select t.expect((select count(*) from stock_items)=0, 'B sees no A stock');
select t.expect((select count(*) from drivers_hours)=0, 'B sees no A hours');
select t.expect((select count(*) from depots)=0, 'B sees no A depots');
select t.expect((select count(*) from board_posts)=0, 'B sees no A posts');
select t.expect((select count(*) from board_replies)=0, 'B sees no A replies');
select t.expect((select count(*) from ai_decisions)=0, 'B sees no A AI proposals');
select t.expect((select count(*) from ai_models)=8, 'B sees only its own 8 models');
select t.expect((select count(*) from info_articles where org_id<>public.current_org_id())=0, 'B sees only own info');
select t.expect((select count(*) from profiles)=1, 'B sees only own member list');
select t.expect((select count(*) from organisations)=1, 'B sees only own organisation');
select t.expect((select count(*) from audit_log where org_id is distinct from public.current_org_id())=0 and (select count(*) from audit_log)>0, 'B audit only own');
select t.expect((select count(*) from org_invites)=0, 'B sees no invites yet');
select t.expect_error($q$select * from platform_orgs()$q$, 'B lists platform orgs');
select t.expect_error($q$select public.platform_update_org((select id from organisations limit 1), 'enterprise', 'active')$q$, 'B upgrades itself via platform fn');
select t.expect_error($q$select * from platform_leads()$q$, 'B reads leads');
select t.expect_error($q$select * from leads$q$, 'B reads leads table');
-- B writes go to B automatically
insert into vehicles(reg, type, status, mot_due) values ('MX26 MRD','44t artic','Available', current_date + 10);  -- same reg as an A vehicle: allowed per org
insert into jobs(ref, customer, status) values ('J-10482','Bravo customer','At risk');
insert into depots(code, name) values ('Daventry','Bravo Daventry');
insert into stock_items(sku, name, depot, qty, reorder_point) values ('CH-4402','Pallets','Daventry',5,10);
insert into board_posts(channel_id, body) values ('general','Bravo hello');
select t.expect((select count(*)=1 from vehicles where reg='MX26 MRD' and org_id=public.current_org_id()), 'B vehicle stamped with B org');
-- try to write into A
select t.expect_error($q$insert into vehicles(org_id, reg) values ('00000000-0000-4000-8000-000000000001','ZZ01 ZZZ')$q$, 'B inserts vehicle into A');
select t.expect_error($q$insert into board_posts(org_id, channel_id, body) values ('00000000-0000-4000-8000-000000000001','night','spam')$q$, 'B posts into A board');
select t.expect_error($q$insert into board_replies(post_id, body) values ((select v::bigint from t.ids where k='postA'), 'cross reply')$q$, 'B replies to A post by id');
select t.expect_error($q$insert into stock_movements(item_id, change, reason) values ((select v::bigint from t.ids where k='itemA'), -100, 'cross-org stock theft')$q$, 'B moves A stock by id');
select t.expect_error($q$update vehicles set org_id='00000000-0000-4000-8000-000000000001' where reg='MX26 MRD'$q$, 'B moves its vehicle to A');
select t.expect_error($q$update profiles set org_id='00000000-0000-4000-8000-000000000001' where id=auth.uid()$q$, 'B moves itself to A');
select t.expect_error($q$update organisations set plan='enterprise'$q$, 'B changes own plan');
select t.expect_error($q$update organisations set status='active', trial_ends_at=null$q$, 'B ends own trial');
select t.expect_error($q$update organisations set vehicle_limit=9999$q$, 'B raises own vehicle limit');
update organisations set name='Bravo Haulage', brand_colour='#1d4ed8', logo_url='https://example.com/logo.png';
select t.expect((select name='Bravo Haulage' and brand_colour='#1d4ed8' from organisations), 'B admin edits branding');
select t.expect_error($q$update organisations set logo_url='javascript:alert(1)'$q$, 'non-https logo rejected');
-- updates/deletes aimed at A rows silently affect nothing
update jobs set status='Delivered' where ref='J-10482' and org_id='00000000-0000-4000-8000-000000000001';
delete from vehicles where org_id='00000000-0000-4000-8000-000000000001';
delete from board_posts where org_id='00000000-0000-4000-8000-000000000001';
select public.clear_example_data();
-- invites
insert into t.ids select 'invB', (public.create_invite('driver@b.test','driver')).token;
insert into t.ids select 'openB', (public.create_invite(null,'planner')).token;
select t.expect((select count(*)=2 from org_invites), 'B admin sees own invites');
reset role;
select t.expect((select count(*)=12 from vehicles where org_id='00000000-0000-4000-8000-000000000001'), 'A vehicles untouched by B delete');
select t.expect((select status='At risk' from jobs where ref='J-10482' and org_id='00000000-0000-4000-8000-000000000001'), 'A job untouched by B update');
select t.expect((select count(*)=6 from board_posts where org_id='00000000-0000-4000-8000-000000000001'), 'A posts untouched by B delete / clear_example_data');
select t.expect((select count(*)=12 from vehicles where org_id='00000000-0000-4000-8000-000000000001' and example), 'B clear_example_data kept A example rows');

-- ===== invite flows
insert into auth.users(id,email,raw_user_meta_data) values
 ('d0000000-0000-0000-0000-00000000000d','driver@b.test', jsonb_build_object('full_name','Dan Driver','invite',(select v from t.ids where k='invB'))),
 ('e0000000-0000-0000-0000-00000000000e','wrong@b.test', jsonb_build_object('full_name','Wrong Email','invite',(select v from t.ids where k='invB')));
select t.expect((select role='driver' and active and org_id=(select v::uuid from t.ids where k='orgB') from profiles where email='driver@b.test'), 'invited driver joins B, active');
select t.expect((select org_id is null from profiles where email='wrong@b.test'), 'used/mismatched invite does not join');
select t.as_user('c0000000-0000-0000-0000-00000000000c'); set role authenticated;
select t.expect((select count(*) from vehicles)=0, 'org-less user sees no vehicles');
select t.expect((select count(*) from profiles)=1, 'org-less user sees only self');
select t.expect((select count(*) from board_posts)=0, 'org-less user sees no posts');
select t.expect((select org_name='Bravo Haulage' and role='planner' from invite_preview((select v from t.ids where k='openB'))), 'invite preview');
select public.accept_invite((select v from t.ids where k='openB'));
select t.expect((select role='planner' and active from profiles where id=auth.uid()), 'org-less user accepts open invite link');
select t.expect((select count(*) from vehicles)=1, 'planner now sees only B vehicle');
select t.expect_error($q$select public.accept_invite((select v from t.ids where k='openB'))$q$, 'accept twice');
select t.expect_error($q$select public.create_invite('x@y.test','admin')$q$, 'planner creates invite');
reset role;
select t.as_user('e0000000-0000-0000-0000-00000000000e'); set role authenticated;
select t.expect_error($q$select public.accept_invite('not-a-token')$q$, 'bad invite token');
select public.create_organisation('Echo Freight');
select t.expect((select role='admin' and active from profiles where id=auth.uid()), 'org-less user starts own trial');
select t.expect((select count(*) from vehicles)=0 and (select count(*) from profiles)=1, 'Echo sees nothing of A or B');
select t.expect_error($q$select public.create_organisation('Second Org')$q$, 'create a second org');
reset role;

-- ===== B driver: own jobs only, within B
update jobs set driver_name='Dan Driver' where ref='J-10482' and org_id=(select v::uuid from t.ids where k='orgB');
select t.expect((select driver_id='d0000000-0000-0000-0000-00000000000d' from jobs where ref='J-10482' and org_id=(select v::uuid from t.ids where k='orgB')), 'B job linked to B driver');
select t.expect((select driver_id is null or driver_id<>'d0000000-0000-0000-0000-00000000000d' from jobs where ref='J-10482' and org_id='00000000-0000-4000-8000-000000000001'), 'A job not linked to B driver');
select t.as_user('d0000000-0000-0000-0000-00000000000d'); set role authenticated;
select t.expect((select count(*) from jobs)=1, 'B driver sees own B job only');
select t.expect((select count(*) from board_posts)=1, 'B driver sees B board only');
reset role;
-- B planner cannot attach an A member as driver
select t.as_user('c0000000-0000-0000-0000-00000000000c'); set role authenticated;
select t.expect_error($q$update jobs set driver_id='a0000000-0000-0000-0000-00000000000a' where ref='J-10482'$q$, 'B assigns A member as driver');
insert into stock_movements(item_id, change, reason) select min(id), 5, 'Inbound' from stock_items;
select t.expect((select qty=10 from stock_items), 'B planner moves own stock');
reset role;

-- ===== A owner: sees A only, platform admin functions work
select t.as_user('a0000000-0000-0000-0000-00000000000a'); set role authenticated;
select t.expect((select count(*) from vehicles)=12, 'A sees its 12 vehicles only');
select t.expect((select count(*) from profiles)=1, 'A sees only A members');
select t.expect((select count(*) from organisations)>=3, 'platform admin can read org list');
select t.expect((select count(*) from platform_orgs())=3, 'platform_orgs lists all orgs');
select t.expect((select vehicles=1 and members=3 from platform_orgs() where slug='bravo-haulage-ltd'), 'platform_orgs counts');
select t.expect((select count(*) from jobs where customer='Bravo customer')=0, 'platform admin does not see B data');
select t.expect_error($q$select public.decide_ai(999999, 'approved')$q$, 'decide unknown id');
reset role;

-- decide_ai cannot reach another org's proposal
insert into t.ids select 'decA', min(id)::text from ai_decisions where org_id='00000000-0000-4000-8000-000000000001' and status='pending';
select t.as_user('b0000000-0000-0000-0000-00000000000b'); set role authenticated;
select t.expect_error($q$select public.decide_ai((select v::bigint from t.ids where k='decA'), 'rejected', 'cross-org')$q$, 'B decides A proposal');
reset role;
select t.expect((select status='pending' from ai_decisions where id=(select v::bigint from t.ids where k='decA')), 'A proposal still pending');

-- ===== vehicle limit
update organisations set vehicle_limit=2 where id=(select v::uuid from t.ids where k='orgB');
select t.as_user('b0000000-0000-0000-0000-00000000000b'); set role authenticated;
insert into vehicles(reg) values ('BB02 TWO');
select t.expect_error($q$insert into vehicles(reg) values ('BB03 THR')$q$, 'vehicle limit enforced');
insert into vehicles(reg, notes) values ('BB02 TWO','upsert') on conflict (org_id, reg) do update set notes=excluded.notes;
select t.expect((select notes='upsert' from vehicles where reg='BB02 TWO'), 'upsert of existing reg allowed at limit');
update vehicles set status='Sold' where reg='BB02 TWO';
insert into vehicles(reg) values ('BB03 THR');
select t.expect((select count(*)=3 from vehicles), 'sold vehicles free a slot');
reset role;

-- ===== trial expiry: read-only, admin can still manage members and see billing
update organisations set trial_ends_at=now()-interval '1 minute' where id=(select v::uuid from t.ids where k='orgB');
select t.as_user('b0000000-0000-0000-0000-00000000000b'); set role authenticated;
select t.expect((select not writable and trial_days_left=0 from org_summary()), 'expired trial reported');
select t.expect((select count(*) from vehicles)=3, 'expired trial still reads data');
select t.expect_error($q$insert into board_posts(channel_id, body) values ('general','after expiry')$q$, 'expired trial blocks writes');
select t.expect_error($q$update vehicles set notes='x' where reg='BB03 THR'$q$, 'expired trial blocks updates');
update profiles set title='Director' where id=auth.uid();
select t.expect((select title='Director' from profiles where id=auth.uid()), 'expired trial: admin still edits profiles');
reset role;
-- platform admin extends the trial
select t.as_user('a0000000-0000-0000-0000-00000000000a'); set role authenticated;
select public.platform_update_org((select v::uuid from t.ids where k='orgB'), null, null, now()+interval '14 days', 50);
reset role;
select t.as_user('b0000000-0000-0000-0000-00000000000b'); set role authenticated;
select t.expect((select writable and vehicle_limit=50 and trial_days_left=14 from org_summary()), 'trial extended by platform admin');
insert into board_posts(channel_id, body) values ('general','back again');
-- alerts: own org only
select t.expect((select count(*) from alerts() where kind='mot' and ref='MX26 MRD')=1, 'B alert for own MOT');
select t.expect((select count(*) from alerts() where kind='approval')=0, 'B gets no A approval alerts');
select t.expect((select count(*) from alerts() where kind='stock')=1, 'B low stock alert');
select t.expect((select count(*) from alerts() where kind='job')=1, 'B late job alert');
reset role;
select t.as_user('a0000000-0000-0000-0000-00000000000a'); set role authenticated;
select t.expect((select count(*) from alerts() where kind='approval')>0, 'A gets own approval alerts');
select t.expect((select count(*) from alerts() where kind='mot' and ref='MX26 MRD')=0, 'A gets no B MOT alert (A MRD MOT is months away)');
reset role;
select t.as_user('d0000000-0000-0000-0000-00000000000d'); set role authenticated;
select t.expect((select count(*) from alerts() where kind in ('mot','stock','approval'))=0, 'driver alerts limited by role');
reset role;

-- ===== anonymous website visitor
select t.as_user(''); set role anon;
insert into leads(name, company, email, fleet_size, message, source) values ('Jo Bloggs','Bloggs Haulage','jo@bloggs.test','20-50','Demo please','website');
select t.expect_error($q$select * from leads$q$, 'anon reads leads');
select t.expect_error($q$insert into leads(name, email, handled) values ('x','x@y.test', true)$q$, 'anon sets handled');
select t.expect_error($q$insert into leads(name, email) values ('x','not-an-email')$q$, 'lead email validated');
select t.expect_error($q$select * from organisations$q$, 'anon reads organisations');
select t.expect_error($q$select * from vehicles$q$, 'anon reads vehicles');
select t.expect_error($q$select * from org_invites$q$, 'anon reads invites');
select t.expect_error($q$select public.create_organisation('Anon Org')$q$, 'anon creates org');
select t.expect((select count(*)=0 from invite_preview('nope')), 'anon may call invite_preview (no match)');
reset role;
select t.as_user('a0000000-0000-0000-0000-00000000000a'); set role authenticated;
select t.expect((select count(*)=1 from platform_leads()), 'platform admin reads leads');
reset role;

-- service role (Stripe webhook) can update plan/status
set role service_role;
update organisations set plan='professional', status='active', vehicle_limit=30, stripe_customer_id='cus_test', stripe_subscription_id='sub_test'
 where id=(select v::uuid from t.ids where k='orgB');
reset role;
select t.expect((select plan='professional' and status='active' from organisations where id=(select v::uuid from t.ids where k='orgB')), 'service role updates billing state');
select 'ALL TENANT TESTS PASSED' as result;
