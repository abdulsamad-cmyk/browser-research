// Focused pass: click named menu triggers, capture the overlay that appears by
// diffing top-level DOM containers. Skips Analytics/Transactions (nav-away) per instruction.
const { chromium } = require('playwright-core');
const fs = require('fs');

const TRIGGERS = [
  'Actions', 'Name Filter Menu', 'End Date Filter Menu', 'Last Modified Filter Menu',
  'Apps launcher', 'Details', 'Activity', 'Alerts', 'Chat', 'XatBot', 'All Fields Schema',
];

async function topOverlays(page) {
  return await page.evaluate(() => {
    // Capture likely-overlay containers anywhere, by common Angular/CDK/material patterns.
    const cand = document.querySelectorAll(
      '.cdk-overlay-container *, [role=menu], [role=dialog], [role=listbox], .mat-menu-panel, .mat-mdc-menu-panel, .mat-select-panel, .ng-dropdown-panel, .popover, .modal, .dropdown-menu'
    );
    const out = [];
    const seen = new Set();
    for (const el of cand) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Only keep "panel-ish" nodes (have multiple actionable children).
      const items = [...el.querySelectorAll('button,a,[role=menuitem],[role=option],li,label,.mat-menu-item,.mat-mdc-menu-item')]
        .map((i) => (i.innerText || '').trim()).filter(Boolean);
      if (items.length < 1) continue;
      const cls = el.className && el.className.toString().slice(0, 60);
      const key = cls + '|' + items.join(',').slice(0, 100);
      if (seen.has(key)) continue; seen.add(key);
      out.push({ cls, count: items.length, items: [...new Set(items)].slice(0, 50) });
    }
    // Keep only the deepest/most specific (filter out huge container dumps).
    return out.filter((o) => o.count <= 60).sort((a, b) => a.count - b.count).slice(0, 4);
  });
}

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page;
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (p.url().includes('localhost:9000')) page = p;
  await page.bringToFront().catch(() => {});

  const results = {};
  for (const name of TRIGGERS) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
    const loc = page.getByRole('button', { name, exact: false }).first();
    let trigger = loc;
    if (!(await loc.count())) trigger = page.locator(`[aria-label="${name}"], [mattooltip="${name}"], [title="${name}"]`).first();
    if (!(await trigger.count())) { results[name] = { found: false }; continue; }
    try {
      await trigger.click({ timeout: 4000 });
      await page.waitForTimeout(700);
      const ov = await topOverlays(page);
      results[name] = { found: true, overlays: ov };
    } catch (e) {
      results[name] = { found: true, error: String(e.message).split('\n')[0] };
    }
    if (page.url() !== 'http://localhost:9000/projects' && !page.url().endsWith('/projects')) {
      await page.goBack().catch(() => {});
      await page.waitForTimeout(600);
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  fs.writeFileSync('tools/out/menus.json', JSON.stringify(results, null, 2));
  for (const [k, v] of Object.entries(results)) {
    if (!v.found) { console.log(`${k}: NOT FOUND`); continue; }
    if (v.error) { console.log(`${k}: ERR ${v.error}`); continue; }
    console.log(`\n### ${k}`);
    (v.overlays || []).forEach((o) => console.log(`  [${o.cls}] (${o.count}) ${JSON.stringify(o.items)}`));
  }
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
