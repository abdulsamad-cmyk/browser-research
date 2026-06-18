// Open localhost:9000/projects in the CDP-connected Chrome and report state.
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto('http://localhost:9000/projects', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => console.log('GOTO_WARN', e.message));
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    bodyTextSample: (document.body ? document.body.innerText : '').slice(0, 1200),
    counts: {
      buttons: document.querySelectorAll('button').length,
      links: document.querySelectorAll('a').length,
      inputs: document.querySelectorAll('input,select,textarea').length,
      rows: document.querySelectorAll('tr').length,
    },
  }));
  console.log('STATE:', JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
