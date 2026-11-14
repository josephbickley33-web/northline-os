-- =====================================================================
-- Northline EXAMPLE DATA. Illustrative only, as of 10 Nov 2026 02:00 Europe/London.
-- Every vehicle, job, stock line, hours record, post and AI proposal below is made up.
-- Rows are flagged example = true so an admin can remove them in one step
-- (Admin > Data > "Remove example data", which calls public.clear_example_data()).
-- Safe to run more than once: existing rows are left alone.
-- =====================================================================

insert into public.depots(code, name, region, pallet_locations, occupancy_pct, notes, example) values
  ('Daventry','Daventry DIRFT','Midlands',22400,91,'Planning, workshop and grocery primary',true),
  ('Trafford','Trafford Park','North West',14200,84,'Secondary distribution and frozen outbound',true),
  ('Tilbury','Tilbury','South East',11400,88,'Store intake and Irish Sea staging',true),
  ('Bellshill','Bellshill','Scotland',6800,61,'Scottish trunk and backload',true)
on conflict (code) do nothing;

insert into public.vehicles(reg, type, depot, status, mot_due, next_service, odometer, notes, example) values
  ('MX26 MRD','44t artic','Daventry','On route','2027-03-14','2026-12-02',148210,'J-10482',true),
  ('MX26 HN3','44t artic','Daventry','On route','2027-05-09','2026-11-28',201455,'J-10476',true),
  ('MX26 IR9','44t artic','Bellshill','On route','2027-01-22','2026-12-15',176002,'Holyhead sailing',true),
  ('MX26 FR2','44t artic','Tilbury','On route','2027-04-30','2026-12-20',98340,null,true),
  ('MX26 PL4','44t artic','Daventry','Available','2027-02-11','2026-11-30',121877,'Spare tractor parked for S. Walsh',true),
  ('MX26 RG8','26t rigid','Trafford','On route','2027-06-18','2027-01-08',88420,null,true),
  ('MX26 KT1','18t rigid','Trafford','On route','2027-07-02','2027-01-15',64310,null,true),
  ('MX26 UZ4','26t rigid','Daventry','On route','2027-03-03','2026-12-11',73990,null,true),
  ('MX26 RF1','Reefer','Trafford','On route','2027-02-27','2026-12-04',112004,'Setpoint -22C',true),
  ('MX26 FR8','44t artic','Daventry','Workshop','2027-01-19','2026-11-12',233180,'Turbo inspection Thu 12 Nov 08:00-14:00',true),
  ('MX26 KX2','44t artic','Tilbury','Off road','2027-05-21','2026-12-09',187655,'Fuel anomaly: 41 litres unexplained. Investigation open.',true),
  ('MX26 TY6','26t rigid','Daventry','Off road','2026-12-30','2026-11-07',156230,'PMI overdue: keep off every run sheet',true)
on conflict (reg) do nothing;

insert into public.drivers_hours(driver_name, day, driving_minutes, weekly_minutes, break_minutes, notes, example) values
  ('Amir Khan','2026-11-10',525,2610,45,'About 15 minutes of daily driving left',true),
  ('D. McLean','2026-11-10',525,2880,45,'15 minutes from the daily limit',true),
  ('S. Walsh','2026-11-10',95,1820,0,'Available for J-10482 reassignment',true),
  ('C. Evans','2026-11-10',310,2240,45,null,true),
  ('L. O''Neill','2026-11-10',280,1990,45,null,true),
  ('P. Reid','2026-11-10',360,2450,45,'48 minutes slack after hours remainder',true),
  ('M. Begum','2026-11-10',150,1500,0,null,true),
  ('R. Cole','2026-11-10',200,2100,30,null,true),
  ('J. Patel','2026-11-10',240,1760,45,null,true)
on conflict (driver_name, day) do nothing;

insert into public.jobs(ref, customer, origin, destination, pallets, delivery_window, status, vehicle_reg, driver_name, rate_gbp, cost_gbp, notes, example) values
  ('J-10482','Grocery primary','Daventry','Trafford Park',26,'05:30 receive','At risk','MX26 MRD','Amir Khan',742,655,'AI: reassign to MX26 PL4 and S. Walsh',true),
  ('J-10476','Retail night trunk','Daventry','Tilbury',26,'04:45 gate-in','At risk','MX26 HN3','D. McLean',910,812,'Driver 15 minutes from the daily limit',true),
  ('J-10499','Irish Sea green lane','Bellshill','Holyhead',24,'03:30 ferry','Watch','MX26 IR9','C. Evans',1380,1190,'GVMS pre-lodged; ETA interval is wide',true),
  ('J-10491','Store intake','Tilbury','Daventry DIRFT',26,'06:15 book-in','On time','MX26 FR2','L. O''Neill',880,701,'ETA 05:52 to 06:09 at 90% confidence',true),
  ('J-10488','Backload','Glasgow','Daventry',22,'14:00','On time','MX26 PL4','S. Walsh',1120,905,'Fills the empty southbound leg',true),
  ('J-10507','Manchester multi-drop','Trafford Park','Manchester',14,'12:00 last drop','Watch','MX26 RG8','P. Reid',520,430,'48 minutes slack',true),
  ('J-10518','Spot load','Birmingham','Glasgow',26,'18:00','Held',null,null,960,930,'Auto-accept blocked; margin 3.1% after empty running',true),
  ('J-10522','Secondary','Trafford Park','Leeds',18,'08:00','On time','MX26 KT1','M. Begum',410,318,'Assignment confidence 0.93',true),
  ('J-10531','Clean Air Zone delivery','Daventry','Bristol',16,'10:30','Watch','MX26 UZ4','R. Cole',590,470,'Reroute avoids the CAZ charge',true),
  ('J-10540','Frozen outbound','Trafford Park','Stockport',20,'07:00','On time','MX26 RF1','J. Patel',640,512,'Reefer setpoint stable',true)
on conflict (ref) do nothing;

insert into public.stock_items(sku, name, depot, qty, reorder_point, location, example) values
  ('CH-4402','CHEP pallets','Daventry',380,800,'Yard B',true),
  ('FG-1188','Ambient grocery','Trafford',1240,1500,'Aisle 14',true),
  ('PK-902','Stretch wrap','Daventry',96,120,'Consumables cage',true),
  ('PK-902','Stretch wrap','Tilbury',60,80,'Consumables cage',true),
  ('FZ-331','Frozen mixed','Tilbury',2100,1200,'Freezer door 7',true),
  ('RM-204','Packaging','Daventry',5400,900,'Mezzanine 2',true),
  ('FG-2201','Retail secondary','Trafford',3300,1100,'Aisle 3',true)
on conflict (sku, depot) do nothing;

insert into public.board_channels(id, name, sort) values
  ('night','Night operations',1),('daventry','Daventry',2),('trafford','Trafford',3),
  ('tilbury','Tilbury',4),('safety','Safety and compliance',5),('general','General',6)
on conflict (id) do nothing;

insert into public.board_posts(channel_id, author_name, author_role, body, created_at, example)
select * from (values
  ('night','Owen Blake (example)','duty','J-10482 and J-10476 are both inside the last 15 minutes of daily driving. Please do not add work. I will take the reassignments in the approval queue before 03:00.','2026-11-10 01:12+00'::timestamptz,true),
  ('night','Priya Shah (example)','admin','Keep MX26 TY6 off every run sheet until the overdue PMI is closed. If a customer chases Trafford, use the 90% ETA interval, not a single time.','2026-11-10 01:26+00',true),
  ('daventry','Ioan Rees (example)','workshop','Turbo inspection for MX26 FR8 is held for Thursday 12 November, 08:00-14:00. I need the vehicle on the pit, not in the yard queue.','2026-11-09 21:40+00',true),
  ('tilbury','Sofia Almeida (example)','warehouse','Door 7 is congested on frozen mixed. I will split FZ-331 if the next wave is not already on the dock.','2026-11-09 22:15+00',true),
  ('safety','Owen Blake (example)','duty','Agency driver T. Greene stays unassigned until the licence check is complete. No exceptions from the board, please.','2026-11-09 23:04+00',true),
  ('general','Mei Chen (example)','planner','Glasgow backload is filling the empty southbound this week. Empty running is 11.4%. Please offer any northbound spare capacity to planning before you take a cheap spot.','2026-11-09 18:42+00',true)
) v(channel_id, author_name, author_role, body, created_at, example)
where not exists (select 1 from public.board_posts where example);

insert into public.board_replies(post_id, author_name, author_role, body, created_at, example)
select p.id, 'Mei Chen (example)', 'planner', 'Understood. I have parked a spare tractor for Walsh at Daventry.', '2026-11-10 01:18+00', true
from public.board_posts p
where p.example and p.body like 'J-10482 and J-10476%'
  and not exists (select 1 from public.board_replies where example);

insert into public.info_articles(slug, title, body, sort) values
  ('hours','GB drivers'' hours','GB drivers'' hours, working time and tachograph rules are hard constraints. A confidence score cannot override them, and the planner cannot auto-assign a journey that would breach a limit.

- Daily driving is treated as a hard stop, not a target to lean on.
- The hours guard uses the remaining-time forecast and the live tachograph file.
- If a ferry, gate or traffic delay would pinch a limit, the journey is queued for a person.
- This page is a working brief, not official legal advice. Always check the current GOV.UK rules.',1),
  ('licence','Operator licence duties','The people who hold the operator licence stay accountable for vehicles, drivers and records. The system is built to make that easier, not to take the duty away.

- Vehicles off road or past PMI are blocked from the run sheet.
- Walk-around defects should be closed within 24 hours.
- Agency drivers are held until licence checks are current.
- The audit log keeps the recommendation, the interval, and the name of the person who accepted or changed it.',2),
  ('ai','How AI is allowed to act','Northline uses specialist models, each with a job, a confidence rule, a legal envelope and a named owner. If a model is uncertain, or the action could affect safety, the operator licence or a customer promise, it abstains and waits.

- Train and calibrate on the operator''s own data, held in the UK.
- Prove the legal envelope in a digital twin.
- Shadow the live operation for at least 28 days.
- Act only inside the agreed gate. Everything else goes to the approval queue.',3),
  ('safety','Safety reporting','Fuel and telematics anomalies open an investigation; they do not record a finding on their own. Defects, near misses and hours concerns should be posted in Safety and compliance, and raised with the duty manager if a vehicle is still in service.

If a vehicle is unsafe, take it off the road first, then write it up. Do not wait for a model to agree.',4),
  ('data','Bringing in your real data','Admins, duty managers, planners, workshop and warehouse staff can import CSV files from the Admin or section pages.

- Vehicles: reg, type, depot, status, mot_due, next_service, odometer
- Jobs: ref, customer, origin, destination, pallets, delivery_window, status, vehicle_reg, driver_name, rate_gbp, cost_gbp
- Stock: sku, name, depot, qty, reorder_point, location

Dates use YYYY-MM-DD. Rows with an existing reg, ref or sku+depot are updated rather than duplicated.',5)
on conflict (slug) do nothing;

insert into public.ai_models(id, name, technique, mode, live, locked, gate, owner) values
  ('eta','ETA engine','Gradient boosting with conformal prediction on telematics, traffic and gate times','Live',true,false,'Customer ETAs update automatically only when the 90% interval stays inside the window; otherwise the journey is queued','Planning'),
  ('hours','Legal hours guard','Rule engine plus remaining-time forecast against GB drivers'' hours, working time and tachograph rules','Live, hard constraint',true,true,'The system never assigns a journey that would breach legal hours.','Duty manager'),
  ('rul','Workshop remaining life','Survival model on ECU fault codes, mileage and PMI history','Live advisory',true,false,'No workshop slot is booked until a controller accepts the recommendation','Workshop'),
  ('plan','Network planner','Mixed-integer routing with time windows, weight, driver hours and Clean Air Zone costs','Live on trunk, shadow on local',true,false,'A planner must accept the run sheet before it is committed','Planning'),
  ('stock','Stock forecast','Hierarchical forecast by warehouse, customer and SKU','Live proposals',true,false,'Purchase orders over £5,000 need a buyer','Inventory'),
  ('fuel','Fuel and telematics anomalies','Residual monitoring and isolation detection','Live alerts',true,false,'Alerts open a secure investigation; the model never records a finding on its own','Security'),
  ('yard','Yard slot agent','Constrained policy, trained and tested only in the digital twin','Shadow only',false,false,'No live yard instruction until shadow error stays inside the agreed band for 28 days','Yard lead'),
  ('spot','Spot pricing','Calibrated margin model including empty running and late risk','Live reject, human accept',true,false,'The model may block a loss-making load; it never auto-accepts work','Commercial')
on conflict (id) do nothing;

insert into public.ai_decisions(subject, proposal, reason, model, confidence, confidence_interval, owner, example)
select * from (values
  ('J-10482','Reassign to MX26 PL4 and S. Walsh','Hours limit on the current driver','plan',0.94,'ETA 05:10-05:28 (90%)','Duty manager',true),
  ('J-10476','Change driver at the next safe stop','Daily hours hard stop','hours',0.97,'Limit reached 02:41-02:49 (90%)','Duty manager',true),
  ('MX26 FR8','Book turbo inspection on 12 November at Daventry','Workshop time needs a controller','rul',0.81,'Failure within 9-23 days (80%)','Workshop',true),
  ('MX26 KX2','Secure the vehicle and open a fuel investigation','Anomaly is not a finding','fuel',0.88,'38-44 litres unexplained (90%)','Security',true),
  ('J-10518','Do not auto-accept the Birmingham to Glasgow spot','Margin after empty running is 3.1%','spot',0.86,'Margin 1.2%-4.9% (90%)','Commercial',true),
  ('CH-4402','Inbound 600 CHEP pallets on Thursday','Purchase over the buyer threshold','stock',0.91,'Demand 540-660 (90%)','Inventory',true)
) v(subject, proposal, reason, model, confidence, confidence_interval, owner, example)
where not exists (select 1 from public.ai_decisions where example);
