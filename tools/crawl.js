// Exhaustive single-page UI crawler for localhost:9000/projects.
// Clicks every interactive element, captures dropdowns/menus/modals, records the
// DOM effect of each click, recovers between clicks, and NEVER clicks
// destructive/confirm actions (delete, logout, save, submit, ...). Stays on /projects.
const { chromium } = require('playwright-core');
const fs = require('fs');

const START_URL = 'http://localhost:9000/projects';
// Labels we will NEVER click (destructive or data-committing). We still RECORD them.
const FORBIDDEN = /\b(log\s?out|sign\s?out|logout|signout|delete|remove|discard|deactivate|drop)\b/i;
const CONFIRM = /^(save|submit|apply|confirm|ok|okay|yes|create|update|delete|remove|discard|proceed|continue to orbitax)$/i;

const log = [];
function rec(entry) { log.push(entry); }

async function getOverlayState(page) {
  // Capture any open menu/dialog/dropdown overlay and its contents.
  return await page.evaluate(() => {
    const sels = [
      '[role=dialog]', '[role=menu]', '[role=listbox]', '.cdk-overlay-pane',
      '.mat-menu-panel', '.mat-mdc-menu-panel', '.modal', '.dialog', '.dropdown-menu',
      '.mat-select-panel', '.ng-dropdown-panel', '.p-dropdown-panel', '.popover',
    ];
    const nodes = [];
    const seen = new Set();
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        if (seen.has(el)) continue; seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const items = [...el.querySelectorAll('button,a,[role=menuitem],[role=option],li,.mat-menu-item,.mat-mdc-menu-item,input,label')]
          .map((i) => (i.innerText || i.value || i.getAttribute('aria-label') || '').trim())
          .filter((t) => t)
          .filter((t, idx, arr) => arr.indexOf(t) === idx)
          .slice(0, 60);
        nodes.push({ selector: s, text: (el.innerText || '').trim().slice(0, 400), items });
      }
    }
    return nodes;
  });
}

async function recover(page) {
  // Close any open overlay; return to start URL if we navigated away.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape').catch(() => {});
  if (!page.url().includes('/projects')) {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function collect(page) {
  // Enumerate visible interactive elements with a stable signature.
  return await page.$$eval(
    'button, a, [role=button], [role=menuitem], [role=tab], [role=link], input, select, textarea, [tabindex]:not([tabindex="-1"]), .clickable, mat-icon[clickable], [mattooltip]',
    (els) => {
      const out = [];
      const seen = new Set();
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
        if (!visible) continue;
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || '';
        const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('mattooltip') || el.getAttribute('placeholder') || '').trim().slice(0, 80);
        const sig = `${tag}|${role}|${label}|${Math.round(r.x)},${Math.round(r.y)}`;
        if (seen.has(sig)) continue; seen.add(sig);
        out.push({ tag, role, label, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
      }
      return out;
    }
  );
}

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page;
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (p.url().includes('localhost:9000')) page = p;
  if (!page) { console.log('NO_PAGE'); await browser.close(); return; }
  await page.bringToFront().catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  // Full page text (deep).
  const pageText = await page.evaluate(() => (document.body ? document.body.innerText : '').trim());
  fs.writeFileSync('tools/out/page-text.txt', pageText);

  const elements = await collect(page);
  console.log('ELEMENTS_FOUND:', elements.length);
  fs.writeFileSync('tools/out/elements.json', JSON.stringify(elements, null, 2));

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const entry = { idx: i, tag: el.tag, role: el.role, label: el.label, clicked: false };

    if (FORBIDDEN.test(el.label)) {
      entry.skipped = 'FORBIDDEN (destructive)';
      rec(entry); continue;
    }
    if (CONFIRM.test(el.label.trim())) {
      entry.skipped = 'CONFIRM/commit action — recorded, not clicked';
      rec(entry); continue;
    }
    if (el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select') {
      entry.skipped = 'input field — recorded, not clicked';
      rec(entry); continue;
    }

    const urlBefore = page.url();
    try {
      await page.mouse.click(el.x, el.y, { timeout: 4000 });
      entry.clicked = true;
      await page.waitForTimeout(600);
    } catch (e) {
      entry.error = String(e.message).split('\n')[0];
      rec(entry); await recover(page); continue;
    }

    const urlAfter = page.url();
    if (urlAfter !== urlBefore) entry.navigatedTo = urlAfter;

    const overlays = await getOverlayState(page);
    if (overlays.length) entry.opened = overlays;

    rec(entry);
    await recover(page);
  }

  fs.writeFileSync('tools/out/crawl.json', JSON.stringify({ url: START_URL, total: elements.length, log }, null, 2));
  const clicked = log.filter((e) => e.clicked).length;
  const skipped = log.filter((e) => e.skipped).length;
  const opened = log.filter((e) => e.opened).length;
  const navs = log.filter((e) => e.navigatedTo).length;
  console.log(`DONE clicked=${clicked} skipped=${skipped} opened_overlay=${opened} navigations=${navs}`);
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
