// LOCAL TEST ONLY: headless Chrome through the SaaS flows against the local stack (reset.sh).
// Desktop 1280x900 and iPhone 13 viewports. Screenshots go to /tmp/e2e-*.png.
const puppeteer = require('puppeteer-core'); const fs = require('fs'); const { Client } = require('pg');
const BASE = 'http://localhost:8766/', APP = BASE + 'app/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (c, l) => { results.push((c ? 'PASS ' : 'FAIL ') + l); };
const db = new Client({ host:'/tmp', port:54329, user:'postgres', database:'nl2' });
async function newPage(browser, mobile, url){
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  page.errs = [];
  page.on('console', m => { if (m.type() === 'error') page.errs.push(m.text()); });
  page.on('pageerror', e => page.errs.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  if (mobile) await page.emulate(puppeteer.KnownDevices['iPhone 13']); else await page.setViewport({ width:1280, height:900 });
  await page.goto(url || APP, { waitUntil:'networkidle0' }); await sleep(600);
  return page;
}
const text = (p) => p.evaluate(() => document.body.innerText);
const mainText = (p) => p.$eval('#main', e => e.innerText);
async function fill(p, sel, v){ await p.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles:true })); }, v); }
async function nav(p, view){
  const mobile = await p.evaluate(() => window.innerWidth <= 980);
  if (mobile) { await p.click('#menuBtn'); await sleep(250); }
  await p.click(`[data-view="${view}"]`); await sleep(1000);
}
async function adminTab(p, tab){ await nav(p, 'admin'); await p.click(`[data-admin-tab="${tab}"]`); await sleep(1100); }
async function signIn(p, email, pass){ await fill(p, 'input[name=email]', email); await fill(p, 'input[name=password]', pass); await p.click('#authForm button[type=submit]'); await sleep(1800); }

(async () => {
  await db.connect();
  const browser = await puppeteer.launch({ executablePath:'/usr/bin/google-chrome', headless:'new', args:['--no-sandbox'] });

  // 0. The owner already exists (as on the live project): first account on the system, in the default org.
  await fetch('http://localhost:54321/auth/v1/signup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email:'owner@icloud.test', password:'owner-pass-1', data:{ full_name:'Joseph Owner' } }) });

  // 1. Sales website (desktop + iPhone)
  const site = await newPage(browser, false, BASE);
  let t = await text(site);
  ok(t.includes('Start your 14-day free trial') && t.includes('Book a demo') && t.includes('£15') && t.includes('half price for the first 30 days'), 'sales site renders hero, CTAs, pricing and pilot offer');
  for (const id of ['problem','features','ai','security','pricing','faq','demo']) ok(!!(await site.$('#' + id)), 'sales site section: ' + id);
  await site.screenshot({ path:'/tmp/e2e-site-desktop.png' });
  await site.screenshot({ path:'/tmp/e2e-site-desktop-full.png', fullPage:true });
  await fill(site, '#leadForm input[name=name]', 'Jo Bloggs'); await fill(site, '#leadForm input[name=company]', 'Bloggs Haulage');
  await fill(site, '#leadForm input[name=email]', 'jo@bloggs.test'); await site.select('#leadForm select[name=fleet_size]', '26–50 vehicles');
  await fill(site, '#leadForm textarea[name=message]', 'Interested in walkaround checks');
  await site.click('#leadBtn'); await sleep(1200);
  ok((await site.$eval('#leadMsg', e => e.innerText)).includes('request has been received'), 'Book a demo stores the lead');
  ok((await db.query("select count(*)::int n from leads where email='jo@bloggs.test'")).rows[0].n === 1, 'lead row in database');
  const siteM = await newPage(browser, true, BASE);
  await siteM.screenshot({ path:'/tmp/e2e-site-iphone.png' });
  await siteM.click('#menuToggle'); await sleep(300); await siteM.screenshot({ path:'/tmp/e2e-site-iphone-menu.png' });
  ok(await siteM.evaluate(() => getComputedStyle(document.querySelector('.nav-links')).display === 'flex'), 'iPhone menu opens');
  ok(await siteM.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'iPhone: no horizontal scroll on sales site');
  await siteM.evaluate(() => document.getElementById('pricing').scrollIntoView()); await sleep(300); await siteM.screenshot({ path:'/tmp/e2e-site-iphone-pricing.png' });
  for (const pg of ['privacy','terms','dpa','cookies']) { const r = await fetch(BASE + 'legal/' + pg + '.html'); const h = await r.text(); ok(r.ok && h.includes('Template: needs review by a qualified UK lawyer'), 'legal page ' + pg + ' marked as template'); }
  const demo = await newPage(browser, true, BASE + 'demo/');
  t = await text(demo); ok(/Priya Shah/.test(t) && demo.errs.filter(e => !/404/.test(e)).length === 0, 'old demo still works at /demo/');
  await demo.screenshot({ path:'/tmp/e2e-demo-iphone.png' });

  // 2. Owner signs in: default org data, platform admin, alerts bell
  const owner = await newPage(browser, false);
  await signIn(owner, 'owner@icloud.test', 'owner-pass-1');
  t = await text(owner);
  ok(t.includes('Northline (demo)') && t.includes('Platform'), 'owner signs in to default org with Platform menu');
  const bell = Number(await owner.$eval('#bellCount', e => e.textContent)); ok(bell > 0, 'owner bell shows alerts: ' + bell);
  await owner.screenshot({ path:'/tmp/e2e-owner-home.png' });
  for (const v of ['command','network','fleet','checks','people','stock','finance','ai','board','info','admin','platform']) {
    await nav(owner, v); t = await mainText(owner);
    ok(!/Could not load this page/.test(t), 'owner view loads: ' + v);
    if (v === 'fleet') ok(t.includes('MX26 TY6'), 'existing vehicles visible under default org');
    if (v === 'board') ok(t.includes('Owen Blake (example)'), 'existing board posts visible under default org');
    if (v === 'platform') ok(t.includes('Northline (demo)'), 'platform lists default org');
  }
  await owner.click('#bellBtn'); await sleep(500); t = await owner.$eval('#modalCard', e => e.innerText);
  ok(/MOT|Low stock|Waiting for approval/.test(t), 'bell lists alerts'); await owner.screenshot({ path:'/tmp/e2e-owner-bell.png' });
  await owner.click('#modalCard [data-close]'); await sleep(200);
  await nav(owner, 'ai'); await owner.click('[data-decide="approved"]'); await sleep(300);
  await fill(owner, '#decForm textarea[name=note]', 'Approved in SaaS e2e'); await owner.click('#decForm button[type=submit]'); await sleep(1200);
  ok((await mainText(owner)).includes('Approved in SaaS e2e'), 'AI approval works under default org');
  await adminTab(owner, 'billing'); t = await mainText(owner);
  ok(t.includes('Billing not connected yet'), 'billing tab says not connected (no Stripe keys)');

  // 3. New haulier starts a free trial on iPhone
  const boss = await newPage(browser, true, APP + '?start=trial');
  t = await text(boss); ok(t.includes('Start your free trial'), 'start=trial opens trial form');
  await boss.screenshot({ path:'/tmp/e2e-trial-form-iphone.png' });
  await fill(boss, 'input[name=org_name]', 'Bravo Haulage Ltd'); await fill(boss, 'input[name=full_name]', 'Bea Boss');
  await fill(boss, 'input[name=email]', 'bea@bravo.test'); await fill(boss, 'input[name=password]', 'bravo-pass-1');
  await boss.click('#authForm button[type=submit]'); await sleep(2200);
  t = await text(boss);
  ok(t.includes('Bravo Haulage Ltd') && /Free trial: 14 days left/.test(t), 'trial workspace created, banner shows 14 days');
  await boss.screenshot({ path:'/tmp/e2e-trial-home-iphone.png' });
  await nav(boss, 'fleet'); t = await mainText(boss); ok(!t.includes('MX26 TY6') && t.includes('No vehicles yet'), 'ISOLATION: new org sees none of the default org vehicles');
  await nav(boss, 'board'); t = await mainText(boss); ok(!t.includes('Owen Blake'), 'ISOLATION: new org sees none of the default org posts');
  await nav(boss, 'network'); t = await mainText(boss); ok(!t.includes('J-10482'), 'ISOLATION: new org sees none of the default org jobs');
  const bossNav = await boss.$$eval('#sidebar [data-view]', els => els.map(e => e.dataset.view)); ok(!bossNav.includes('platform'), 'new org admin has no Platform menu');
  // add vehicle
  await nav(boss, 'fleet'); await boss.click('[data-new-vehicle]'); await sleep(300);
  await fill(boss, '#vehForm input[name=reg]', 'bv26 one'); await fill(boss, '#vehForm input[name=mot_due]', new Date(Date.now() + 10*86400000).toISOString().slice(0,10));
  await boss.click('#vehForm button[type=submit]'); await sleep(1200);
  ok((await mainText(boss)).includes('BV26 ONE'), 'new org adds a vehicle');
  // branding
  await adminTab(boss, 'company'); await fill(boss, '#companyForm input[name=name]', 'Bravo Haulage'); await fill(boss, '#brandHex', '#1d4ed8');
  await boss.click('#companyForm button[type=submit]'); await sleep(1500);
  ok((await boss.$eval('#sidebar', e => e.innerText)).includes('Bravo Haulage'), 'branding: name in sidebar');
  ok((await boss.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) === '#1d4ed8', 'branding: colour applied');
  // billing
  await adminTab(boss, 'billing'); t = await mainText(boss);
  ok(/trial days left/i.test(t) && t.includes('14') && t.includes('Billing not connected yet') && t.includes('£15'), 'billing page: trial days left, not connected, plans');
  await boss.screenshot({ path:'/tmp/e2e-billing-iphone.png', fullPage:true });
  await boss.click('[data-plan="starter"]'); await sleep(1500);
  ok((await boss.$eval('#billingMsg', e => e.innerText)).includes('Billing not connected yet'), 'choosing a plan without Stripe keeps trial and says not connected');
  // invite a driver
  await adminTab(boss, 'members'); await fill(boss, '#inviteForm input[name=email]', 'dan@bravo.test'); await boss.select('#inviteForm select[name=role]', 'driver');
  await boss.click('#inviteForm button[type=submit]'); await sleep(1500);
  const link = await boss.$eval('#inviteLinkBox', e => e.value); ok(/\?invite=[a-f0-9]{40,}/.test(link), 'invite link created');
  await boss.screenshot({ path:'/tmp/e2e-invite-iphone.png' });
  await boss.click('#modalCard [data-close]'); await sleep(200);

  // 4. Driver joins by invite link (iPhone), walkaround check with a defect + photo, proof of delivery with signature
  const drv = await newPage(browser, true, link.replace('http://localhost:8766/app/', APP));
  t = await text(drv); ok(t.includes('Join Bravo Haulage') && t.includes('Driver'), 'invite link shows company and role');
  await drv.screenshot({ path:'/tmp/e2e-invite-signup-iphone.png' });
  await fill(drv, 'input[name=full_name]', 'Dan Driver'); await fill(drv, 'input[name=password]', 'dan-pass-123');
  await drv.click('#authForm button[type=submit]'); await sleep(2200);
  t = await text(drv); ok(t.includes('My jobs') && t.includes('Bravo Haulage'), 'invited driver lands in Bravo as driver');
  const drvNav = await drv.$$eval('#sidebar [data-view]', els => els.map(e => e.dataset.view)); ok(JSON.stringify(drvNav) === '["home","checks","board","info"]', 'driver menu: ' + drvNav.join(','));
  const orgB = (await db.query("select id from organisations where name='Bravo Haulage'")).rows[0].id;
  await db.query("select set_config('northline.org_id', $1, false)", [orgB]);
  await db.query("insert into jobs(org_id, ref, customer, origin, destination, status, vehicle_reg, driver_name) values ($1,'BR-1','Acme Retail','Leeds','Hull','On time','BV26 ONE','Dan Driver')", [orgB]);
  await drv.reload({ waitUntil:'networkidle0' }); await sleep(1500);
  ok((await mainText(drv)).includes('BR-1'), 'driver sees own Bravo job');
  fs.writeFileSync('/tmp/e2e-photo.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  await drv.click('[data-new-check]'); await sleep(700);
  await fill(drv, '#checkForm input[name=vehicle_reg]', 'BV26 ONE'); await fill(drv, '#checkForm input[name=odometer]', '120500');
  await drv.click('#checkForm input[name="ci1"][value="defect"]'); await drv.select('#checkForm select[name=severity]', 'major');
  await fill(drv, '#checkForm textarea[name=notes]', 'Offside rear marker out');
  await (await drv.$('#checkPhotos')).uploadFile('/tmp/e2e-photo.png');
  await drv.screenshot({ path:'/tmp/e2e-walkaround-iphone.png' });
  await drv.click('#checkForm button[type=submit]'); await sleep(2500);
  const chk = (await db.query("select defects_found, array_length(photo_paths,1) n, photo_paths[1] p from walkaround_checks where vehicle_reg='BV26 ONE'")).rows[0];
  ok(chk && chk.defects_found && chk.n === 1 && chk.p.startsWith(orgB + '/checks/'), 'walkaround check stored with photo in org folder');
  ok((await db.query("select count(*)::int n from defect_reports where vehicle_reg='BV26 ONE' and severity='major'")).rows[0].n === 1, 'defect sent to workshop');
  await drv.click('[data-pod]'); await sleep(700);
  await fill(drv, '#podForm input[name=received_by]', 'Sam Goods-In');
  const box = await (await drv.$('#sigPad')).boundingBox();
  await drv.mouse.move(box.x + 20, box.y + 40); await drv.mouse.down(); await drv.mouse.move(box.x + 120, box.y + 120, { steps:8 }); await drv.mouse.move(box.x + 220, box.y + 50, { steps:8 }); await drv.mouse.up();
  await drv.screenshot({ path:'/tmp/e2e-pod-iphone.png' });
  await drv.click('#podForm button[type=submit]'); await sleep(2500);
  const pod = (await db.query("select p.signature_path, j.status from delivery_proofs p join jobs j on j.id=p.job_id where j.ref='BR-1'")).rows[0];
  ok(pod && pod.status === 'Delivered' && pod.signature_path.startsWith(orgB + '/pod/'), 'proof of delivery with signature marks job delivered');

  // 5. Boss sees the defect and POD; bell counts the defect; vehicle limit enforced
  await nav(boss, 'checks'); t = await mainText(boss);
  ok(t.includes('BV26 ONE') && t.includes('Sam Goods-In'), 'admin sees driver check, defect and POD');
  await boss.click('[data-photos]'); await sleep(1200);
  ok(await boss.$eval('#modalCard', e => !!e.querySelector('img')), 'uploaded photo opens via signed URL');
  await boss.screenshot({ path:'/tmp/e2e-checks-iphone.png' }); await boss.click('#modalCard [data-close]'); await sleep(200);
  await boss.evaluate(() => document.getElementById('bellBtn').click()); await sleep(600);
  ok((await boss.$eval('#modalCard', e => e.innerText)).includes('Defect on BV26 ONE'), 'bell shows the open defect'); await boss.click('#modalCard [data-close]');
  await db.query("update organisations set vehicle_limit=1 where id=$1", [orgB]);
  await nav(boss, 'fleet'); await boss.click('[data-new-vehicle]'); await sleep(300);
  await fill(boss, '#vehForm input[name=reg]', 'BV26 TWO'); await boss.click('#vehForm button[type=submit]'); await sleep(1200);
  ok((await boss.$eval('#toast', e => e.innerText)).includes('Vehicle limit reached'), 'vehicle limit enforced in app');
  await boss.click('#modalCard [data-close]').catch(() => {});
  // trial expiry -> read only banner
  await db.query("update organisations set trial_ends_at=now()-interval '1 minute' where id=$1", [orgB]);
  await boss.reload({ waitUntil:'networkidle0' }); await sleep(1500);
  ok((await text(boss)).includes('Your free trial has ended'), 'expired trial shows read-only banner');
  await boss.screenshot({ path:'/tmp/e2e-expired-iphone.png' });

  // 6. Owner: platform lists Bravo with counts; extend trial; demo request visible
  await nav(owner, 'platform'); t = await mainText(owner);
  ok(t.includes('Bravo Haulage') && t.includes('bea@bravo.test'), 'platform lists the new org and its admin');
  await owner.screenshot({ path:'/tmp/e2e-platform.png' });
  const ext = await owner.$$('[data-extend]'); await ext[ext.length - 1].click(); await sleep(1200);
  ok((await db.query("select trial_ends_at > now() + interval '13 days' ok from organisations where id=$1", [orgB])).rows[0].ok, 'platform admin extends trial');
  await owner.click('[data-platform-tab="leads"]'); await sleep(1000);
  ok((await mainText(owner)).includes('Bloggs Haulage'), 'platform shows demo request');
  // CSV import with per-org keys + export
  fs.writeFileSync('/tmp/vehicles.csv', 'reg,type,depot,status,mot_due\nab12 cde,44t artic,Daventry,Available,14/03/2027\nMX26 MRD,44t artic,Daventry,On route,2027-03-15\n');
  await nav(owner, 'fleet'); await owner.click('[data-csv="vehicles"]'); await sleep(400);
  await (await owner.$('#csvFile')).uploadFile('/tmp/vehicles.csv'); await sleep(800); await owner.click('#csvGo'); await sleep(1800);
  t = await mainText(owner); ok(t.includes('AB12 CDE'), 'CSV import (upsert on org + reg) works');
  ok((await db.query("select mot_due::text d from vehicles where reg='MX26 MRD' and org_id='00000000-0000-4000-8000-000000000001'")).rows[0].d === '2027-03-15', 'CSV upsert updated existing default-org vehicle');
  ok((await db.query("select count(*)::int n from vehicles where reg='MX26 MRD'")).rows[0].n === 1, 'CSV upsert did not touch other orgs');

  // 7. Org-less sign-in path: an account with no company sees trial/invite choice
  await fetch('http://localhost:54321/auth/v1/signup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email:'solo@x.test', password:'solo-pass-1', data:{ full_name:'Solo Person' } }) });
  const solo = await newPage(browser, false); await signIn(solo, 'solo@x.test', 'solo-pass-1');
  ok((await text(solo)).includes('You are not part of a company yet'), 'org-less account gets trial / invite choice');
  await fill(solo, '#noOrgTrial input[name=org_name]', 'Solo Freight'); await solo.click('#noOrgTrial button[type=submit]'); await sleep(2000);
  ok((await text(solo)).includes('Solo Freight'), 'org-less account starts its own trial');

  await owner.click('#signOutBtn'); await sleep(1500); ok((await text(owner)).includes('Sign in'), 'sign out returns to sign-in');
  const errs = [owner, boss, drv, site, siteM, solo].flatMap(p => p.errs).filter(e => !/realtime|websocket/i.test(e) && !/status of 4\d\d/.test(e));
  console.log(results.join('\n'));
  console.log('PASSED', results.filter(r => r.startsWith('PASS')).length, 'FAILED', results.filter(r => r.startsWith('FAIL')).length);
  console.log('CONSOLE ERRORS (excluding realtime, which the local gateway does not provide, and expected 4xx):', errs.length ? '\n' + errs.join('\n') : 'none');
  await browser.close(); await db.end();
})().catch(async e => { console.error(results.join('\n')); console.error(e); process.exit(1); });
