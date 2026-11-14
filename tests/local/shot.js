const puppeteer = require('puppeteer-core');
(async () => {
  const url = process.argv[2], out = process.argv[3], mobile = process.argv[4] === 'mobile';
  const browser = await puppeteer.launch({ executablePath:'/usr/bin/google-chrome', headless:'new', args:['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', m => { if (['error','warning'].includes(m.type())) errs.push(m.type()+': '+m.text()); });
  page.on('pageerror', e => errs.push('pageerror: '+e.message));
  page.on('requestfailed', r => errs.push('requestfailed: '+r.url()+' '+(r.failure()||{}).errorText));
  if (mobile) await page.emulate(puppeteer.KnownDevices['iPhone 13']); else await page.setViewport({width:1280,height:800});
  await page.goto(url, { waitUntil:'networkidle0', timeout:30000 });
  await new Promise(r=>setTimeout(r, Number(process.env.WAIT||800)));
  if (process.env.EVAL) console.log('EVAL:', JSON.stringify(await page.evaluate(process.env.EVAL)));
  await page.screenshot({ path:out, fullPage:false });
  const text = await page.evaluate(() => document.body.innerText.slice(0, 600));
  console.log('TEXT:', text.replace(/\n+/g,' | '));
  console.log('CONSOLE_ISSUES:', errs.length ? '\n'+errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
