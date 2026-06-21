// Step 1: Drive the 4 known-uncaptured items from Run 1.
// All from the live Angular app at localhost:9000 (already past splash).
// 1. Header dropdowns: project selector + avatar menu + each of the 5 right-rail panels
// 2. Library left faceted filter sidebar
// 3. Form detail page (click a form from My Forms)
// 4. Transmission detail page (click a report from Transmissions)
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Workstation/dual-verify-swarm/tools/out/run2-targeted';
fs.mkdirSync(OUT, { recursive: true });
const L = (...a) => console.log(...a);

function dump(name, data) {
  const d = path.join(OUT, name); fs.mkdirSync(d, { recursive: true });
  if (data.text) fs.writeFileSync(path.join(d, 'page-text.txt'), data.text);
  if (data.snap) fs.writeFileSync(path.join(d, 'snapshot.json'), JSON.stringify(data.snap, null, 2));
  if (data.calls) fs.writeFileSync(path.join(d, 'network.json'), JSON.stringify(data.calls, null, 2));
}

async function snap(page) {
  return page.evaluate(() => {
    const seen = new Set(); const interactive = []; const icons = [];
    function walk(r) { let els; try { els = r.querySelectorAll('*'); } catch { return; } for (const e of els) { if (e.shadowRoot) walk(e.shadowRoot); const t = e.tagName.toLowerCase(); const cls = (e.className && e.className.baseVal != null) ? e.className.baseVal : (typeof e.className === 'string' ? e.className : ''); if (/\bfa[srlbdt]?\b|\bfa-[a-z]/.test(cls)) { const k='i|'+cls; if(!seen.has(k)){seen.add(k);icons.push({cls:cls.slice(0,120)});} } const role=e.getAttribute&&e.getAttribute('role'); const isI=['button','a','input','select','textarea'].includes(t)||['button','menuitem','tab','link','option','checkbox'].includes(role); if(isI){const label=(e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').trim().slice(0,80);const href=(e.getAttribute&&e.getAttribute('href'))||'';const k=t+'|'+(role||'')+'|'+label+'|'+href;if(!seen.has(k)){seen.add(k);interactive.push({tag:t,role:role||'',label,href});}} } }
    walk(document);
    const bodyText = document.body ? document.body.innerText.trim() : '';
    return { url: location.href, bodyText: bodyText.slice(0, 8000), bodyTextLen: bodyText.length, interactive: interactive.slice(0, 200), icons: icons.slice(0, 80) };
  });
}

async function navToFM(page) {
  // enter Filing Manager via launcher
  await page.locator('button[aria-label="Apps launcher"], button:has(i.fa-grid)').first().click({timeout:5000}).catch(()=>{});
  await page.waitForTimeout(1500);
  const sol = page.getByText(/^Filing Manager$/).first();
  if (await sol.count().catch(()=>0)) await sol.click({timeout:5000}).catch(()=>{});
  await page.waitForTimeout(5000);
  await page.keyboard.press('Escape').catch(()=>{});
  await page.locator('button:has-text("Done"), button:has-text("Don\'t Show Again")').first().click({timeout:2000}).catch(()=>{});
  await page.waitForTimeout(1000);
}

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page; for (const c of browser.contexts()) for (const p of c.pages()) if (p.url().includes('localhost:9000')) page = p;
  if (!page) { L('NO_PAGE'); return browser.close(); }
  await page.bringToFront().catch(()=>{});

  const calls = []; let phase = 'shell';
  page.on('request', r => { if(['xhr','fetch'].includes(r.resourceType())){ const u=r.url(); if(/hubspot|hscollected|google|sentry|userflow/i.test(u))return; let pk=null; const pd=r.postData(); if(pd){try{const j=JSON.parse(pd);pk=Object.keys(j);if(j.name)pk.push('name='+j.name);}catch{pk=pd.slice(0,120);}} calls.push({phase,method:r.method(),url:u,postKeys:pk,status:null}); } });
  page.on('response', res => { const c=calls.find(x=>x.url===res.url()&&x.status===null); if(c)c.status=res.status(); });

  // ══════════════════════════════════════════════════════════════
  // 1A. PROJECT SELECTOR DROPDOWN
  // ══════════════════════════════════════════════════════════════
  phase = 'project-selector';
  L('\n=== 1A. Project selector dropdown ===');
  const projPill = page.locator('button:has(i.fas.fa-angle-down), .itp-project-selector, particle-current-project button, [class*="project-selector"] button').first();
  const projCount = await projPill.count().catch(()=>0);
  L('pill count:', projCount);
  if (projCount) {
    await projPill.click({timeout:4000}).catch(e=>L('proj-click warn',e.message.split('\n')[0]));
    await page.waitForTimeout(1500);
    const projSnap = await snap(page);
    dump('project-selector', { text: projSnap.bodyText, snap: projSnap, calls: calls.filter(c=>c.phase==='project-selector') });
    await page.screenshot({path:path.join(OUT,'project-selector','screenshot.png')}).catch(()=>{});
    L('project-selector bodyText:', projSnap.bodyText.slice(0,300));
    await page.keyboard.press('Escape').catch(()=>{});
    await page.waitForTimeout(500);
  } else L('Project pill not found — checking DOM');

  // ══════════════════════════════════════════════════════════════
  // 1B. AVATAR MENU
  // ══════════════════════════════════════════════════════════════
  phase = 'avatar-menu';
  L('\n=== 1B. Avatar menu ===');
  const avatar = page.locator('particle-current-user-v2 button, [class*="avatar"] button, button:has(span[class*="avatar"]):not([aria-label="Apps launcher"])').first();
  const avatarCount = await avatar.count().catch(()=>0);
  L('avatar count:', avatarCount);
  if (avatarCount) {
    await avatar.click({timeout:4000}).catch(e=>L('avatar warn',e.message.split('\n')[0]));
    await page.waitForTimeout(1500);
    const avSnap = await snap(page);
    dump('avatar-menu', { text: avSnap.bodyText, snap: avSnap, calls: calls.filter(c=>c.phase==='avatar-menu') });
    await page.screenshot({path:path.join(OUT,'avatar-menu','screenshot.png')}).catch(()=>{});
    L('avatar-menu bodyText:', avSnap.bodyText.slice(0,300));
    await page.keyboard.press('Escape').catch(()=>{});
    await page.waitForTimeout(500);
  }

  // ══════════════════════════════════════════════════════════════
  // 1C. 5 RIGHT-RAIL ICON PANELS (XatBot, Details, Activity, Alerts, Chat)
  // ══════════════════════════════════════════════════════════════
  const railIcons = [
    { label: 'XatBot',   sel: 'button[aria-label="XatBot"], button:has(i.fa-sparkles)' },
    { label: 'Details',  sel: 'button[aria-label="Details"], button:has(i.fa-circle-info)' },
    { label: 'Activity', sel: 'button[aria-label="Activity"], button:has(i.fa-wave-pulse)' },
    { label: 'Alerts',   sel: 'button[aria-label="Alerts"], button:has(i.fa-bell)' },
    { label: 'Chat',     sel: 'button[aria-label="Chat"], button:has(i.fa-comment)' },
  ];
  for (const icon of railIcons) {
    phase = 'rail-' + icon.label.toLowerCase();
    L('\n=== 1C. Rail panel:', icon.label, '===');
    const btn = page.locator(icon.sel).first();
    const n = await btn.count().catch(()=>0);
    if (n) {
      await btn.click({timeout:4000}).catch(e=>L(icon.label,'warn',e.message.split('\n')[0]));
      await page.waitForTimeout(2000);
      const s = await snap(page);
      dump('rail-'+icon.label.toLowerCase(), { text: s.bodyText, snap: s, calls: calls.filter(c=>c.phase===phase) });
      await page.screenshot({path:path.join(OUT,'rail-'+icon.label.toLowerCase(),'screenshot.png')}).catch(()=>{});
      L(icon.label,'bodyTextLen:',s.bodyTextLen,'interactive:',s.interactive.length);
      // toggle back off
      await btn.click({timeout:3000}).catch(()=>{});
      await page.waitForTimeout(500);
    } else L(icon.label,'button not found');
  }

  // ══════════════════════════════════════════════════════════════
  // 2. LIBRARY LEFT FACETED FILTER SIDEBAR
  // ══════════════════════════════════════════════════════════════
  phase = 'library-left-filter';
  L('\n=== 2. Library left faceted filter sidebar ===');
  await navToFM(page);
  const libTab = page.locator('a[title="Library"]').first();
  if (await libTab.count().catch(()=>0)) { await libTab.click().catch(()=>{}); await page.waitForTimeout(5000); }
  await page.locator('button:has-text("Done"), button:has-text("Don\'t Show Again")').first().click({timeout:2000}).catch(()=>{});
  await page.waitForTimeout(500);
  // Switch to tile/country view to trigger the left filter
  const myCountriesBtn = page.locator('button[role="radio"]:has-text("My Countries"), button:has-text("My Countries")').first();
  if (await myCountriesBtn.count().catch(()=>0)) { await myCountriesBtn.click({timeout:4000}).catch(()=>{}); await page.waitForTimeout(2000); }
  const libSnap = await snap(page);
  dump('library-left-filter', { text: libSnap.bodyText, snap: libSnap, calls: calls.filter(c=>c.phase===phase) });
  await page.screenshot({path:path.join(OUT,'library-left-filter','screenshot.png')}).catch(()=>{});
  L('library-left-filter bodyTextLen:', libSnap.bodyTextLen, 'interactive:', libSnap.interactive.length);

  // ══════════════════════════════════════════════════════════════
  // 3. FORM DETAIL PAGE
  // ══════════════════════════════════════════════════════════════
  phase = 'form-detail';
  L('\n=== 3. Form detail page ===');
  const mfTab = page.locator('a[title="My Forms"]').first();
  if (await mfTab.count().catch(()=>0)) { await mfTab.click({timeout:6000}).catch(()=>{}); await page.waitForTimeout(5000); }
  // click first form name link (HyperlinkCellViewerComponent)
  const formLink = page.locator('.k-grid-content td a[role="button"], .k-grid-content tr td:nth-child(3) a').first();
  const formLinkCount = await formLink.count().catch(()=>0);
  L('form link count:', formLinkCount);
  if (formLinkCount) {
    const urlBefore = page.url();
    await formLink.click({timeout:5000}).catch(e=>L('form-link warn',e.message.split('\n')[0]));
    await page.waitForTimeout(4000);
    await page.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});
    const fSnap = await snap(page);
    dump('form-detail', { text: fSnap.bodyText, snap: fSnap, calls: calls.filter(c=>c.phase===phase) });
    await page.screenshot({path:path.join(OUT,'form-detail','screenshot.png')}).catch(()=>{});
    L('form-detail url:', fSnap.url, 'bodyTextLen:', fSnap.bodyTextLen);
    await page.goBack({waitUntil:'domcontentloaded',timeout:10000}).catch(()=>{});
    await page.waitForTimeout(2000);
    L('back to:', page.url());
  } else L('form link not found — trying row click');

  // ══════════════════════════════════════════════════════════════
  // 4. TRANSMISSION DETAIL PAGE
  // ══════════════════════════════════════════════════════════════
  phase = 'transmission-detail';
  L('\n=== 4. Transmission detail page ===');
  const txTab = page.locator('a[title="Transmissions"]').first();
  if (await txTab.count().catch(()=>0)) { await txTab.click({timeout:6000}).catch(()=>{}); await page.waitForTimeout(5000); }
  const txRow = page.locator('.k-grid-content tr.k-master-row, .k-grid-content tr[role="row"]').first();
  const txRowCount = await txRow.count().catch(()=>0);
  L('tx row count:', txRowCount);
  if (txRowCount) {
    const urlBefore = page.url();
    await txRow.click({timeout:5000}).catch(e=>L('tx-row warn',e.message.split('\n')[0]));
    await page.waitForTimeout(4000);
    await page.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});
    const tSnap = await snap(page);
    dump('transmission-detail', { text: tSnap.bodyText, snap: tSnap, calls: calls.filter(c=>c.phase===phase) });
    await page.screenshot({path:path.join(OUT,'transmission-detail','screenshot.png')}).catch(()=>{});
    L('transmission-detail url:', tSnap.url, 'bodyTextLen:', tSnap.bodyTextLen);
    await page.goBack({waitUntil:'domcontentloaded',timeout:10000}).catch(()=>{});
    await page.waitForTimeout(2000);
  }

  fs.writeFileSync(path.join(OUT,'network-all.json'), JSON.stringify(calls,null,2));
  L('\n=== DONE. Total calls:', calls.length, '| out:', OUT,'===');
  await browser.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
