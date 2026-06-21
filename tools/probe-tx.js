const { chromium } = require('playwright-core');
(async()=>{
  const b=await chromium.connectOverCDP('http://localhost:9222');
  let page; for(const c of b.contexts())for(const p of c.pages())if(p.url().includes('localhost:9000'))page=p;
  if(!page){console.log('NO_PAGE');return b.close();}
  await page.bringToFront().catch(()=>{});
  // hover first data row
  const firstRow = page.locator('.k-grid-content tr[role="row"]').first();
  await firstRow.hover({timeout:3000}).catch(()=>{});
  await page.waitForTimeout(800);
  // dump all cells + any links inside
  const info = await page.evaluate(()=>{
    const rows = Array.from(document.querySelectorAll('.k-grid-content tr[role="row"]')).slice(0,3);
    return rows.map((r,ri)=>{
      const cells=Array.from(r.querySelectorAll('td'));
      return { rowIdx:ri, cells:cells.map((c,ci)=>({ci, text:(c.innerText||'').trim().slice(0,30), links:Array.from(c.querySelectorAll('a,button')).map(l=>({tag:l.tagName,cls:(l.className||'').toString().slice(0,60),text:(l.innerText||'').trim().slice(0,20),role:l.getAttribute('role')||''})) })) };
    });
  });
  console.log(JSON.stringify(info,null,2));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
