// Stage F — auto-seed dual-verify-orchestrator from coverage.json residual gaps.
// Runs automatically after coverage-report.js (Stage E).
// Writes out/dual-verify-seed.md — pass that file as the seed to /dual-verify-orchestrator.
const fs = require('fs'); const path = require('path');
const ROOT = (process.env.OUT_ROOT || 'C:/Workstation/dual-verify-swarm/tools/out');
const covPath = path.join(ROOT, 'coverage.json');
if (!fs.existsSync(covPath)) { console.error('ERR: coverage.json not found — run coverage-report.js first'); process.exit(1); }
const cov = JSON.parse(fs.readFileSync(covPath, 'utf8'));
const residual = (cov.targets || []).filter(t => !t.driven && t.source === 'config');
if (!residual.length) { console.log('STAGE F: residual = 0 — nothing to seed. Pipeline complete.'); process.exit(0); }

// Group by reason
const byReason = {};
for (const t of residual) { const k = t.reasonIfNot || 'unknown'; (byReason[k] = byReason[k] || []).push(t); }

const lines = [
  `# Dual-Verify Seed — Coverage Oracle Residual Gaps`,
  ``,
  `MODE: Mode 2 — autonomous research. Do not ask questions; decide from evidence;`,
  `when ambiguous pick the simpler reading and flag it.`,
  ``,
  `## Goal`,
  `Verify each residual gap below against the webclient source.`,
  `For each gap: find the Angular component (path:line) that declares or renders this element.`,
  `If found → CONFIRMED (gap is a render/interaction gap, spec captured).`,
  `If not found → MISSING (genuine spec gap, flag for design decision).`,
  `Update CONTEXT.md with any domain terms that lack a definition.`,
  `Stop only on CONFLICT (two sources disagree). Never ask the user for anything else.`,
  ``,
  `## Residual gaps (${residual.length} total)`,
  ``,
];
for (const [reason, targets] of Object.entries(byReason)) {
  lines.push(`### ${reason} (${targets.length})`);
  for (const t of targets) lines.push(`- [${t.type}] ${t.label}${t.cellViewer ? ` | cellViewer: ${t.cellViewer}` : ''}`);
  lines.push('');
}
lines.push(`## Webclient repo (read-only)`);
lines.push(`C:\\Workstation\\orbitax-dashboard-webclient_fork\\src\\app`);
lines.push(``);
lines.push(`## Output`);
lines.push(`Write findings to C:\\Workstation\\dual-verify-swarm\\tools\\out\\coverage-enriched.md`);
lines.push(`Surface coverage-enriched.md to the user when done. Do not build or fix anything.`);

const seedPath = path.join(ROOT, 'dual-verify-seed.md');
fs.writeFileSync(seedPath, lines.join('\n'), 'utf8');
console.log(`STAGE F: ${residual.length} residual gaps → seed written to ${seedPath}`);
console.log('Next: /dual-verify-orchestrator with seed =', seedPath);
