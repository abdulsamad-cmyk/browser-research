// Click "Continue to Orbitax" on the splash, then report the resulting page state.
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page;
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (p.url().includes('localhost:9000')) page = p;
  if (!page) { console.log('NO_PAGE'); await browser.close(); return; }

  await page.bringToFront().catch(() => {});
  const btn = page.getByRole('button', { name: /continue to orbitax/i }).first();
  if (await btn.count()) {
    await btn.click({ timeout: 10000 }).catch((e) => console.log('CLICK_WARN', e.message));
  } else {
    console.log('NO_CONTINUE_BUTTON');
  }
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    bodyText: (document.body ? document.body.innerText : '').trim().slice(0, 2000),
    hasPassword: !!document.querySelector('input[type=password]'),
    inputs: [...document.querySelectorAll('input')].map((i) => ({ type: i.type, name: i.name, ph: i.placeholder })).slice(0, 10),
  }));
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
