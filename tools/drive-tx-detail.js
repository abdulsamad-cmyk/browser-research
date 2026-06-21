// Capture transmission detail page by clicking the Report ID hyperlink.
const { chromium } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const OUT = 'C:/Workstation/dual-verify-swarm/tools/out/run2-targeted/transmission-detail';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page; for (const c of browser.contexts()) for (const p of c.pages()) if (p.url().includes('localhost:9000')) page = p;
  if (!page) { console.log('NO_PAGE'); return browser.close(); }
  await page.bringToFront().catch(()=>{});

  const calls = [];
  page.on('request', r => { if(['xhr','fetch'].includes(r.resourceType())){ const u=r.url(); if(/hubspot|hscollected|sentry|userflow/i.test(u))return; calls.push({method:r.method(),url:u,status:null}); } });
  page.on('response', res => { const c=calls.find(x=>x.url===res.url()&&x.status===null); if(c)c.status=res.status(); });

  // ensure on transmissions tab
  if (!page.url().includes('/transmissions')) {
    const t = page.locator('a[title="Transmissions"]').first();
    if (await t.count()) { await t.click({timeout:6000}).catch(()=>{}); await page.waitForTimeout(5000); }
  }
  await page.waitForTimeout(2000);
  console.log('url:', page.url());

  // hover first row to reveal the Report ID hyperlink, then click it
  const firstRow = page.locator('.k-grid-content tr[role="row"]').first();
  if (await firstRow.count().catch(()=>0)) {
    await firstRow.hover().catch(()=>{});
    await page.waitForTimeout(600);
  }
  // click the Report ID cell link (first td a[role=button] or just the first td that looks like a link)
  const reportIdLink = page.locator('.k-grid-content tr[role="row"]:first-child td:nth-child(2) a, .k-grid-content tr[role="row"]:first-child td:nth-child(1) a').first();
  const linkCount = await reportIdLink.count().catch(()=>0);
  console.log('report id link count:', linkCount);
  if (linkCount) {
    await reportIdLink.click({timeout:5000}).catch(e=>console.log('link warn',e.message.split('\n')[0]));
  } else {
    // fallback: click the first td directly
    const firstTd = page.locator('.k-grid-content tr[role="row"]:first-child td:nth-child(2)').first();
    await firstTd.click({timeout:5000}).catch(e=>console.log('td warn',e.message.split('\n')[0]));
  }
  await page.waitForLoadState('networkidle',{timeout:20000}).catch(()=>{});
  await page.waitForTimeout(4000);
  const urlAfter = page.url();
  console.log('url after click:', urlAfter);
  const bodyText = await page.evaluate(()=>document.body?document.body.innerText.trim():'');
  fs.writeFileSync(path.join(OUT,'page-text.txt'), bodyText.slice(0,12000));
  await page.screenshot({path:path.join(OUT,'screenshot.png')}).catch(()=>{});
  fs.writeFileSync(path.join(OUT,'network.json'), JSON.stringify(calls,null,2));
  console.log('bodyTextLen:', bodyText.length, '| calls:', calls.length);
  if (urlAfter !== 'http://localhost:9000/filing-manager/transmissions') {
    await page.goBack({waitUntil:'domcontentloaded',timeout:10000}).catch(()=>{});
    console.log('back to:', page.url());
  }
  await browser.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
