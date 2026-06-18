// Discover icon-button identities and capture inline side-panels via text delta.
const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page;
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (p.url().includes('localhost:9000')) page = p;
  await page.bringToFront().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  // 1. Dump every element carrying a tooltip/aria-label/icon name.
  const labels = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[aria-label],[mattooltip],[title],mat-icon,button')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const name = el.getAttribute('aria-label') || el.getAttribute('mattooltip') || el.getAttribute('title') || '';
      const icon = el.tagName.toLowerCase() === 'mat-icon' ? el.innerText.trim() : (el.querySelector('mat-icon') ? el.querySelector('mat-icon').innerText.trim() : '');
      if (name || icon) out.push({ tag: el.tagName.toLowerCase(), name: name.slice(0, 50), icon: icon.slice(0, 30) });
    }
    const seen = new Set();
    return out.filter((o) => { const k = o.name + '|' + o.icon; if (seen.has(k)) return false; seen.add(k); return true; });
  });
  fs.writeFileSync('tools/out/labels.json', JSON.stringify(labels, null, 2));
  console.log('=== TOOLTIP/ARIA/ICON LABELS ===');
  labels.forEach((l) => console.log(`  ${l.tag}  name="${l.name}"  icon="${l.icon}"`));

  // 2. Side panels: click each, record body-text delta.
  const baseText = await page.evaluate(() => document.body.innerText.trim());
  const panels = {};
  for (const name of ['Details', 'Activity', 'Alerts', 'Chat']) {
    const loc = page.locator(`[aria-label="${name}"], [mattooltip="${name}"], [title="${name}"]`).first();
    if (!(await loc.count())) { panels[name] = 'no-trigger'; continue; }
    try {
      await loc.click({ timeout: 4000 });
      await page.waitForTimeout(900);
      const t = await page.evaluate(() => document.body.innerText.trim());
      const added = t.split('\n').filter((line) => !baseText.includes(line.trim()) && line.trim()).slice(0, 25);
      panels[name] = added;
      await loc.click({ timeout: 3000 }).catch(() => {}); // toggle closed
      await page.waitForTimeout(400);
    } catch (e) { panels[name] = 'ERR ' + String(e.message).split('\n')[0]; }
  }
  fs.writeFileSync('tools/out/panels.json', JSON.stringify(panels, null, 2));
  console.log('\n=== SIDE PANELS (new text on open) ===');
  for (const [k, v] of Object.entries(panels)) console.log(`\n### ${k}\n  ${Array.isArray(v) ? JSON.stringify(v) : v}`);

  await page.keyboard.press('Escape').catch(() => {});
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
