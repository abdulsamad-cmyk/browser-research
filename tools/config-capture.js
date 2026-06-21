// Stage A — capture server config RESPONSE BODIES on fresh tool load.
// Robust: drives splash -> launcher -> Filing Manager -> optional tab, capturing structural bodies.
// Usage: node config-capture.js ["My Forms"]   (optional FM sub-tab to load)
const { chromium } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const OUT = (process.env.OUT_ROOT || 'C:/Workstation/dual-verify-swarm/tools/out') + '/config';
const STRUCTURAL = /FilingManagerApi|Platform\/Command|DynamicGridData|\/api\/Query|\/graphql\/|fieldSections|widget/i;
fs.mkdirSync(OUT, { recursive: true });
const tagFor = u => /FilingManagerApi|fieldSections|graphql/i.test(u) ? 'fieldSections' : /Command/i.test(u) ? 'command' : /DynamicGridData/i.test(u) ? 'gridData' : 'query';

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page; for (const c of browser.contexts()) for (const p of c.pages()) if (p.url().includes('localhost:9000')) page = p;
  if (!page) { console.log('NO_PAGE'); return browser.close(); }
  await page.bringToFront().catch(()=>{});
  const captured = [], pending = [];
  // Attach the listener BEFORE any reload so the cold tool-load's fieldSections are captured.
  page.on('response', (res) => { const u = res.url(); if (!STRUCTURAL.test(u)) return;
    let reqBody=null; try{reqBody=res.request().postData();}catch{}
    pending.push((async()=>{ let body=null; try{body=await res.json();}catch{try{body=await res.text();}catch{}} captured.push({url:u,status:res.status(),reqBody,body}); })().catch(()=>{})); });
  // 1. splash
  const btn = page.locator('button:has-text("Continue to Orbitax")').first();
  for (let i=0;i<60 && (await btn.count().catch(()=>0));i++){ if(await btn.isEnabled().catch(()=>false)){await btn.click({timeout:8000}).catch(()=>{});break;} await page.waitForTimeout(1000);}
  await page.waitForLoadState('networkidle',{timeout:30000}).catch(()=>{});
  await page.waitForTimeout(3000);

  const target = process.argv[2];
  const fieldSectionsCount = () => captured.filter(c => /FilingManagerApi|fieldSections|graphql/i.test(c.url)).length;

  // navSequence: launcher -> Filing Manager solution -> dismiss dialog -> sibling tab -> target tab.
  // Each call mints a fresh COLD tool load (fires fieldSections). settleWait controls the final pause.
  async function navSequence(settleWait) {
    await page.locator('button[aria-label="Apps launcher"], button:has(i.fa-grid)').first().click({timeout:5000}).catch(()=>{});
    await page.waitForTimeout(1500);
    const sol = page.getByText(/^Filing Manager$/).first();
    if (await sol.count().catch(()=>0)) await sol.click({timeout:5000}).catch(()=>{});
    await page.waitForTimeout(5000);
    await page.keyboard.press('Escape').catch(()=>{});
    await page.locator('button:has-text("Done"), button:has-text("Don\'t Show Again")').first().click({timeout:2000}).catch(()=>{});
    await page.waitForTimeout(1000);
    if (target) {
      const sibling = target === 'Dashboard' ? 'Library' : 'Dashboard';
      const sib = page.locator(`a[title="${sibling}"]`).first();
      if (await sib.count().catch(()=>0)) { await sib.click({timeout:6000}).catch(()=>{}); await page.waitForTimeout(3000); }
      const t = page.locator(`a[title="${target}"]`).first();
      if (await t.count().catch(()=>0)) await t.click({timeout:6000}).catch(()=>{});
    }
    await page.waitForLoadState('networkidle',{timeout:20000}).catch(()=>{});
    await page.waitForTimeout(settleWait);
    await Promise.allSettled(pending.slice()); // await any bodies triggered this attempt
  }

  // First attempt (current behavior on happy path).
  await navSequence(6000);

  // Retry up to 3 times if fieldSections still not captured (warm-cache race or cold-boot timing miss).
  const RETRY_WAITS = [3000, 5000, 8000];
  for (let attempt = 0; attempt < RETRY_WAITS.length && fieldSectionsCount() === 0; attempt++) {
    console.warn(`RETRY fieldSections (attempt ${attempt+1}/${RETRY_WAITS.length}) — 0 captured so far for "${target || '(no target)'}"`);
    await navSequence(RETRY_WAITS[attempt]);
  }
  if (fieldSectionsCount() === 0) {
    console.warn(`WARN: retries exhausted — 0 fieldSections captured for "${target || '(no target)'}". Coverage Oracle will lack column defs.`);
  }

  await Promise.allSettled(pending);

  let i=0; for (const c of captured) fs.writeFileSync(path.join(OUT,`${tagFor(c.url)}-${i++}.json`), JSON.stringify(c,null,2));
  console.log('CAPTURED_BODIES', captured.length, '| url', page.url(), '|', captured.map(c=>tagFor(c.url)).join(','));
  await browser.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
