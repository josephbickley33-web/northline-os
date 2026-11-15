-- LOCAL TESTING ONLY. Run after auth_stub.sql, schema.sql, migrations/*.sql and seed.sql on a throwaway database.
\set ON_ERROR_STOP 1
create schema if not exists t;
create or replace function t.expect_error(q text, label text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'PASS (blocked) %: %', label, sqlerrm; return; end;
  raise exception 'FAIL % : statement was allowed: %', label, q;
end $$;
create or replace function t.expect(cond boolean, label text) returns void language plpgsql as $$
begin if cond then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if; end $$;
grant usage on schema t to authenticated, anon; grant execute on all functions in schema t to authenticated, anon;

insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','boss@example.test','{"full_name":"Test Admin"}'),
 ('00000000-0000-0000-0000-00000000000b','amir@example.test','{"full_name":"Amir Khan"}'),
 ('00000000-0000-0000-0000-00000000000c','plan@example.test','{"full_name":"Test Planner"}'),
 ('00000000-0000-0000-0000-00000000000d','ware@example.test','{"full_name":"Test Warehouse"}');

select t.expect((select role='admin' and active from profiles where email='boss@example.test'), 'first sign-up becomes active admin');
select t.expect((select role='driver' and not active from profiles where email='amir@example.test'), 'later sign-up is inactive driver');
select t.expect((select org_id is null from profiles where email='amir@example.test'), 'plain later sign-up has no organisation');
select t.expect((select org_id='00000000-0000-4000-8000-000000000001' from profiles where email='boss@example.test'), 'first sign-up joins the default org');
-- test setup: place the later sign-ups in the default org as pending members (as an admin-suspended member would be)
update profiles set org_id='00000000-0000-4000-8000-000000000001' where email <> 'boss@example.test';

-- ===== inactive driver sees nothing
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false); set role authenticated;
select t.expect((select count(*) from jobs)=0, 'inactive: no jobs');
select t.expect((select count(*) from board_posts)=0, 'inactive: no board');
select t.expect((select count(*) from profiles)=1, 'inactive: sees only own profile');
select t.expect_error($q$update profiles set active=true where id=auth.uid()$q$, 'inactive self-approve');
select t.expect_error($q$update profiles set role='admin' where id=auth.uid()$q$, 'self promote');
reset role;

-- ===== admin approves members
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false); set role authenticated;
update profiles set active=true where email='amir@example.test';
update profiles set active=true, role='planner' where email='plan@example.test';
update profiles set active=true, role='warehouse' where email='ware@example.test';
update jobs set notes=notes where ref='J-10482';  -- re-run driver linking
select t.expect((select driver_id='00000000-0000-0000-0000-00000000000b' from jobs where ref='J-10482'),'driver name linked to member');
update drivers_hours set notes=notes where driver_name='Amir Khan';
select t.expect((select count(*) from audit_log where action='update profiles' and actor_name='Test Admin')=3, 'role/approval changes audited');
select t.expect_error($q$update profiles set role='duty' where id=auth.uid()$q$, 'last admin demote');
select t.expect_error($q$update ai_models set live=false where id='hours'$q$, 'switch off legal hours guard');
update ai_models set live=false where id='yard';
select t.expect_error($q$delete from audit_log$q$, 'admin delete audit');
select t.expect_error($q$update audit_log set action='x'$q$, 'admin edit audit');
select t.expect_error($q$insert into audit_log(action) values ('fake')$q$, 'direct audit insert');
select t.expect((select count(*) from audit_log)>0, 'admin reads audit');
reset role;

-- ===== driver after approval
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false); set role authenticated;
select t.expect((select count(*) from jobs)=1, 'driver sees only own job');
select t.expect((select count(*) from drivers_hours)=1, 'driver sees only own hours');
select t.expect((select count(*) from vehicles)=0, 'driver sees no fleet');
select t.expect((select count(*) from stock_items)=0, 'driver sees no stock');
select t.expect((select count(*) from ai_decisions)=0, 'driver sees no AI queue');
select t.expect((select count(*) from audit_log)=0, 'driver sees no audit');
select t.expect((select count(*) from board_posts)=6, 'driver reads board');
update jobs set status='Delivered' where ref='J-10482';
select t.expect((select status from jobs where ref='J-10482')='Delivered','driver updates own job status');
select t.expect_error($q$update jobs set vehicle_reg='MX26 XXX' where ref='J-10482'$q$, 'driver changes vehicle');
update jobs set status='Delivered' where ref='J-10476';  -- not theirs: silently 0 rows
insert into board_posts(channel_id, body) values ('general','Hello from the cab');
select t.expect((select author_name='Amir Khan' and author_role='driver' from board_posts where body='Hello from the cab'),'post author stamped');
insert into board_posts(channel_id, body, author_id) values ('general','spoof attempt','00000000-0000-0000-0000-00000000000a');
select t.expect((select author_id=auth.uid() and author_name='Amir Khan' from board_posts where body='spoof attempt'), 'author spoof overridden to real author');
select t.expect_error($q$select public.decide_ai((select min(id) from ai_decisions), 'approved')$q$, 'driver decides AI');
select t.expect_error($q$update board_posts set removed=true where author_name like 'Owen%'$q$||'; select 1/(select count(*) from board_posts where removed)::int', 'driver moderates others');
select public.log_audit('Signed in');
reset role;

-- ===== planner decides AI
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false); set role authenticated;
select t.expect((select count(*) from jobs)=10, 'planner sees all jobs');
select t.expect((select count(*) from vehicles)=12, 'planner reads vehicles');
select t.expect_error($q$update vehicles set status='x'$q$||'; select 1/(select count(*) from vehicles where status=''x'')::int', 'planner edits fleet');
select public.decide_ai((select id from ai_decisions where subject='J-10482'), 'approved', 'test');
select t.expect((select status='approved' and approver_name='Test Planner' from ai_decisions where subject='J-10482'),'decision stored with approver');
select t.expect_error($q$select public.decide_ai((select id from ai_decisions where subject='J-10482'), 'rejected')$q$, 'decide twice');
select t.expect_error($q$update ai_decisions set status='approved'$q$||'; select 1/(select count(*) from ai_decisions where status=''approved'' and subject<>''J-10482'')::int', 'direct decision update');
select t.expect_error($q$update ai_models set live=true where id='yard'$q$||'; select 1/(select count(*) from ai_models where id=''yard'' and live)::int', 'planner changes model');
reset role;
select t.expect((select count(*) from audit_log where action='AI proposal approved' and actor_name='Test Planner')=1, 'AI decision written to audit log');

-- ===== warehouse stock movement
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false); set role authenticated;
insert into stock_movements(item_id, change, reason) select id, 600, 'Inbound CHEP' from stock_items where sku='CH-4402';
select t.expect((select qty from stock_items where sku='CH-4402')=980, 'movement adjusts qty');
select t.expect((select count(*) from jobs)=0, 'warehouse sees no jobs');
reset role;

-- ===== anon blocked
select set_config('request.jwt.claim.sub','',false); set role anon;
select t.expect_error($q$select * from profiles$q$, 'anon reads profiles');
select t.expect_error($q$select * from board_posts$q$, 'anon reads board');
reset role;

-- ===== clear example data (admin)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false); set role authenticated;
select public.clear_example_data();
select t.expect((select count(*) from jobs)=0 and (select count(*) from board_posts)=2, 'example data removed, real post kept');
reset role;
select 'ALL RLS TESTS PASSED' as result;
