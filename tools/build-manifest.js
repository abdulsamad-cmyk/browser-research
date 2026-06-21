// Stage B — flatten captured config bodies into coverage targets.
const fs = require('fs'); const path = require('path');
const ROOT = (process.env.OUT_ROOT || 'C:/Workstation/dual-verify-swarm/tools/out');
const CFG = path.join(ROOT, 'config');
const files = fs.existsSync(CFG) ? fs.readdirSync(CFG) : [];
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(CFG,f),'utf8')); } catch { return null; } };
const targets = [];
const push = (type,label,extra={}) => { if(!label) return; const id=`${type}:${label}`; if(targets.some(t=>t.id===id))return; targets.push({id,type,label,source:'config',driven:false,evidence:null,reasonIfNot:null,...extra}); };

// Optional: scope to a target sourceType (e.g. "FM-FilingForms") so only that screen's columns count.
const SOURCE_TYPE = process.argv[2] || null;
for (const f of files.filter(x=>x.startsWith('fieldSections'))) {
  const c = read(f);
  if (SOURCE_TYPE && !(c && c.reqBody && String(c.reqBody).includes(SOURCE_TYPE))) continue; // wrong tool's columns
  const data = c && (c.body?.data || c.body); const first = data?.firstFieldSection || data?.fieldSections?.[0];
  for (const g of (first?.fieldGroups||[])) for (const d of (g.definitions||g.fieldDefinitions||[])) {
    push('column', d.header, { key:d.key, cellViewer:d.cellViewer, canFilter:!!d.canFilter, hasDetails:!!d.hasDetails, isHidden:!!d.isHidden });
    if (d.canFilter) push('filter', d.header);
  }
}
// NOTE: command-body `tabs`/`tabBar.tabs` fields hold per-tool COMPONENT identifiers
// (e.g. "XatBotComponent", "Dashboard Designer"), NOT the rendered sub-nav (Dashboard/Library/
// My Forms/Transmissions). Extracting them fabricates false targets, so we do NOT. The real
// sub-nav is captured reliably by the DOM crawler in reconcile.js (source:"dom").
for (const f of files.filter(x=>x.startsWith('query'))) {
  const c = read(f); const w = c?.body?.fieldValues?.PlatformWidgetConfigurationModel?.widgets || c?.body?.widgets;
  for (const wi of (w||[])) push('widget', wi.title||wi.name||wi.type);
}
const cellViewers = [...new Set(targets.filter(t=>t.cellViewer).map(t=>t.cellViewer))];
fs.writeFileSync(path.join(ROOT,'manifest.json'), JSON.stringify({ targets, cellViewers }, null, 2));
const colCount = targets.filter(t=>t.type==='column').length;
if (SOURCE_TYPE && colCount === 0) console.log('⚠️  WARNING: 0 columns for sourceType "'+SOURCE_TYPE+'" — fieldSections likely NOT captured (warm cache?). Re-run config-capture; do NOT trust coverage.');
console.log('MANIFEST targets', targets.length, '| columns', colCount, '| cellViewers', cellViewers.length);
console.log('byType', JSON.stringify(targets.reduce((a,t)=>{a[t.type]=(a[t.type]||0)+1;return a;},{})));
console.log('cellViewers', JSON.stringify(cellViewers));
