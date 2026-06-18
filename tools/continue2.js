// Wait for the splash Continue button to enable, click, report resulting state.
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page;
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (p.url().includes('localhost:9000')) page = p;
  if (!page) { console.log('NO_PAGE'); await browser.close(); return; }
  await page.bringToFront().catch(() => {});

  const btn = page.locator('button.complete-button, button:has-text("Continue to Orbitax")').first();
  // Poll up to 40s for the button to become enabled.
  let enabled = false;
  for (let i = 0; i < 40; i++) {
    if (await btn.count() && await btn.isEnabled().catch(() => false)) { enabled = true; break; }
    await page.waitForTimeout(1000);
  }
  console.log('BUTTON_ENABLED:', enabled);
  if (enabled) await btn.click({ timeout: 10000 }).catch((e) => console.log('CLICK_WARN', e.message));

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    bodyText: (document.body ? document.body.innerText : '').trim().slice(0, 1500),
    hasPassword: !!document.querySelector('input[type=password]'),
    looksLikeLogin: /sign in|log in|login|password|username/i.test(document.body ? document.body.innerText : ''),
  }));
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
