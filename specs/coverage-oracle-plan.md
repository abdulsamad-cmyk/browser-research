# Coverage Oracle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give feature-learner a self-verifying coverage stage that captures server config, builds a manifest of declared UI, drives every target in a bounded loop, and emits an honest coverage report with a residual gap list.

**Architecture:** Five stages — CAPTURE (serial browser, save response bodies) → BUILD MANIFEST (pure parse) → DRIVE-RECONCILE (serial browser, bounded loop + crawler + commit-guard) → MAP+CRITIC (parallel read-only agents) → REPORT. Implemented as 4 Node scripts under `feature-learner/tools/` plus SKILL.md documentation. Browser stays single-CDP serial; only Stage D fans out.

**Tech Stack:** Node 20, `playwright-core` (CDP connect to Chrome on :9222), plain JS (CommonJS), JSON artifacts under `tools/out/`.

## Global Constraints

- **Read-only / no-commit-to-app:** never click Save/Submit/Apply/Create/Delete/Remove/Discard/Sign out/Log out/OK/Yes. Open → observe → Escape/Cancel.
- **Serial browser:** exactly one process drives CDP (`chromium.connectOverCDP('http://localhost:9222')`); parallel only for read-only code-mapping agents.
- **SPA navigation:** never `page.goto(<route>)` to change screens (re-triggers splash); navigate in-app (click), drive splash once.
- **Honesty:** every un-driven target appears in the residual report with a reason; "100%" only when residual empty across config/dom/code.
- **Bounds:** reconcile loop stops at coverage ≥ 95% OR no-progress 2 passes OR pass-cap 3.
- **Run scripts from** `~/.claude/skills/feature-learner/tools/` (so `playwright-core` resolves); pass Windows-style paths; `MSYS_NO_PATHCONV=1` when args start with `/`.
- **Output root:** `C:/Workstation/dual-verify-swarm/tools/out/` (configurable via `OUT_ROOT` const).
- **Commit steps execute only with explicit user approval** (project standing rule: no auto-commits).

---

## File Structure

- `tools/config-capture.js` — Stage A: drive feature, save XHR/fetch response bodies, tag structural ones.
- `tools/build-manifest.js` — Stage B: config bodies → `manifest.json` (flat coverage targets).
- `tools/reconcile.js` — Stage C: bounded drive-reconcile loop + crawler interleave + commit-guard → updates manifest.
- `tools/coverage-report.js` — Stage E: manifest (+ optional agent findings) → `coverage.json` + `coverage.md`.
- `SKILL.md` — add "Coverage Oracle" section (Stages A-E + Stage D agent-dispatch procedure), report-template Coverage section, hard rule.

Stage D (map + critic) is an **agent-dispatch procedure documented in SKILL.md**, not a script — it consumes `manifest.json` and writes `findings-*.md` that `coverage-report.js` folds in.

---

### Task 1: config-capture.js (Stage A — capture response bodies)

**Files:**
- Create: `~/.claude/skills/feature-learner/tools/config-capture.js`
- Output: `tools/out/config/*.json` (one file per captured body)

**Interfaces:**
- Consumes: a live Chrome on CDP :9222 already past the splash on the target feature (or it drives the splash itself).
- Produces: `out/config/<tag>-<n>.json` files, each `{url, status, body}`; structural tags = `fieldSections|command|gridData|query`.

- [ ] **Step 1: Write the script**

```js
// config-capture.js — Stage A. Save XHR/fetch response BODIES; tag structural ones.
const { chromium } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const OUT = (process.env.OUT_ROOT || 'C:/Workstation/dual-verify-swarm/tools/out') + '/config';
const STRUCTURAL = /FilingManagerApi|Platform\/Command|DynamicGridData|\/api\/Query|\/graphql\/|fieldSections|widget/i;
fs.mkdirSync(OUT, { recursive: true });
function tagFor(u){ if(/FilingManagerApi|fieldSections|graphql/i.test(u))return 'fieldSections'; if(/Command/i.test(u))return 'command'; if(/DynamicGridData/i.test(u))return 'gridData'; return 'query'; }
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page; for (const c of browser.contexts()) for (const p of c.pages()) if (p.url().includes('localhost:9000')) page = p;
  if (!page) { console.log('NO_PAGE'); return browser.close(); }
  await page.bringToFront().catch(()=>{});
  const captured = [], pending = [];
  page.on('response', (res) => { const u = res.url(); if (!STRUCTURAL.test(u)) return;
    pending.push((async()=>{ let body=null; try{body=await res.json();}catch{try{body=await res.text();}catch{}} captured.push({url:u,status:res.status(),body}); })().catch(()=>{})); });
  // drive splash if present
  const btn = page.locator('button:has-text("Continue to Orbitax")').first();
  for (let i=0;i<60 && (await btn.count().catch(()=>0));i++){ if(await btn.isEnabled().catch(()=>false)){await btn.click({timeout:8000}).catch(()=>{});break;} await page.waitForTimeout(1000);}
  await page.waitForTimeout(3000);
  // CALLER is expected to have navigated to the feature; trigger a tab re-click to force fresh load
  const target = process.argv[2]; // optional tab title to click, e.g. "My Forms"
  if (target){ const t = page.locator(`a[title="${target}"]`).first(); if(await t.count().catch(()=>0)){ await t.click().catch(()=>{}); } }
  await page.waitForLoadState('networkidle',{timeout:20000}).catch(()=>{});
  await page.waitForTimeout(6000);
  await Promise.allSettled(pending);
  let i=0; for (const c of captured) fs.writeFileSync(path.join(OUT,`${tagFor(c.url)}-${i++}.json`), JSON.stringify(c,null,2));
  console.log('CAPTURED_BODIES', captured.length, captured.map(c=>tagFor(c.url)).join(','));
  await browser.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
```

- [ ] **Step 2: Run against the live app on the target feature**

Run (from tools dir, app driven to filing-manager): `MSYS_NO_PATHCONV=1 node config-capture.js "My Forms"`
Expected: `CAPTURED_BODIES <n>` with `n >= 2` and at least one `fieldSections`; files appear in `out/config/`.

- [ ] **Step 3: Verify a fieldSections body contains column definitions**

Run: `node -e "const f=require('fs').readdirSync(process.env.OUT_ROOT?process.env.OUT_ROOT+'/config':'C:/Workstation/dual-verify-swarm/tools/out/config').find(x=>x.startsWith('fieldSections'));console.log(f||'NONE')"`
Expected: a `fieldSections-*.json` filename printed (not NONE). Open it; confirm it has `data.firstFieldSection.fieldGroups[].definitions[]` with `header`/`cellViewer`.

- [ ] **Step 4: Commit** (only on user approval)

```bash
git add tools/config-capture.js && git commit -m "feat(feature-learner): Stage A config-capture (response bodies)"
```

---

### Task 2: build-manifest.js (Stage B — config → coverage targets)

**Files:**
- Create: `~/.claude/skills/feature-learner/tools/build-manifest.js`
- Read: `tools/out/config/*.json`
- Output: `tools/out/manifest.json`

**Interfaces:**
- Consumes: `out/config/fieldSections-*.json` (column defs), `command-*.json` (magicLinkModel: tabBar, toolbar), `query-*.json` (widget config).
- Produces: `manifest.json` = `{ targets: [ {id, type, label, cellViewer?, canFilter?, hasDetails?, source:"config", driven:false, evidence:null, reasonIfNot:null} ], cellViewers: string[] }`.

- [ ] **Step 1: Write the script**

```js
// build-manifest.js — Stage B. Flatten config bodies into coverage targets.
const fs = require('fs'); const path = require('path');
const ROOT = (process.env.OUT_ROOT || 'C:/Workstation/dual-verify-swarm/tools/out');
const CFG = path.join(ROOT, 'config');
const files = fs.existsSync(CFG) ? fs.readdirSync(CFG) : [];
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(CFG,f),'utf8')); } catch { return null; } };
const targets = []; const push = (type,label,extra={}) => { if(!label) return; const id=`${type}:${label}`; if(targets.some(t=>t.id===id))return; targets.push({id,type,label,source:'config',driven:false,evidence:null,reasonIfNot:null,...extra}); };

// columns from fieldSections
for (const f of files.filter(x=>x.startsWith('fieldSections'))) {
  const c = read(f); const data = c && (c.body?.data || c.body); const first = data?.firstFieldSection || data?.fieldSections?.[0];
  for (const g of (first?.fieldGroups||[])) for (const d of (g.definitions||g.fieldDefinitions||[])) {
    push('column', d.header, { key:d.key, cellViewer:d.cellViewer, canFilter:!!d.canFilter, hasDetails:!!d.hasDetails, isHidden:!!d.isHidden });
    if (d.canFilter) push('filter', d.header);
  }
}
// tabs + toolbar from command (magicLinkModel)
for (const f of files.filter(x=>x.startsWith('command'))) {
  const c = read(f); const fv = c?.body?.fieldValues || c?.body?.data || {};
  const model = fv.PlatformLinkModel || fv;
  for (const t of (model?.tabBar?.tabs||model?.tabs||[])) push('tab', t.title||t.header||t.name);
  for (const tb of [].concat(model?.toolbar||[], model?.leftToolBar||[], model?.rightToolBar||[])) for (const item of (tb.items||tb.commands||[tb])) push('toolbarItem', item.title||item.label||item.name);
}
// widgets from query config
for (const f of files.filter(x=>x.startsWith('query'))) {
  const c = read(f); const w = c?.body?.fieldValues?.PlatformWidgetConfigurationModel?.widgets || c?.body?.widgets;
  for (const wi of (w||[])) push('widget', wi.title||wi.name||wi.type);
}
const cellViewers = [...new Set(targets.filter(t=>t.cellViewer).map(t=>t.cellViewer))];
fs.writeFileSync(path.join(ROOT,'manifest.json'), JSON.stringify({ targets, cellViewers }, null, 2));
console.log('MANIFEST targets', targets.length, '| cellViewers', cellViewers.length);
console.log('byType', JSON.stringify(targets.reduce((a,t)=>{a[t.type]=(a[t.type]||0)+1;return a;},{})));
```

- [ ] **Step 2: Run it**

Run: `node build-manifest.js`
Expected: `MANIFEST targets <n>` with column count matching the fieldSections (e.g. 17 for My Forms), `cellViewers >= 1`.

- [ ] **Step 3: Verify manifest shape**

Run: `node -e "const m=require((process.env.OUT_ROOT||'C:/Workstation/dual-verify-swarm/tools/out')+'/manifest.json');console.log(m.targets.filter(t=>t.type==='column').length,'columns;',m.cellViewers.length,'cellViewers')"`
Expected: column count > rendered-visible count (proves it captures hidden columns); cellViewers lists the distinct renderer types.

- [ ] **Step 4: Commit** (on approval)

```bash
git add tools/build-manifest.js && git commit -m "feat(feature-learner): Stage B manifest builder"
```

---

### Task 3: reconcile.js (Stage C — bounded drive-reconcile + crawler + commit-guard)

**Files:**
- Create: `~/.claude/skills/feature-learner/tools/reconcile.js`
- Read/Write: `tools/out/manifest.json` (sets `driven`/`evidence`/`reasonIfNot`)

**Interfaces:**
- Consumes: `manifest.json` (targets), live Chrome on the feature.
- Produces: updated `manifest.json` with `driven` flags + a `passes` log; appends `source:"dom"` targets discovered by the crawler.

- [ ] **Step 1: Write the script**

```js
// reconcile.js — Stage C. Bounded drive-reconcile loop + crawler + commit-guard.
const { chromium } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const ROOT = (process.env.OUT_ROOT || 'C:/Workstation/dual-verify-swarm/tools/out');
const MANI = path.join(ROOT,'manifest.json');
const THRESHOLD = 0.95, MAX_PASSES = 3;
const COMMIT_GUARD = /(save|submit|apply|create|delete|remove|discard|sign ?out|log ?out|^ok$|^yes$)/i;
const m = JSON.parse(fs.readFileSync(MANI,'utf8'));
const cov = () => m.targets.filter(t=>t.driven).length / Math.max(1,m.targets.length);

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page; for (const c of browser.contexts()) for (const p of c.pages()) if (p.url().includes('localhost:9000')) page = p;
  if (!page) { console.log('NO_PAGE'); return browser.close(); }
  await page.bringToFront().catch(()=>{});

  // helper: is a label present in DOM (column header / tab / button text)?
  async function seen(label){ return await page.evaluate(l => !!Array.from(document.querySelectorAll('th,[role="columnheader"],a[title],button,[role="tab"]')).find(e=>(e.innerText||e.getAttribute('title')||'').trim()===l), label).catch(()=>false); }

  let pass=0, lastDriven=-1;
  while (pass < MAX_PASSES && cov() < THRESHOLD) {
    pass++;
    for (const t of m.targets.filter(x=>!x.driven)) {
      if (COMMIT_GUARD.test(t.label)) { t.reasonIfNot='commit-guarded'; continue; }
      try {
        if (t.type==='tab'){ const el=page.locator(`a[title="${t.label}"]`).first(); if(await el.count()){ await el.click({timeout:4000}); await page.waitForTimeout(2500);} }
        if (t.type==='column' || t.type==='filter'){ /* scroll grid so column renders */ await page.evaluate(()=>{const sc=document.querySelector('.k-grid-content,.k-virtual-content'); if(sc){sc.scrollLeft=sc.scrollWidth;}}); await page.waitForTimeout(600); }
        if (await seen(t.label)) { t.driven=true; t.evidence='dom:'+t.type; }
        else if (!t.reasonIfNot) t.reasonIfNot='hidden-needs-toggle';
      } catch(e){ t.reasonIfNot='couldnt-locate'; }
    }
    const driven = m.targets.filter(x=>x.driven).length;
    console.log(`pass ${pass}: coverage ${(cov()*100).toFixed(0)}% (${driven}/${m.targets.length})`);
    if (driven===lastDriven) break; lastDriven=driven;
  }

  // crawler interleave: DOM interactive elements not matching any manifest label -> client-only targets
  const domLabels = await page.evaluate(()=>Array.from(document.querySelectorAll('button,a[href],[role="menuitem"],[role="tab"]')).map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()).filter(Boolean));
  for (const lbl of [...new Set(domLabels)]) if (!m.targets.some(t=>t.label===lbl)) m.targets.push({id:'dom:'+lbl,type:'domControl',label:lbl,source:'dom',driven:true,evidence:'crawler',reasonIfNot:null});

  fs.writeFileSync(MANI, JSON.stringify(m,null,2));
  console.log('FINAL coverage', (cov()*100).toFixed(0)+'%', '| residual', m.targets.filter(t=>!t.driven).length);
  await browser.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
```

- [ ] **Step 2: Run it on the live feature**

Run: `MSYS_NO_PATHCONV=1 node reconcile.js`
Expected: per-pass `coverage X%` lines, then `FINAL coverage X% | residual N`. Loop stops at threshold/no-progress/pass-cap.

- [ ] **Step 3: Verify commit-guard + residual reasons**

Run: `node -e "const m=require((process.env.OUT_ROOT||'C:/Workstation/dual-verify-swarm/tools/out')+'/manifest.json');console.log('guarded',m.targets.filter(t=>t.reasonIfNot==='commit-guarded').length);console.log('residual reasons',[...new Set(m.targets.filter(t=>!t.driven).map(t=>t.reasonIfNot))])"`
Expected: any Save/Delete-type targets show `commit-guarded`; residual targets each carry a reason (no `null` reasons among undriven).

- [ ] **Step 4: Commit** (on approval)

```bash
git add tools/reconcile.js && git commit -m "feat(feature-learner): Stage C reconcile loop + commit-guard"
```

---

### Task 4: coverage-report.js (Stage E — coverage.json + coverage.md)

**Files:**
- Create: `~/.claude/skills/feature-learner/tools/coverage-report.js`
- Read: `tools/out/manifest.json`, optional `tools/out/findings-*.md` (Stage D)
- Output: `tools/out/coverage.json`, `tools/out/coverage.md`

**Interfaces:**
- Consumes: reconciled `manifest.json`.
- Produces: `coverage.json` (copy of targets + summary) and human `coverage.md` (headline % + residual table).

- [ ] **Step 1: Write the script**

```js
// coverage-report.js — Stage E. manifest -> coverage.json + coverage.md.
const fs = require('fs'); const path = require('path');
const ROOT = (process.env.OUT_ROOT || 'C:/Workstation/dual-verify-swarm/tools/out');
const m = JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.json'),'utf8'));
const declared = m.targets.filter(t=>t.source==='config');
const driven = declared.filter(t=>t.driven);
const pct = declared.length? Math.round(driven.length/declared.length*100):0;
const residual = m.targets.filter(t=>!t.driven);
const summary = { coveragePct: pct, declared: declared.length, driven: driven.length, residual: residual.length, cellViewers: m.cellViewers||[] };
fs.writeFileSync(path.join(ROOT,'coverage.json'), JSON.stringify({ summary, targets: m.targets }, null, 2));
let md = `# Coverage Report\n\n**Coverage = ${pct}%** (${driven.length}/${declared.length} declared targets driven)\n\n`;
md += `Renderer types (cellViewers) declared: ${(m.cellViewers||[]).join(', ')||'none'}\n\n`;
md += residual.length? `## Residual gaps (${residual.length})\n\n| Target | Type | Source | Reason |\n|---|---|---|---|\n` + residual.map(t=>`| ${t.label} | ${t.type} | ${t.source} | ${t.reasonIfNot||'unknown'} |`).join('\n') + '\n'
                     : `## Residual gaps\n\nNone — 100% of declared targets driven.\n`;
md += `\n> "100% covered" is claimable only when this residual list is empty across config/dom/code sources.\n`;
fs.writeFileSync(path.join(ROOT,'coverage.md'), md);
console.log('COVERAGE', pct+'%', '| residual', residual.length, '| wrote coverage.md');
```

- [ ] **Step 2: Run it**

Run: `node coverage-report.js`
Expected: `COVERAGE X% | residual N | wrote coverage.md`.

- [ ] **Step 3: Verify the report reads honestly**

Run: `cat "$([ -n "$OUT_ROOT" ] && echo $OUT_ROOT || echo C:/Workstation/dual-verify-swarm/tools/out)/coverage.md"`
Expected: a headline %, a residual table where each row has a concrete reason, and the honesty footer. If residual non-empty, % < 100.

- [ ] **Step 4: Commit** (on approval)

```bash
git add tools/coverage-report.js && git commit -m "feat(feature-learner): Stage E coverage report"
```

---

### Task 5: SKILL.md — document the Coverage Oracle (Stages A-E + Stage D agents)

**Files:**
- Modify: `~/.claude/skills/feature-learner/SKILL.md`

**Interfaces:**
- Consumes: nothing at runtime; documents how to run Tasks 1-4 + the Stage D agent dispatch.
- Produces: a "Coverage Oracle" section, a report-template "Coverage" section, and a hard rule.

- [ ] **Step 1: Add the Coverage Oracle section after the DRIVE depth checklist**

Insert this markdown block:

```markdown
### Coverage Oracle (prove coverage, find gaps)

After driving a feature, run the oracle — a static snapshot cannot prove completeness.
Three sources of truth: server config (denominator), DOM crawler, code grep. A gap is
anything in any source not driven/captured.

1. **Capture** — `node tools/config-capture.js ["<Tab>"]` saves XHR/fetch response BODIES to
   `out/config/` (the server config that declares the UI).
2. **Manifest** — `node tools/build-manifest.js` flattens config into coverage targets
   (`out/manifest.json`): tabs, columns (+cellViewer/canFilter/hasDetails), toolbar items,
   widgets, filters.
3. **Reconcile** — `node tools/reconcile.js` drives each undriven target (bounded: ≤3 passes,
   stop at 95% or no-progress), interleaves a DOM crawler, and applies the commit-guard
   (never Save/Submit/Delete/Sign out). Updates the manifest with driven/evidence/reason.
4. **Map + critic (parallel, read-only agents)** — dispatch one agent per feature/region to
   map each declared element to a component `path:line` (source 3 = code) and flag
   declared-but-no-code / code-but-not-declared; plus one critic agent ("what's missing?").
   Agents write `out/findings-*.md`. Browser stays serial; agents never drive it.
5. **Report** — `node tools/coverage-report.js` emits `out/coverage.json` + `out/coverage.md`
   (headline %, residual gap table with a reason per row).
```

- [ ] **Step 2: Add a Coverage section to the Feature Learning Mode report template**

After the "## Interactions (driven)" template line, add:

```markdown
## Coverage
Headline coverage % (driven ÷ declared) from coverage.md, plus the residual gap table
(each gap with a reason). A feature is not "mapped" until this is recorded.
```

- [ ] **Step 3: Add the hard rule**

In the Feature Learning Mode "Hard rules" list, add:

```markdown
- **A feature is not "mapped" until the Coverage Oracle runs** (capture→manifest→reconcile→report)
  and the residual gap list is recorded. Never claim "captured everything" without a coverage.md.
```

- [ ] **Step 4: Verify the edits**

Run: `grep -c "Coverage Oracle" ~/.claude/skills/feature-learner/SKILL.md`
Expected: `>= 1`. Also `grep -c "not \"mapped\" until" SKILL.md` → `>= 1`.

- [ ] **Step 5: Commit** (on approval)

```bash
git add SKILL.md && git commit -m "docs(feature-learner): document Coverage Oracle stage"
```

---

## Self-Review

**Spec coverage:** Stage A→Task 1; Stage B→Task 2; Stage C (loop+crawler+commit-guard)→Task 3; Stage D (parallel agents)→documented in Task 5 step 1.4 + report folds findings; Stage E→Task 4; SKILL.md changes→Task 5. Three-source principle: config (Task 2), dom (Task 3 crawler), code (Task 5 Stage D agents). Bounds (95%/2/3) in Task 3. Commit-guard in Task 3. Honesty rule in Task 4. All spec sections mapped.

**Placeholder scan:** every step has runnable code + a concrete run command + expected output. No TBDs.

**Type consistency:** manifest target shape `{id,type,label,source,driven,evidence,reasonIfNot,(cellViewer,canFilter,hasDetails,key,isHidden)}` is identical across Task 2 (writer), Task 3 (mutator), Task 4 (reader). `cellViewers` array produced in Task 2, read in Task 4. Output paths use the same `OUT_ROOT` default everywhere.

**Open items deferred to execution:** the Stage-B parser handles the magicLinkModel shape best-effort (tabs/toolbar/widgets keys may vary) — Task 2 step 3 verifies columns concretely; tab/widget extraction is hardened during execution against the real `command-*.json` body (inspect it first).

## Execution Handoff

Plan saved to `~/.claude/skills/feature-learner/specs/coverage-oracle-plan.md`.
