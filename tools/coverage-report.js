// Stage E — manifest -> coverage.json + coverage.md (headline % + residual gap table).
const fs = require('fs'); const path = require('path');
const ROOT = (process.env.OUT_ROOT || 'C:/Workstation/dual-verify-swarm/tools/out');
const m = JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.json'),'utf8'));
const declared = m.targets.filter(t=>t.source==='config');
const driven = declared.filter(t=>t.driven);
const pct = declared.length? Math.round(driven.length/declared.length*100):0;
const residual = m.targets.filter(t=>!t.driven);
const summary = { coveragePct: pct, declared: declared.length, driven: driven.length, residual: residual.length, crawlerAdded: m.targets.filter(t=>t.source==='dom').length, cellViewers: m.cellViewers||[] };
fs.writeFileSync(path.join(ROOT,'coverage.json'), JSON.stringify({ summary, targets: m.targets }, null, 2));
let md = `# Coverage Report\n\n**Coverage = ${pct}%** (${driven.length}/${declared.length} declared targets driven)\n\n`;
md += `- Crawler-discovered client-only controls: ${summary.crawlerAdded}\n`;
md += `- Renderer types (cellViewers) declared: ${(m.cellViewers||[]).join(', ')||'none'}\n\n`;
md += residual.length
  ? `## Residual gaps (${residual.length})\n\n| Target | Type | Source | Reason |\n|---|---|---|---|\n` + residual.map(t=>`| ${t.label} | ${t.type} | ${t.source} | ${t.reasonIfNot||'unknown'} |`).join('\n') + '\n'
  : `## Residual gaps\n\nNone — 100% of declared targets driven.\n`;
md += `\n> "100% covered" is claimable only when this residual list is empty across config/dom/code sources.\n`;
fs.writeFileSync(path.join(ROOT,'coverage.md'), md);
console.log('COVERAGE', pct+'%', '| residual', residual.length, '| wrote coverage.md + coverage.json');
