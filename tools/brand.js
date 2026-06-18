// Read the top-left brand element's real link target. No clicks, no assumptions.
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page;
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (p.url().includes('localhost:9000')) page = p;
  await page.bringToFront().catch(() => {});
  const info = await page.evaluate(() => {
    // Find brand: an anchor/element near top-left containing "Orbitax" text or a logo.
    const cands = [...document.querySelectorAll('a, [class*="logo"], [class*="brand"], header *')];
    const out = [];
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      if (r.top > 80 || r.left > 250) continue; // top-left only
      const txt = (el.innerText || '').trim();
      const aria = el.getAttribute('aria-label') || '';
      const href = el.getAttribute('href');
      const img = el.querySelector('img');
      if ((/orbitax/i.test(txt) || /orbitax/i.test(aria) || (img && /orbitax|logo/i.test(img.src))) && (el.tagName === 'A' || href || el.onclick)) {
        out.push({ tag: el.tagName.toLowerCase(), text: txt.slice(0, 40), aria, href: href === null ? '(none)' : href, img: img ? img.src.slice(-40) : '' });
      }
    }
    const seen = new Set();
    return out.filter((o) => { const k = JSON.stringify(o); if (seen.has(k)) return false; seen.add(k); return true; });
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
