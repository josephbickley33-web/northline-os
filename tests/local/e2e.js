const puppeteer = require('puppeteer-core'); const fs = require('fs');
const URL_ = 'http://localhost:8766/app/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (c, l) => { results.push((c ? 'PASS ' : 'FAIL ') + l); };
async function newUser(browser, mobile){
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  page.errs = [];
  page.on('console', m => { if (m.type() === 'error') page.errs.push(m.text()); });
  page.on('pageerror', e => page.errs.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.request().method(), r.url().slice(0,150)); });
  if (mobile) await page.emulate(puppeteer.KnownDevices['iPhone 13']); else await page.setViewport({ width:1280, height:900 });
  await page.goto(URL_, { waitUntil:'networkidle0' }); await sleep(500);
  return page;
}
const text = (p) => p.evaluate(() => document.body.innerText);
async function fill(p, sel, v){ await p.$eval(sel, (el, v) => { el.value = v; }, v); }
async function signup(p, name, email){
  await p.click('[data-auth-tab="signup"]'); await sleep(200);
  await fill(p, 'input[name=full_name]', name); await fill(p, 'input[name=email]', email); await fill(p, 'input[name=password]', 'secret-pass-1');
  await p.click('#authForm button[type=submit]'); await sleep(1500);
}
async function nav(p, view){
  const mobile = await p.evaluate(() => window.innerWidth <= 980);
  if (mobile) { await p.click('#menuBtn'); await sleep(250); }
  await p.click(`[data-view="${view}"]`); await sleep(900);
}
(async () => {
  const browser = await puppeteer.launch({ executablePath:'/usr/bin/google-chrome', headless:'new', args:['--no-sandbox'] });
  // 1. first user becomes admin
  const admin = await newUser(browser, false);
  ok((await text(admin)).includes('Sign in'), 'sign-in screen renders when connected');
  await admin.screenshot({ path:'/tmp/e2e-login.png' });
  await signup(admin, 'Joseph Bickley', 'joseph@example.test');
  let t = await text(admin);
  ok(t.includes('Home') && t.includes('Admin'), 'first sign-up lands in app as admin');
  await admin.screenshot({ path:'/tmp/e2e-admin-home.png' });
  for (const v of ['command','network','fleet','people','stock','finance','ai','board','info','admin']) {
    await nav(admin, v); t = await text(admin);
    ok(!/Could not load this page/.test(t), 'admin view loads: ' + v);
    if (v === 'network') ok(t.includes('J-10482'), 'network shows seeded jobs');
    if (v === 'fleet') ok(t.includes('MX26 TY6'), 'fleet shows vehicles');
    if (v === 'board') ok(t.includes('Owen Blake (example)'), 'board shows example posts');
    await admin.screenshot({ path:`/tmp/e2e-admin-${v}.png` });
  }
  // 2. AI approve
  await nav(admin, 'ai');
  await admin.click('[data-decide="approved"]'); await sleep(300);
  await fill(admin, '#decForm textarea[name=note]', 'Approved in e2e test');
  await admin.click('#decForm button[type=submit]'); await sleep(1200);
  t = await text(admin); ok(t.includes('Approved in e2e test'), 'AI approval stored and shown');
  await nav(admin, 'admin'); await admin.click('[data-admin-tab="audit"]'); await sleep(900);
  t = await text(admin); ok(t.includes('AI proposal approved'), 'AI approval appears in audit log');
  ok(t.includes('Signed in') || t.includes('First member bootstrapped'), 'sign-up / sign-in audited');
  await admin.screenshot({ path:'/tmp/e2e-admin-audit.png' });
  // 3. second user: pending (iPhone)
  const drv = await newUser(browser, true);
  await signup(drv, 'Amir Khan', 'amir@example.test');
  t = await text(drv); ok(t.includes('Waiting for approval'), 'new sign-up sees pending approval screen');
  await drv.screenshot({ path:'/tmp/e2e-pending-iphone.png' });
  // 4. admin approves as driver
  await admin.click('[data-admin-tab="members"]'); await sleep(900);
  t = await text(admin); ok(t.includes('amir@example.test'), 'admin sees pending member');
  await admin.screenshot({ path:'/tmp/e2e-admin-members.png' });
  await admin.click('[data-approve]'); await sleep(1200);
  // 5. driver checks again
  await drv.click('#checkAgain'); await sleep(1500);
  t = await text(drv); ok(t.includes('My jobs') && t.includes('J-10482'), 'approved driver sees own linked job');
  const jobRefs = await drv.$$eval('[data-job-status]', els => [...new Set(els.map(e => e.closest('.row').querySelector('.mono').textContent))]); ok(JSON.stringify(jobRefs) === '["J-10482"]', 'driver job list contains only own job: ' + jobRefs.join(','));
  await drv.screenshot({ path:'/tmp/e2e-driver-home-iphone.png' });
  await drv.click('[data-job-status="Delivered"]'); await sleep(1200);
  ok((await text(drv)).includes('No open jobs'), 'driver marks job delivered');
  const navItems = await drv.$$eval('#sidebar [data-view]', els => els.map(e => e.dataset.view));
  ok(JSON.stringify(navItems) === '["home","board","info"]', 'driver menu limited to home, board, info: ' + navItems.join(','));
  // 6. driver posts on board
  await nav(drv, 'board');
  await fill(drv, '#newPost', 'Delivered J-10482 at Trafford, test post'); await drv.click('#postBtn'); await sleep(1200);
  ok((await text(drv)).includes('Delivered J-10482 at Trafford'), 'driver posts on board');
  await drv.screenshot({ path:'/tmp/e2e-driver-board-iphone.png' });
  // 7. CSV import vehicles as admin
  fs.writeFileSync('/tmp/vehicles.csv', 'reg,type,depot,status,mot_due,next_service,odometer\nab12 cde,44t artic,Daventry,Available,14/03/2027,2026-12-01,"120,500"\nXY70 ZZZ,7.5t,Tilbury,,2027-01-01,,5000\n,bad row,,,,,\n');
  await nav(admin, 'fleet'); await admin.click('[data-csv="vehicles"]'); await sleep(400);
  const input = await admin.$('#csvFile'); await input.uploadFile('/tmp/vehicles.csv'); await sleep(800);
  t = await text(admin); ok(t.includes('2 row(s) ready') && t.includes('1 row(s) skipped'), 'CSV preview: 2 good rows, 1 skipped');
  await admin.screenshot({ path:'/tmp/e2e-csv-preview.png' });
  await admin.click('#csvGo'); await sleep(1500);
  ok((await admin.$eval('#modal', e => e.className)).includes('hidden'), 'CSV import completed (modal closed)'); t = await admin.$eval('#main', e => e.innerText); ok(t.includes('AB12 CDE') && t.includes('XY70 ZZZ'), 'CSV vehicles imported and listed in fleet (reg upper-cased)');
  // 8. sign out
  console.log('BEFORE SIGNOUT modal:', await admin.$eval('#modal', e => e.className)); await admin.click('#signOutBtn'); await sleep(2500); console.log('AFTER SIGNOUT:', (await text(admin)).slice(0,200).replace(/\n+/g,' | ')); ok((await text(admin)).includes('Sign in'), 'sign out returns to sign-in');
  const allErrs = [...admin.errs, ...drv.errs].filter(e => !/realtime|websocket|WebSocket|54321\/realtime/i.test(e));
  console.log(results.join('\n'));
  console.log('CONSOLE ERRORS (excluding realtime, which the local gateway does not provide):', allErrs.length ? '\n' + allErrs.join('\n') : 'none');
  console.log('REALTIME-RELATED ERRORS:', [...admin.errs, ...drv.errs].filter(e => /realtime|websocket/i.test(e)).length);
  await browser.close();
})().catch(e => { console.error(results.join('\n')); console.error(e); process.exit(1); });
