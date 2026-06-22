// FM fieldSections capture: splash → launcher → FM → Library/MyForms/Transmissions tabs
// Uses chrome-remote-interface (Runtime only, no Network.enable / puppeteer)
const CDP = require('chrome-remote-interface');
const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const OUT = (process.env.OUT_ROOT || 'C:/Workstation/dual-verify-swarm/tools/out') + '/config';
fs.mkdirSync(OUT, { recursive: true });
let fileIdx = 0;

async function evalPage(Runtime, expr) {
  const res = await Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) console.warn('EVAL WARN:', res.exceptionDetails.text);
  return res.result.value;
}

const click = (sel_or_text, byText = false) => byText
  ? `(() => { const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='${sel_or_text}'); if(el)el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return !!el; })()`
  : `(() => { const el=[...document.querySelectorAll('${sel_or_text}')].find(e=>e.textContent.trim()==='${sel_or_text}'); if(el)el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return !!el; })()`;

const clickText = (text) =>
  `(() => { const el=[...document.querySelectorAll('a,button')].find(e=>e.textContent.trim()==='${text}'); if(el)el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return !!el; })()`;

(async () => {
  const targets = await CDP.List({ port: 9222 });
  const target = targets.find(t => t.url.includes('localhost:9000') && t.type === 'page');
  if (!target) { console.log('NO 9000 TARGET'); return; }
  console.log('Target:', target.url);

  const client = await CDP({ target: target.id, port: 9222 });
  const { Runtime } = client;
  await Runtime.enable();
  console.log('CDP Runtime enabled');

  // Install XHR + fetch interceptor
  await evalPage(Runtime, `
    (() => {
      if (window._cdpInterceptInstalled) { window._cdpCaptures = window._cdpCaptures || []; return 'already'; }
      window._cdpInterceptInstalled = true;
      window._cdpCaptures = [];
      const FILTER = /FilingManagerApi|Platform\\/Command|DynamicGridData|api\\/Query/i;
      const origFetch = window.fetch;
      window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const result = await origFetch.apply(this, arguments);
        if (FILTER.test(url)) {
          result.clone().text().then(body => {
            window._cdpCaptures.push({url, reqBody:(init&&init.body)||null, status:result.status, body});
          }).catch(()=>{});
        }
        return result;
      };
      const oO=XMLHttpRequest.prototype.open, oS=XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open=function(m,u){this._u=u;this._m=m;return oO.apply(this,arguments);};
      XMLHttpRequest.prototype.send=function(b){
        this._b=b;
        if(FILTER.test(this._u||'')){
          this.addEventListener('load',function(){
            window._cdpCaptures.push({url:this._u,reqBody:this._b,status:this.status,body:this.responseText});
          });
        }
        return oS.apply(this,arguments);
      };
      return 'installed';
    })()
  `);
  console.log('Interceptor installed');

  // Step 1: Dismiss splash
  const hasSplash = await evalPage(Runtime,
    `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Continue to Orbitax')`
  );
  if (hasSplash) {
    console.log('Dismissing splash...');
    await evalPage(Runtime, clickText('Continue to Orbitax'));
    // Wait for Angular to load the landing page + project data
    let landingReady = false;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const url = await evalPage(Runtime, 'window.location.href');
      const hasAnyNav = await evalPage(Runtime, `document.querySelectorAll('button[aria-label]').length > 0`);
      console.log(`t=${i+1}s: url=${url} hasNav=${hasAnyNav}`);
      if (hasAnyNav) { landingReady = true; break; }
    }
    console.log('Landing ready:', landingReady);
  } else {
    console.log('No splash. URL:', await evalPage(Runtime, 'window.location.href'));
  }

  // Dismiss welcome guide dialog if present
  await evalPage(Runtime, clickText('Done'));
  await evalPage(Runtime, `(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /Don't Show Again/.test(b.textContent));
    if (btn) btn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
  })()`);
  await sleep(500);

  const fmCount = async () => {
    const n = await evalPage(Runtime, `(window._cdpCaptures||[]).filter(c=>c.url.includes('FilingManagerApi')).length`);
    return n || 0;
  };

  // Step 2: Launcher → Filing Manager (cold load = fresh fieldSections)
  console.log('\n--- Launcher → Filing Manager ---');
  const launcherBtn = await evalPage(Runtime,
    `(() => { const b=document.querySelector('button[aria-label="Apps launcher"]')||[...document.querySelectorAll('button')].find(b=>{const i=b.querySelector('i');return i&&(i.className||'').includes('fa-grid');}); if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return !!b; })()`
  );
  console.log('Launcher clicked:', launcherBtn);
  await sleep(2000);

  const fmClicked = await evalPage(Runtime, `
    (() => {
      const el = [...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='Filing Manager');
      if (el) el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
      return !!el;
    })()
  `);
  console.log('Filing Manager clicked:', fmClicked);
  await sleep(2000);

  // Dismiss welcome dialog again
  await evalPage(Runtime, clickText('Done'));
  await sleep(500);

  // Wait for FM nav (Library tab)
  let fmReady = false;
  for (let i = 0; i < 20; i++) {
    fmReady = await evalPage(Runtime, `[...document.querySelectorAll('a')].some(a=>a.textContent.trim()==='Library')`);
    if (fmReady) { console.log(`FM nav ready at t=${i}s`); break; }
    await sleep(1000);
  }

  if (!fmReady) {
    const txt = await evalPage(Runtime, `document.body.innerText.substring(0,200)`);
    console.log('WARN: FM nav not found. Page:', txt);
  }
  console.log('FM fieldSections after launcher:', await fmCount());

  if (fmReady) {
    // Library tab
    console.log('\n--- Library tab ---');
    await evalPage(Runtime, clickText('Library'));
    await sleep(8000);
    console.log('FM captures after Library:', await fmCount());

    // My Forms tab
    console.log('\n--- My Forms tab ---');
    await evalPage(Runtime, clickText('My Forms'));
    await sleep(8000);
    console.log('FM captures after My Forms:', await fmCount());

    // More → Transmissions
    console.log('\n--- More → Transmissions ---');
    await evalPage(Runtime, clickText('More'));
    await sleep(2000);
    await evalPage(Runtime, clickText('Transmissions'));
    await sleep(8000);
    console.log('FM captures after Transmissions:', await fmCount());
  }

  // Save results
  const allRaw = await evalPage(Runtime, 'JSON.stringify(window._cdpCaptures||[])');
  const all = JSON.parse(allRaw || '[]');
  const fm = all.filter(c => c.url.includes('FilingManagerApi'));

  console.log('\n=== SUMMARY ===');
  console.log('Total captured:', all.length, '| FM fieldSections:', fm.length);

  for (const c of fm) {
    const st = (c.reqBody || '').match(/sourceType[^"]*"([^"]+)"/);
    let body = null; try { body = JSON.parse(c.body); } catch {}
    const defs = body?.data?.fieldSections?.flatMap(s =>
      (s.fieldGroups || []).flatMap(g => g.definitions || g.fieldDefinitions || [])
    ) || [];
    console.log(`  sourceType=${st ? st[1] : '?'} cols=${defs.length}`);
    fs.writeFileSync(path.join(OUT, `fm-fieldSections-${fileIdx++}.json`), JSON.stringify({ url: c.url, reqBody: c.reqBody, body }, null, 2));
  }

  const cmds = all.filter(c => /Platform\/Command/i.test(c.url));
  for (const c of cmds) {
    let body = null; try { body = JSON.parse(c.body); } catch {}
    fs.writeFileSync(path.join(OUT, `command-${fileIdx++}.json`), JSON.stringify({ url: c.url, reqBody: c.reqBody, body }, null, 2));
  }
  console.log('Saved:', fm.length, 'FM + ', cmds.length, 'commands');

  await client.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
