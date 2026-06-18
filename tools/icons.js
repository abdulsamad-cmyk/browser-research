// Capture every Font Awesome icon: class list + computed font-family (->FA version)
// + nearest button/link label. Read-only, no clicks. Stays on page.
const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page;
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (p.url().includes('localhost:9000')) page = p;
  await page.bringToFront().catch(() => {});

  const data = await page.evaluate(() => {
    const families = new Set();
    const icons = [];
    // FA marks icons via <i>/<span> with fa* classes, or any el whose ::before uses an FA font.
    const candidates = document.querySelectorAll('i, span, [class*="fa-"], [class*="fa "], .fa, .fas, .far, .fal, .fab, .fad');
    const seen = new Set();
    for (const el of candidates) {
      const cls = (el.className && el.className.toString()) || '';
      if (!/\bfa[bsrld]?\b|\bfa-/.test(cls)) continue;
      const beforeFF = getComputedStyle(el, '::before').fontFamily || '';
      const ff = getComputedStyle(el).fontFamily || '';
      const family = (beforeFF.match(/Font Awesome[^,";]*/i) || ff.match(/Font Awesome[^,";]*/i) || [beforeFF || ff])[0];
      if (family) families.add(family.trim());
      // nearest actionable ancestor for context
      let host = el.closest('button,a,[role=button],[role=menuitem],[role=tab],li');
      const label = host ? (host.innerText || host.getAttribute('aria-label') || host.getAttribute('title') || '').trim().slice(0, 50) : '';
      const faName = (cls.match(/fa-[a-z0-9-]+/g) || []).filter((c) => c !== 'fa-fw' && c !== 'fa-lg');
      const key = cls + '|' + label;
      if (seen.has(key)) continue; seen.add(key);
      icons.push({ classes: cls.slice(0, 80), faName, family: family ? family.trim() : '', hostTag: host ? host.tagName.toLowerCase() : '', label });
    }
    return { families: [...families], count: icons.length, icons };
  });

  fs.writeFileSync('tools/out/icons.json', JSON.stringify(data, null, 2));
  console.log('FONT FAMILIES SEEN:', JSON.stringify(data.families, null, 2));
  console.log('ICON COUNT:', data.count);
  console.log('\n=== ICONS (class | faName | host | label) ===');
  data.icons.slice(0, 80).forEach((i) => console.log(`  ${JSON.stringify(i.faName)}  [${i.family}]  <${i.hostTag}> "${i.label}"`));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
