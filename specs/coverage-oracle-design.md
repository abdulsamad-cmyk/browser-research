# Design — feature-learner "Coverage Oracle" (self-verifying coverage + gap finder)

- **Date:** 2026-06-21
- **Status:** Approved (brainstorm) — pending spec review → writing-plans
- **Skill affected:** `~/.claude/skills/feature-learner/SKILL.md` (+ new `tools/` scripts)
- **Origin:** Run 1 captured shell + filing-manager via static snapshots and missed interaction depth (hover icons, dropdowns, drill-downs) AND hidden config (My Forms `fieldSections` declares 17 columns; only 10 were rendered/seen). Relying on the user to manually walk the app to find gaps is the wrong design. feature-learner must verify its own coverage and surface gaps automatically.

## Problem

A one-shot DOM snapshot captures only what is statically rendered and visible. It cannot prove completeness. Real apps hide behaviour behind scroll, hover, clicks — and (for server-driven apps) behind config that declares UI never rendered in the default view. There is no honest "did we capture everything?" signal today.

## Goal

After learning a feature, feature-learner emits a **coverage report**: % of declared UI driven, and an explicit **residual gap list** (every un-driven element, each with a reason). "100%" is claimable only when the residual is empty across all sources. No silent misses.

Non-goal: pixel-perfect visual diffing; testing business logic; anything that commits data.

## Core principle — three-source triangulation

| Source | Declares | Captured by |
|---|---|---|
| **1. Server config** (denominator) | every tab, column (+`cellViewer`,`canFilter`,`hasDetails`), toolbar item, widget, row-action, filter option, command | parsing response **bodies** of structural endpoints (graphql `fieldSections`, tool/command model, widget config, named queries) |
| **2. DOM crawler** | every interactive element actually rendered | enumerate + drive to fixpoint |
| **3. Code grep** | every component / cellViewer / command in source | read-only agents over the frontend repo |

**Gap = present in ANY source but not driven/captured.** Coverage % = `driven ÷ declared` (source 1 is the denominator). Sources 2 + 3 catch what config omits.

**Verified 2026-06-21:** captured 28 config response bodies live; `fieldSections` for `FM-FilingForms` declared **17 columns** vs **10** seen in the rendered grid → the diff instantly surfaced 7 un-seen columns (incl two `EditStringCellViewerComponent` editable cells and a `FilingManagerWorkflowCellViewerComponent`). Evidence: `tools/out/config/DECLARED-COLUMNS.json`. Config-as-denominator finds gaps the eye cannot.

## Architecture (stages)

Browser drive is **serial** (one CDP process). Only the non-browser stages fan out.

### Stage A — CAPTURE (serial, browser)
Drive the feature (splash → in-SPA nav, never `page.goto` reload). Attach a `response` handler that, for any XHR/fetch returning JSON, saves the **body** to `tools/out/config/`; tag "structural" bodies (match `fieldSections|Command|widget|Query|Schema|/graphql/`). Continue existing network/DOM/screenshot capture.

### Stage B — BUILD MANIFEST (pure, no browser)
Parse captured config into a flat list of coverage targets. Each target:
```
{ id, type: tab|column|cellViewer|toolbarItem|widget|command|filterOption|rowAction,
  label, driveHint, source: "config", driven: false, evidence: null, reasonIfNot: null }
```
Column targets also carry `cellViewer`, `canFilter`, `hasDetails`. Distinct `cellViewer` values become a **renderer-registry** target list (each must be observed at least once).

### Stage C — DRIVE-RECONCILE LOOP (serial, browser, bounded)
For each undriven target, drive it by `driveHint`:
- tab → click it; column → scroll into view + hover a cell of that column; `canFilter` → open its filter ▾; `hasDetails`/row-action → hover row + click the revealed control; widget → ensure rendered; command → trigger its non-committing entry point.
Mark `driven=true` + record evidence (DOM el / dialog text / network fired) when observed.
- **Crawler interleave:** enumerate DOM interactive elements; any not matching a manifest target → add as `source:"dom"` (client-only) target and drive it.
- **Recompute** coverage each pass. **Stop** when coverage ≥ threshold (default 95%) **OR** no new target driven for 2 consecutive passes **OR** pass-cap (default 3).
- **Commit-guard (hard rule):** regex blocklist `/(save|submit|apply|create|delete|remove|discard|sign ?out|log ?out|\bOK\b|\bYes\b)/i` on labels/aria — never click; mark `reasonIfNot:"commit-guarded"` and continue. Open → observe → Escape/Cancel only.
- **Drill-down rule:** clicking a navigating target records the destination URL, then `page.goBack()` and confirms return (this feature only).

### Stage D — MAP + CRITIC (parallel agents, read-only, no browser)
Fan out one agent per feature/region:
- map each declared element → component `path:line` (source 3 = code);
- flag *declared-but-no-code* and *code-but-not-declared*.
Plus one **critic agent**: reads manifest + dumps, lists untested targets and suspicious absences ("what's missing"). Agents never drive the browser; main thread is the single writer.

### Stage E — REPORT (single writer)
- `tools/out/coverage.json` — every target with `{source, driven, evidence, reasonIfNot}`.
- `coverage.md` — headline `% = driven÷declared`; **residual-gap table**, each row a reason from: `couldn't-locate | commit-guarded | needs-auth | client-only | hidden-needs-toggle | declared-no-code | code-not-declared`.
- **Honesty rule:** residual always printed; "100% covered" only when residual empty across all three sources.

## New tools (under `feature-learner/tools/`)
- `config-capture.js` — body-capturing driver (Stage A) → `out/config/`.
- `build-manifest.js` — config bodies → `manifest.json` (Stage B).
- `reconcile.js` — bounded drive-reconcile loop + crawler interleave + commit-guard (Stage C) → updates manifest with `driven`/evidence.
- `coverage-report.js` — manifest + agent findings → `coverage.json` + `coverage.md` (Stage E).

## SKILL.md changes
- New "## Coverage Oracle" section after the DRIVE depth checklist, describing Stages A-E and the three-source principle.
- Feature Learning Mode report template gains a "## Coverage" section (headline % + residual table).
- Hard rule added: "A feature is not 'mapped' until the Coverage Oracle runs and the residual gap list is recorded."

## Bounds / safety
- Loop bounded (threshold / no-progress / pass-cap) — never runs forever.
- Commit-guard blocklist — never mutates app data; never signs out.
- Read-only everywhere (browser observes; agents read code). No source-repo edits.
- All un-driven items surface in residual with a reason — no silent truncation.

## Open questions (for plan stage)
1. Exact "structural endpoint" match list — start with `fieldSections|Platform/Command|widget|Query|/graphql/`, refine as new apps appear.
2. Manifest `driveHint` per target type — needs a small per-cellViewer hint table (e.g. EditStringCellViewer → hover reveals pencil).
3. Coverage threshold default (95%?) and pass-cap (3?) — confirm.
4. Where coverage artifacts live per run (`out/config/`, `out/coverage.*`) vs report dir — confirm path convention.
5. Generalization beyond Orbitax platform-tool: the three-source principle is app-agnostic, but the structural-endpoint tags are Orbitax-specific; document how to retarget.
