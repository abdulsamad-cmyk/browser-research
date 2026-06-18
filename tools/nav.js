// Top-nav capture: read href where possible; open caret dropdowns (no navigate);
// click+back only for router-only links. Stays on /projects.
const { chromium } = require('playwright-core');
const fs = require('fs');

const NAV = ['Projects', 'Analytics', 'Entity Data', 'Entity Change Report', 'Entity Chart', 'Transactions'];

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page;
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (p.url().includes('localhost:9000')) page = p;
  await page.bringToFront().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  // 1. Static read: href + caret detection for each nav item (no clicks).
  const meta = await page.evaluate((names) => {
    const res = [];
    for (const name of names) {
      const els = [...document.querySelectorAll('a, [role=tab], button')];
      const el = els.find((e) => (e.innerText || '').trim() === name || (e.getAttribute('aria-label') || '') === name);
      if (!el) { res.push({ name, found: false }); continue; }
      const caretEl = el.querySelector('[class*="fa-angle-down"], [class*="fa-caret"], [class*="fa-chevron-down"]');
      res.push({
        name, found: true, tag: el.tagName.toLowerCase(),
        href: el.getAttribute('href') || '',
        hasCaret: !!caretEl,
        caretClass: caretEl ? caretEl.className.toString() : '',
      });
    }
    return res;
  }, NAV);

  // 2. For caret items, open the dropdown and capture items (no navigate).
  for (const m of meta) {
    if (!m.found || !m.hasCaret) continue;
    await page.keyboard.press('Escape').catch(() => {});
    const trigger = page.locator(`a:has-text("${m.name}"), button:has-text("${m.name}")`).first();
    try {
      // click the caret icon specifically if possible, else the element
      const caret = trigger.locator('[class*="fa-angle-down"], [class*="fa-caret"], [class*="fa-chevron-down"]').first();
      await (await caret.count() ? caret : trigger).click({ timeout: 4000 });
      await page.waitForTimeout(700);
      const items = await page.evaluate(() => {
        const panels = document.querySelectorAll('.cdk-overlay-pane, [role=menu], .mat-menu-panel, .mat-mdc-menu-panel, .dropdown-menu, ul[role=listbox]');
        for (const pnl of panels) {
          const r = pnl.getBoundingClientRect();
          if (r.width === 0) continue;
          const its = [...pnl.querySelectorAll('a,button,[role=menuitem],li')].map((i) => ({
            text: (i.innerText || '').trim().slice(0, 60),
            href: i.getAttribute('href') || '',
          })).filter((x) => x.text);
          if (its.length) return its;
        }
        return [];
      });
      m.dropdownItems = items;
    } catch (e) { m.dropdownErr = String(e.message).split('\n')[0]; }
    await page.keyboard.press('Escape').catch(() => {});
    if (!page.url().includes('/projects')) { await page.goBack().catch(() => {}); await page.waitForTimeout(500); }
  }

  // 3. Router-only links (no href, no caret): click -> capture url -> back.
  for (const m of meta) {
    if (!m.found || m.href || m.hasCaret) continue;
    const before = page.url();
    const trigger = page.locator(`a:has-text("${m.name}"), [role=tab]:has-text("${m.name}")`).first();
    try {
      await trigger.click({ timeout: 4000 });
      await page.waitForTimeout(900);
      m.resolvedUrl = page.url();
      if (page.url() !== before) { await page.goBack().catch(() => {}); await page.waitForTimeout(800); m.returned = page.url().includes('/projects'); }
    } catch (e) { m.clickErr = String(e.message).split('\n')[0]; }
  }

  fs.writeFileSync('tools/out/nav.json', JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
  await page.keyboard.press('Escape').catch(() => {});
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
