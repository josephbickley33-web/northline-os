-- LOCAL TESTING ONLY. Driver tools: walkaround checks, defects, proof of delivery, storage folder rules.
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
grant usage on schema t to authenticated, anon; grant execute on all functions in schema t to authenticated, anon;
create table if not exists t.ids(k text primary key, v text); grant all on t.ids to authenticated, anon;
insert into t.ids select 'jobOther', id::text from jobs where ref='J-10476';
insert into t.ids select 'jobA', min(id)::text from jobs where org_id='00000000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data) values
 ('a0000000-0000-0000-0000-00000000000a','owner@a.test','{"full_name":"Owner A"}'),
 ('b0000000-0000-0000-0000-00000000000b','boss@b.test','{"full_name":"Boss B","org_name":"Bravo"}');
-- driver in A via invite
select t.as_user('a0000000-0000-0000-0000-00000000000a'); set role authenticated;
create temp table inv as select (public.create_invite('amir@a.test','driver')).token tok;
reset role;
insert into auth.users(id,email,raw_user_meta_data) select 'd0000000-0000-0000-0000-00000000000d','amir@a.test', jsonb_build_object('full_name','Amir Khan','invite',tok) from inv;
update jobs set notes = notes where ref = 'J-10482';  -- link driver by name
select t.expect((select driver_id='d0000000-0000-0000-0000-00000000000d' from jobs where ref='J-10482'), 'job linked to invited driver');

select t.as_user('d0000000-0000-0000-0000-00000000000d'); set role authenticated;
insert into walkaround_checks(vehicle_reg, odometer, items, photo_paths)
  values ('mx26 mrd', 148300, '[{"item":"Tyres","ok":true},{"item":"Lights","ok":false}]', array['00000000-0000-4000-8000-000000000001/checks/a.jpg']);
select t.expect((select vehicle_reg='MX26 MRD' and defects_found and driver_name='Amir Khan' from walkaround_checks), 'check stored, defect flag derived, driver stamped');
select t.expect_error($q$insert into walkaround_checks(vehicle_reg, photo_paths) values ('MX26 MRD', array['other-org/x.jpg'])$q$, 'photo outside org folder');
insert into defect_reports(vehicle_reg, severity, description) values ('MX26 MRD','major','Nearside headlamp out');
select t.expect((select count(*)=1 from defect_reports), 'driver sees own defect');
select t.expect_error($q$update defect_reports set status='fixed'$q$||'; select 1/(select count(*) from defect_reports where status=''fixed'')::int', 'driver closes defect');
insert into delivery_proofs(job_id, received_by, signature_path) select id, 'J. Smith (goods in)', '00000000-0000-4000-8000-000000000001/pod/sig.png' from jobs where ref='J-10482';
select t.expect((select status='Delivered' from jobs where ref='J-10482'), 'POD marks job delivered');
select t.expect_error($q$insert into delivery_proofs(job_id, received_by) values ((select v::bigint from t.ids where k='jobOther'), 'x')$q$, 'driver PODs someone else''s job');
-- storage: own org folder only
insert into storage.objects(bucket_id, name) values ('driver-uploads', '00000000-0000-4000-8000-000000000001/checks/a.jpg');
select t.expect_error($q$insert into storage.objects(bucket_id, name) values ('driver-uploads', 'ffffffff-0000-4000-8000-000000000001/x.jpg')$q$, 'upload to another org folder');
reset role;
-- workshop view and cross-org
select t.as_user('a0000000-0000-0000-0000-00000000000a'); set role authenticated;
select t.expect((select count(*)=1 from defect_reports) and (select count(*)=1 from walkaround_checks) and (select count(*)=1 from delivery_proofs), 'admin sees driver records');
update defect_reports set status='in_progress', resolution='Bulb ordered';
select t.expect((select count(*)>0 from alerts() where kind='defect'), 'open defect alert for admin');
select t.expect_error($q$update defect_reports set description='rewritten'$q$, 'admin rewrites defect text (column not granted)');
reset role;
select t.as_user('b0000000-0000-0000-0000-00000000000b'); set role authenticated;
select t.expect((select count(*)=0 from defect_reports) and (select count(*)=0 from walkaround_checks) and (select count(*)=0 from delivery_proofs), 'other org sees no driver records');
select t.expect((select count(*)=0 from storage.objects), 'other org sees no files');
select t.expect_error($q$insert into delivery_proofs(job_id, received_by) values ((select v::bigint from t.ids where k='jobA'), 'x')$q$, 'POD on other org job');
select t.expect_error($q$insert into storage.objects(bucket_id, name) values ('driver-uploads', '00000000-0000-4000-8000-000000000001/evil.jpg')$q$, 'upload into A folder');
reset role;
select 'ALL DRIVER TESTS PASSED' as result;
