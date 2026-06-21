// Stage D — generate ready-to-paste prompts for parallel read-only agents
// (code-mapper per screen region + one critic). Runs AFTER reconcile.js (Stage C).
//
// This script cannot itself invoke Claude agents (it's plain Node, outside Claude
// Code), so it WRITES each agent prompt to out/agent-prompts/<name>.md and PRINTS
// dispatch instructions to STDOUT. The user (or an automated dispatcher) then runs
// each printed agent; coverage-report.js (Stage E) folds in their findings-*.md.

const fs = require('fs');
const path = require('path');

const ROOT = process.env.OUT_ROOT || 'C:/Workstation/dual-verify-swarm/tools/out';
const CFG = path.join(ROOT, 'config');
const PROMPTS = path.join(ROOT, 'agent-prompts');
const WEBCLIENT = 'C:\\Workstation\\orbitax-dashboard-webclient_fork\\src\\app';
const CARBON_SKILLS = 'C:\\Workstation\\orbitax-carbon_fork\\projects\\itp\\skills';

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// --- load manifest (required) -------------------------------------------------
const manifestPath = path.join(ROOT, 'manifest.json');
const manifest = readJson(manifestPath);
if (!manifest) {
  console.error('ERROR: manifest.json not found at ' + manifestPath + '. Run build-manifest.js (Stage B) first.');
  process.exit(1);
}
const targets = manifest.targets || [];

// --- load coverage summary (optional) ----------------------------------------
const coverage = readJson(path.join(ROOT, 'coverage.json'));

// --- map each column key -> sourceType via the captured fieldSections bodies --
// reqBody carries  sourceType:"ED-Transaction"  and the body holds that section's
// field definitions, so we can attribute each column key to a screen region.
const keyToSource = {};
const sourceTypes = new Set();
const cfgFiles = fs.existsSync(CFG) ? fs.readdirSync(CFG) : [];
for (const f of cfgFiles.filter(x => x.startsWith('fieldSections'))) {
  const c = readJson(path.join(CFG, f));
  if (!c) continue;
  const m = /sourceType:\s*\\?"([^"\\]+)\\?"/.exec(String(c.reqBody || ''));
  const st = m ? m[1] : null;
  if (!st) continue;
  sourceTypes.add(st);
  const data = (c.body && (c.body.data || c.body)) || {};
  const first = data.firstFieldSection || (data.fieldSections && data.fieldSections[0]);
  for (const g of ((first && first.fieldGroups) || [])) {
    for (const d of (g.definitions || g.fieldDefinitions || [])) {
      if (d.key) keyToSource[d.key] = st;
    }
  }
}

// --- group column targets by region (sourceType), falling back to "all" -------
const columns = targets.filter(t => t.type === 'column');
const byRegion = {};
for (const col of columns) {
  const region = keyToSource[col.key] || 'all';
  (byRegion[region] = byRegion[region] || []).push(col);
}
// If nothing mapped (no config or no keys), still emit one region so the agent runs.
if (Object.keys(byRegion).length === 0 && columns.length) byRegion.all = columns;

// --- helpers ------------------------------------------------------------------
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
fs.mkdirSync(PROMPTS, { recursive: true });

const writtenPrompts = [];
const writePrompt = (name, text) => {
  const file = path.join(PROMPTS, name + '.md');
  fs.writeFileSync(file, text);
  writtenPrompts.push({ name, file });
  return text;
};

// --- build one code-mapper prompt per region ---------------------------------
const dispatch = [];
for (const [region, cols] of Object.entries(byRegion)) {
  const name = 'code-mapper-' + slug(region);
  const sourceType = region;
  const elementLines = cols.map(c => `- ${c.label} | ${c.cellViewer || '(none)'}`).join('\n');
  const findingsPath = path.join(ROOT, `findings-${name}.md`).replace(/\\/g, '\\\\');
  const text =
`=== AGENT: ${name} ===
Task: Read-only code mapping for ${region} (${sourceType})
Webclient repo: ${WEBCLIENT}
Carbon skills dir: ${CARBON_SKILLS}

For each declared element below, find its Angular component path:line in the webclient.
Flag any declared-but-no-code (element in manifest with no matching component) and code-but-not-declared (component exists in webclient but not in manifest).

Declared elements:
${elementLines || '(no columns mapped to this region)'}

Output: Write findings to ${findingsPath}
Format: one row per element: | label | cellViewer | component path:line | status (found/missing/extra) |
`;
  writePrompt(name, text);
  dispatch.push(text);
}

// --- build the single critic prompt ------------------------------------------
const coveragePathDisp = path.join(ROOT, 'coverage.json').replace(/\\/g, '\\\\');
const manifestPathDisp = path.join(ROOT, 'manifest.json').replace(/\\/g, '\\\\');
const criticFindings = path.join(ROOT, 'findings-critic.md').replace(/\\/g, '\\\\');
const criticText =
`=== AGENT: critic ===
Task: Coverage critique — what's missing from the rebuild picture?
Inputs: Read ${coveragePathDisp} and ${manifestPathDisp}

Answer these questions:
1. Which cellViewer renderer types are declared but have no matching carbon skill?
   (Carbon skills dir: ${CARBON_SKILLS})
2. Which residual targets are most important to resolve for the rebuild?
3. What UI patterns exist in the manifest that have no carbon skill at all?
4. Any suspicious absences — things you'd expect to see but don't?

Output: Write findings to ${criticFindings}
`;
writePrompt('critic', criticText);
dispatch.push(criticText);

// --- print dispatch instructions ---------------------------------------------
console.log('STAGE D — dispatch the following ' + dispatch.length + ' read-only agents (no browser).');
console.log('Each prompt is also saved under ' + PROMPTS + ' for copy-paste / automated dispatch.\n');
console.log('Manifest: ' + columns.length + ' columns across ' + Object.keys(byRegion).length + ' region(s) [' + Object.keys(byRegion).join(', ') + ']');
if (coverage && coverage.summary) {
  const s = coverage.summary;
  console.log('Coverage: ' + s.coveragePct + '% driven (' + s.driven + '/' + s.declared + '), residual ' + s.residual);
} else {
  console.log('Coverage: coverage.json not found (run reconcile.js + coverage-report.js for driven/residual context).');
}
console.log('');
for (const t of dispatch) { console.log(t); }
console.log('After agents finish, their findings-*.md land in ' + ROOT + '; coverage-report.js folds them in.');
console.log('\nPrompt files written:');
for (const p of writtenPrompts) console.log('  ' + p.file);
