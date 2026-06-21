// Phase 1: Drive the Next.js REBUILD at localhost:3200.
// Applies the DRIVE depth checklist per screen: scroll both axes, hover rows,
// reveal hover-only controls, open dropdowns, capture screenshots.
// No splash — direct navigation via page.goto (Next.js, no SPA splash gate).
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const OUT_ROOT = 'C:/Workstation/dual-verify-swarm/tools/out/rebuild';
fs.mkdirSync(OUT_ROOT, { recursive: true });

const BASE = 'http://localhost:3200';
const SCREENS = [
  { name: 'shell',         url: '/filing-manager' },
  { name: 'library',       url: '/filing-manager/library' },
  { name: 'my-forms',      url: '/filing-manager/my-forms' },
  { name: 'transmissions', url: '/filing-manager/transmissions' },
];

function outDir(screen) {
  const d = path.join(OUT_ROOT, screen);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function snapshot(page, tag) {
  return await page.evaluate((t) => {
    const seen = new Set(); const interactive = []; const icons = [];
    function walk(root) {
      let els; try { els = root.querySelectorAll('*'); } catch { return; }
      for (const el of els) {
        if (el.shadowRoot) walk(el.shadowRoot);
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute && el.getAttribute('role');
        const cls = (el.className && el.className.baseVal != null) ? el.className.baseVal : (typeof el.className === 'string' ? el.className : '');
        if (/\bfa[srlbdt]?\b|\bfa-[a-z]/.test(cls)) { const k = 'i|' + cls; if (!seen.has(k)) { seen.add(k); icons.push({ cls: cls.slice(0, 120) }); } }
        const isI = ['button', 'a', 'input', 'select'].includes(tag) || ['button', 'menuitem', 'tab', 'link', 'checkbox', 'columnheader', 'gridcell'].includes(role);
        if (isI) { const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 80); const href = (el.getAttribute && el.getAttribute('href')) || ''; const k = tag + '|' + (role || '') + '|' + label + '|' + href; if (!seen.has(k)) { seen.add(k); interactive.push({ tag, role: role || '', label, href }); } }
      }
    }
    walk(document);
    const gridRows = [];
    for (const r of Array.from(document.querySelectorAll('.itp-data-grid__body tr:not(.itp-data-grid__spacer):not(.itp-data-grid__empty)')).slice(0, 30)) {
      const cells = Array.from(r.querySelectorAll('td')).map(c => (c.innerText || '').trim().slice(0, 50));
      if (cells.some(Boolean)) gridRows.push(cells);
    }
    const colHeaders = Array.from(document.querySelectorAll('.itp-data-grid__header th')).map(h => (h.innerText || '').trim()).filter(Boolean);
    const bodyText = document.body ? document.body.innerText.trim() : '';
    return { tag: t, url: location.href, bodyText: bodyText.slice(0, 6000), bodyTextLen: bodyText.length, interactive: interactive.slice(0, 200), icons, colHeaders, gridRows };
  }, tag).catch(() => ({ tag, url: page.url(), error: true }));
}

async function driveGrid(page) {
  // H-scroll to far right
  const hInfo = await page.evaluate(() => {
    const sc = document.querySelector('.itp-data-grid__scroll');
    if (!sc) return { found: false };
    const max = sc.scrollWidth - sc.clientWidth;
    sc.scrollLeft = max;
    return { found: true, maxH: max, scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth };
  });
  await page.waitForTimeout(500);
  const rightSnap = await page.evaluate(() => {
    const lastThs = Array.from(document.querySelectorAll('.itp-data-grid__header th')).slice(-3).map(h => (h.innerText || '').trim());
    return lastThs;
  });
  // V-scroll through all rows
  const rowIds = new Set();
  for (let i = 0; i < 10; i++) {
    const batch = await page.evaluate(() => Array.from(document.querySelectorAll('.itp-data-grid__body td:first-child')).map(c => (c.innerText || '').trim()).filter(Boolean));
    batch.forEach(x => rowIds.add(x));
    const done = await page.evaluate(() => { const sc = document.querySelector('.itp-data-grid__scroll'); if (!sc) return true; const prev = sc.scrollTop; sc.scrollTop = Math.min(sc.scrollTop + 200, sc.scrollHeight); return sc.scrollTop === prev; });
    await page.waitForTimeout(200);
    if (done) break;
  }
  // scroll back
  await page.evaluate(() => { const sc = document.querySelector('.itp-data-grid__scroll'); if (sc) { sc.scrollTop = 0; sc.scrollLeft = 0; } });
  return { hInfo, rightCols: rightSnap, rowCount: rowIds.size, rowIds: [...rowIds] };
}

async function hoverRows(page) {
  const results = [];
  const rows = page.locator('.itp-data-grid__body .itp-data-grid__row').filter({ hasNot: page.locator('.itp-data-grid__spacer') });
  const count = Math.min(await rows.count().catch(() => 0), 5);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    await row.hover({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
    // capture newly visible controls
    const revealed = await row.evaluate(r => Array.from(r.querySelectorAll('button, .status-info-btn, .hyperlink-edit-btn, i[class*="fa-"]')).map(e => ({ cls: (e.className || '').toString().slice(0, 80), label: e.getAttribute('aria-label') || e.getAttribute('title') || (e.innerText || '').trim().slice(0, 30) })));
    results.push({ row: i, revealed });
  }
  return results;
}

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page;
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (p.url().includes('localhost')) page = p;
  if (!page) { const [ctx] = browser.contexts(); page = await ctx.newPage(); }

  for (const screen of SCREENS) {
    console.log(`\n=== SCREEN: ${screen.name} ===`);
    const dir = outDir(screen.name);
    await page.goto(BASE + screen.url, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    console.log('url:', page.url());

    // 1. Static snapshot
    const snap = await snapshot(page, screen.name);
    fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snap, null, 2));
    fs.writeFileSync(path.join(dir, 'page-text.txt'), snap.bodyText || '');
    console.log(`cols:${snap.colHeaders.length} rows:${snap.gridRows.length} interactive:${snap.interactive.length} icons:${snap.icons.length}`);

    // 2. Grid: scroll both axes + real row count
    if (snap.colHeaders.length > 0) {
      const gridInfo = await driveGrid(page);
      fs.writeFileSync(path.join(dir, 'grid-scroll.json'), JSON.stringify(gridInfo, null, 2));
      console.log(`grid H-overflow:${gridInfo.hInfo.maxH}px | rows seen:${gridInfo.rowCount} | far-right cols:${gridInfo.rightCols.join(', ')}`);
    }

    // 3. Hover rows → reveal controls
    if (snap.colHeaders.length > 0) {
      const hovered = await hoverRows(page);
      fs.writeFileSync(path.join(dir, 'hover-reveal.json'), JSON.stringify(hovered, null, 2));
      console.log('hover-reveal:', JSON.stringify(hovered.map(h => ({ row: h.row, count: h.revealed.length, items: h.revealed.map(r => r.label || r.cls.slice(0, 30)).filter(Boolean) }))));
    }

    // 4. Screenshot
    await page.screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: false }).catch(() => {});
    console.log('screenshot saved');

    // 5. Sidebar state
    const sidebarState = await page.evaluate(() => {
      const sb = document.querySelector('.itp-sidebar');
      return sb ? { dataState: sb.getAttribute('data-state'), hasContent: !!sb.querySelector('.itp-sidebar__content')?.children.length } : null;
    });
    console.log('sidebar:', JSON.stringify(sidebarState));

    // 6. Click pagination if present
    const pagBtn = page.locator('.itp-data-grid__pagination-btn:not(:disabled)').last();
    if (await pagBtn.count().catch(() => 0)) {
      await pagBtn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(800);
      const afterPag = await snapshot(page, screen.name + '-page2');
      fs.writeFileSync(path.join(dir, 'snapshot-page2.json'), JSON.stringify(afterPag, null, 2));
      console.log('after pagination - rows:', afterPag.gridRows.length);
    }
  }

  // Full network summary (nothing for rebuild — no backend calls)
  console.log('\n=== DONE. Outputs in', OUT_ROOT, '===');
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
