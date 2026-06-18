// Connect to running Chrome over CDP and report the projects-page state.
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = [];
  for (const ctx of contexts) for (const p of ctx.pages()) pages.push(p);

  const out = [];
  for (const p of pages) {
    out.push({ url: p.url(), title: await p.title().catch(() => '?') });
  }
  console.log('PAGES:', JSON.stringify(out, null, 2));

  // Pick the projects page (or first localhost page).
  const target =
    pages.find((p) => p.url().includes('/projects')) ||
    pages.find((p) => p.url().includes('localhost:9000')) ||
    pages[0];

  if (!target) { console.log('NO_PAGE'); await browser.close(); return; }

  await target.bringToFront().catch(() => {});
  const info = await target.evaluate(() => {
    const text = document.body ? document.body.innerText.slice(0, 1500) : '';
    return {
      url: location.href,
      title: document.title,
      bodyTextSample: text,
      counts: {
        buttons: document.querySelectorAll('button').length,
        links: document.querySelectorAll('a').length,
        inputs: document.querySelectorAll('input,select,textarea').length,
        rows: document.querySelectorAll('tr').length,
      },
    };
  });
  console.log('TARGET:', JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
