// Stage E (enrich) — Gap Classifier + A<->B dual-verify prompt generator for the
// Coverage Enrichment Loop (Phase 2 of 2026-06-22-coverage-enrichment-design.md).
//
// Reads coverage.json (residual targets) + manifest.json, classifies each residual
// target by reasonIfNot into 3 clusters, and — like stage-d.js — WRITES one A prompt
// and one independent-verifier B prompt per non-empty cluster to out/agent-prompts/,
// then PRINTS dispatch instructions. No runtime Claude API dependency.
//
// Clusters:
//   hidden-cols     reasons: hidden-needs-toggle, no-definition
//   interaction     reasons: render-not-observed, couldnt-locate (column/filter/widget)
//   domain-meaning  any label with no match in CONTEXT.md (or all, if no CONTEXT.md)
//   SKIP            reason: commit-guarded (already a correct label)

const fs = require('fs');
const path = require('path');

const ROOT = process.env.OUT_ROOT || 'C:/Workstation/dual-verify-swarm/tools/out';
const CFG = path.join(ROOT, 'config');
const PROMPTS = path.join(ROOT, 'agent-prompts');

const SWARM_ROOT = 'C:\\Workstation\\dual-verify-swarm';
const CONTEXT_MD = path.join(SWARM_ROOT, 'CONTEXT.md');
const ADR_DIR = path.join(SWARM_ROOT, 'docs', 'adr');
const WEBCLIENT = 'C:\\Workstation\\orbitax-dashboard-webclient_fork\\src\\app';
const CELL_COMPONENTS = path.join(WEBCLIENT, 'shared', 'components', 'cell-components');
const ITP_CLAUDE = 'C:\\Workstation\\orbitax-carbon_fork\\projects\\itp\\claude.md';

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const disp = p => String(p).replace(/\\/g, '\\\\');

// --- required inputs ----------------------------------------------------------
const coveragePath = path.join(ROOT, 'coverage.json');
const coverage = readJson(coveragePath);
if (!coverage) {
  console.error('ERROR: coverage.json not found at ' + coveragePath + '. Run coverage-report.js first.');
  process.exit(1);
}
const manifestPath = path.join(ROOT, 'manifest.json');
const manifest = readJson(manifestPath);
if (!manifest) {
  console.error('ERROR: manifest.json not found at ' + manifestPath + '. Run build-manifest.js first.');
  process.exit(1);
}

const allTargets = coverage.targets || [];
const residual = allTargets.filter(t => t.driven === false);
const cellViewersAll = manifest.cellViewers || [];

// --- CONTEXT.md label index (for domain-meaning classification) ---------------
let contextText = null;
if (fs.existsSync(CONTEXT_MD)) {
  try { contextText = fs.readFileSync(CONTEXT_MD, 'utf8').toLowerCase(); } catch { contextText = null; }
}
const labelInContext = label => {
  if (contextText === null) return false; // no CONTEXT.md -> every domain label needs enrichment
  return contextText.includes(String(label).toLowerCase());
};

// --- classify residual targets into clusters ---------------------------------
const HIDDEN_REASONS = new Set(['hidden-needs-toggle', 'no-definition']);
const INTERACTION_REASONS = new Set(['render-not-observed', 'couldnt-locate']);
const INTERACTION_TYPES = new Set(['column', 'filter', 'widget']);

const clusters = { 'hidden-cols': [], 'interaction': [], 'domain-meaning': [] };
let skipped = 0;

for (const t of residual) {
  const reason = t.reasonIfNot || 'unknown';
  if (reason === 'commit-guarded') { skipped++; continue; }
  if (HIDDEN_REASONS.has(reason)) {
    clusters['hidden-cols'].push(t);
  } else if (INTERACTION_REASONS.has(reason) && INTERACTION_TYPES.has(t.type)) {
    clusters['interaction'].push(t);
  }
  // domain-meaning: any residual (non-commit-guarded) target whose label isn't in CONTEXT.md
  if (!labelInContext(t.label)) {
    clusters['domain-meaning'].push(t);
  }
}

// --- column definition lookup from captured fieldSections config bodies -------
// Maps a column label/key to {cellViewer, type, options, isHidden} for the hidden-cols prompt.
const defByLabel = {};
const cfgFiles = fs.existsSync(CFG) ? fs.readdirSync(CFG) : [];
for (const f of cfgFiles.filter(x => x.startsWith('fieldSections'))) {
  const c = readJson(path.join(CFG, f));
  if (!c) continue;
  const data = (c.body && (c.body.data || c.body)) || {};
  const first = data.firstFieldSection || (data.fieldSections && data.fieldSections[0]);
  for (const g of ((first && first.fieldGroups) || [])) {
    for (const d of (g.definitions || g.fieldDefinitions || [])) {
      const def = {
        cellViewer: d.cellViewer || null,
        type: d.type || null,
        options: d.options || d.optionsKey || null,
        isHidden: !!d.isHidden,
      };
      if (d.header) defByLabel[d.header] = def;
      if (d.key) defByLabel[d.key] = def;
    }
  }
}
const lookupDef = t => defByLabel[t.label] || (t.key && defByLabel[t.key]) || {
  cellViewer: t.cellViewer || null, type: null, options: null, isHidden: t.isHidden,
};

// --- output plumbing ----------------------------------------------------------
fs.mkdirSync(PROMPTS, { recursive: true });
const writtenPrompts = [];
const writePrompt = (name, text) => {
  const file = path.join(PROMPTS, name + '.md');
  fs.writeFileSync(file, text);
  writtenPrompts.push({ name, file });
  return text;
};

const dispatch = [];

// --- hidden-cols prompts ------------------------------------------------------
function buildHiddenCols(cols) {
  const rows = cols.map(t => {
    const d = lookupDef(t);
    return `- ${t.label} | ${d.cellViewer || '(none)'} | ${t.reasonIfNot || 'unknown'}`;
  }).join('\n');
  const findingsA = disp(path.join(ROOT, 'findings-enrich-hidden-cols-A.md'));
  const findingsB = disp(path.join(ROOT, 'findings-enrich-hidden-cols-B.md'));
  const task =
`Task: Read-only code mapping for HIDDEN COLUMNS (hidden-needs-toggle / no-definition).
These columns are declared in server config but not rendered in the default view.

Webclient: ${WEBCLIENT}
Config bodies: ${disp(CFG)}\\

For each hidden column below, find:
1. Its full field definition in the captured fieldSections config body (cellViewer, type, options, isHidden)
2. The Angular component that renders it: search webclient for the cellViewer class name -> path:line
3. Whether a "Fields" column-chooser exists that would show it: search for ShowHideColumns / columnChooser patterns

Hidden columns to map:
${rows || '(none)'}`;

  const a =
`=== AGENT A: enrich-hidden-cols ===
${task}

Output: Write findings to ${findingsA}
Format: | Column | cellViewer | Definition source | Component path:line | Chooser path:line |`;

  const b =
`=== AGENT B: enrich-hidden-cols-verifier ===
Task: INDEPENDENTLY verify Agent A's findings for hidden columns. Do NOT read Agent A's output.
Re-read the same sources from scratch and produce your own findings. Disagreements are CONFLICTS.

${task}

Output: Write to ${findingsB}
Same format as A. Note any item where your finding differs from what A would find as: CONFLICT: <item> — [your finding]`;

  writePrompt('enrich-hidden-cols-A', a);
  writePrompt('enrich-hidden-cols-B', b);
  dispatch.push(a, b);
}

// --- interaction prompts ------------------------------------------------------
function buildInteraction(items) {
  // Prompt lists the cellViewers from the manifest (declared renderer types).
  const cvList = (cellViewersAll.length ? cellViewersAll : [...new Set(items.map(i => i.cellViewer).filter(Boolean))])
    .map(cv => `- ${cv}`).join('\n');
  const findingsA = disp(path.join(ROOT, 'findings-enrich-interaction-A.md'));
  const findingsB = disp(path.join(ROOT, 'findings-enrich-interaction-B.md'));
  const task =
`Task: Read-only source mapping for UNVERIFIED CELL BEHAVIORS (render-not-observed / couldnt-locate).
These cellViewer types are declared in config but their hover/edit/modal/drill-down behavior was not captured live.

Webclient: ${CELL_COMPONENTS}

For each cellViewer below, find its component .ts + .html and describe:
1. Does it have a hover-revealed button? (info/edit/action icon that appears on :hover)
2. Does clicking anything open a dialog/modal? If so, what does it contain?
3. Does clicking the cell navigate somewhere? If so, what route pattern?

CellViewers to map:
${cvList || '(none)'}`;

  const a =
`=== AGENT A: enrich-interaction ===
${task}

Output: Write to ${findingsA}
Format: | cellViewer | Component path:line | Hover behavior | Modal/dialog | Drill-down route |`;

  const b =
`=== AGENT B: enrich-interaction-verifier ===
Task: INDEPENDENTLY verify Agent A's findings for cell behaviors. Do NOT read Agent A's output.
Re-read the same sources from scratch and produce your own findings. Disagreements are CONFLICTS.

${task}

Output: Write to ${findingsB}
Same format as A. Note any item where your finding differs from what A would find as: CONFLICT: <item> — [your finding]`;

  writePrompt('enrich-interaction-A', a);
  writePrompt('enrich-interaction-B', b);
  dispatch.push(a, b);
}

// --- domain-meaning prompts ---------------------------------------------------
function buildDomain(items) {
  const labels = [...new Set(items.map(i => i.label))].map(l => `- ${l}`).join('\n');
  const findingsA = disp(path.join(ROOT, 'findings-enrich-domain-A.md'));
  const findingsB = disp(path.join(ROOT, 'findings-enrich-domain-B.md'));
  const task =
`Task: Map column/widget labels to domain business terms using CONTEXT.md and ADRs.

Read: ${disp(CONTEXT_MD)} (if exists)
Read: ${disp(ADR_DIR)} (if exists)
Read: ${disp(ITP_CLAUDE)}

For each label below, find its business meaning. If it IS in CONTEXT.md already, confirm the definition.
If NOT in CONTEXT.md, derive from the webclient source (search for the label in component templates).
Webclient: ${WEBCLIENT}

Labels to map:
${labels || '(none)'}`;

  const a =
`=== AGENT A: enrich-domain-meaning ===
${task}

Output: Write to ${findingsA}
Format: | Label | Domain term | Definition | Source (CONTEXT.md:line or path:line) | In CONTEXT.md? |`;

  const b =
`=== AGENT B: enrich-domain-meaning-verifier ===
Task: INDEPENDENTLY verify Agent A's domain mappings. Do NOT read Agent A's output.
Re-read the same sources from scratch and produce your own findings. Disagreements are CONFLICTS.

${task}

Output: Write to ${findingsB}
Same format as A. Note any item where your finding differs from what A would find as: CONFLICT: <item> — [your finding]`;

  writePrompt('enrich-domain-meaning-A', a);
  writePrompt('enrich-domain-meaning-B', b);
  dispatch.push(a, b);
}

// --- generate prompts for each non-empty cluster ------------------------------
if (clusters['hidden-cols'].length) buildHiddenCols(clusters['hidden-cols']);
if (clusters['interaction'].length) buildInteraction(clusters['interaction']);
if (clusters['domain-meaning'].length) buildDomain(clusters['domain-meaning']);

// --- dispatch summary ---------------------------------------------------------
const nonEmpty = Object.entries(clusters).filter(([, v]) => v.length);
console.log('STAGE E (enrich) — Gap Classifier + dual-verify prompt generation.');
console.log('Residual targets: ' + residual.length + ' | commit-guarded skipped: ' + skipped + ' | CONTEXT.md: ' + (contextText === null ? 'NOT FOUND (all domain labels need enrichment)' : 'found'));
console.log('Clusters:');
for (const [name, items] of Object.entries(clusters)) {
  console.log('  ' + name + ': ' + items.length + (items.length ? '' : ' (no prompts)'));
}
console.log('');

if (!dispatch.length) {
  console.log('No non-empty clusters — nothing to enrich. (All residual items may be commit-guarded or CONTEXT.md covers every label.)');
} else {
  console.log('Dispatch the following ' + dispatch.length + ' read-only agents (no browser). Each prompt is also saved under ' + PROMPTS + ':\n');
  for (const t of dispatch) { console.log(t); console.log(''); }
  console.log('After agents finish, their findings-enrich-*.md land in ' + ROOT + '.');
  console.log('A single writer then merges A<->B-confirmed findings into coverage-enriched.md; CONFLICT items surface to Phase 3 (human / grill-with-docs).');
}

console.log('\n' + nonEmpty.length + ' non-empty cluster(s), ' + writtenPrompts.length + ' prompt(s) written:');
for (const p of writtenPrompts) console.log('  ' + p.file);
