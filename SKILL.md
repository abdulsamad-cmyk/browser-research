---
name: browser-research
description: Use when the user wants to research a target (a web page, an open browser tab, pasted text, a live URL, and/or the local codebase) and capture findings as a structured Markdown report. Reads the browser via the Claude Chrome plugin when available (real logins), falls back to Playwright. Also supports Feature Learning Mode — drive a running Orbitax app (e.g. localhost:9000) with Playwright, interact with a feature, capture its network calls, then read the dashboard-webclient frontend and the platform/admin-panel/scheduler API backends to learn the feature end-to-end (UI→frontend→backend). Writes a report to docs/reports/ and prints its path.
---

# Browser Research

Turn a research target into a structured Markdown report. The report is the deliverable — the user reads it and decides the next step (implement, research deeper, generate, or hand to another skill).

## When to use

Invoke when the user asks to research, investigate, or capture findings from:
- A **web page** (rendered content of a site)
- The **open browser tab** they're looking at
- **Pasted text** / instructions they provide inline
- A **live URL** (public or behind their login)
- The **local codebase** (always pulled in as supporting context when a topic is given)
- A **feature in a running app** — drive it live with Playwright, then learn it end-to-end across frontend + backend code (**Feature Learning Mode**, see below)

The user may combine sources (e.g. "this Jira ticket + how our code handles it").

If the user points the skill at a running app (e.g. `localhost:9000`) and names a page/feature to **understand / learn / how it works**, use **Feature Learning Mode** below instead of a one-shot read or UI inventory.

## Inputs

The user gives a **target** and optionally a **topic**. If the target is missing or ambiguous, ask one question:

> "What's the source — a URL, the tab you have open, text you'll paste, or just the codebase?"

Do not ask more than necessary. If they already named the source, proceed.

## Procedure

Create a todo per step and work them in order.

### 1. Resolve the source

| Target | Action |
|--------|--------|
| Open tab | Read the current tab via the browser mechanism (step 2) |
| URL | Navigate to it, wait for render, read content |
| Pasted text | Use the text directly; no browser needed |
| Codebase only | Skip browser; go to step 4 |

### 2. Pick the browser mechanism (only if a page must be read)

1. **Claude Chrome plugin first.** If the Claude browser extension is connected, use it — it drives the user's real Chrome with their existing logins, so internal/auth'd tools (Jira, Confluence, dashboards) work with no extra setup. This is the default whenever a logged-in or internal page is involved.
2. **Playwright fallback.** If the plugin is unavailable (e.g. running from the CLI, where the Chrome extension's tools are not exposed):
   - Install `playwright-core` (`npm i playwright-core`). For an **already-running, logged-in** target, **connect over CDP** instead of launching a fresh browser — this reuses the user's session. Only `npx playwright install chromium` if you must launch a clean browser for a public page.
   - **Reuse the user's login via CDP:** launch an isolated Chrome with a debug port and its own profile (does not disturb the user's main Chrome), have the user log in there once, then connect:
     ```
     # launch (own profile dir avoids clashing with the user's normal Chrome):
     chrome.exe --remote-debugging-port=9222 --user-data-dir=<scratch-profile> <url>
     # connect from the script:
     chromium.connectOverCDP('http://localhost:9222')
     ```
   - Gotcha: if the user's normal Chrome is already running, a plain launch attaches to it and the debug port never binds — always use a separate `--user-data-dir`.
   - Never enter credentials yourself; the user logs in to the debug window.

Record which mechanism was used; it goes in the report header.

### 3. Read the page

Capture the rendered, human-visible content — headings, body text, tables, key fields. Prefer meaningful text over raw HTML. For long pages, focus on the parts relevant to the topic. Note anything that looks important but unclear under Open Questions.

When the user wants an **exhaustive UI inventory** of an interactive page (click everything, list every dropdown item, explore every modal, confirm nothing was missed), follow the dedicated pipeline below instead of a one-shot read.

## Exhaustive UI Inventory (interactive pages)

Use this when the goal is to capture *everything* on a single page — every element, every dropdown's items, every modal's contents — and to *prove* nothing was missed.

### Hard rules

- **No assumptions — mandatory.** The report contains **only** what was actually observed or captured. Never write inferred behaviour, conventional defaults (e.g. "the logo links home"), or expected-but-unseen items as fact. If something was not verified, it goes under **Open Questions** as unverified — it does **not** appear as a finding. Every claim must trace to captured output in `tools/out/`.
- **This page only.** Stay on the target route. Do **not** explore other pages.
  - Nav/links to other routes: **read the `href`** to record where they point — no click.
  - Router-only links (no `href`): click → record resulting URL → **browser back** (`page.goBack()`) → confirm you returned.
  - **A caret icon (`fa-angle-down` / `fa-caret-*` / `fa-chevron-down`) means a dropdown, not a link** — open it and list its items; never navigate.
  - If a click accidentally navigates away, use the **back button** to return, then continue.
- **Never** click destructive or data-committing actions: logout/sign out, delete, remove, discard, and confirm/commit buttons (Save, Submit, Apply, Create, OK, Yes). Record that they exist; do not click them. Open menus/modals, then cancel/Escape out.
- **Capture icon identity.** For every icon, record its class list (e.g. `fa-regular fa-ellipsis`) and the computed `font-family` of `::before` (tells the Font Awesome version, e.g. "Font Awesome 7 Pro"). Icon class is how you identify icon-only buttons and detect carets.

### Pipeline

```
1. CRAWL (initial)   — enumerate + click every interactive element; capture dropdowns,
                       menus, modals; record DOM effect of each click; recover between
                       clicks (Escape; goBack if navigated). Dump raw output to tools/out/
                       (page-text.txt, elements.json, icons.json, crawl.json, ...).
2. SCOUT (fresh)     — a fresh agent reads the DUMP only (not the live page) and returns
                       a checklist: regions + every interaction that should be covered, and
                       suspected gaps (e.g. "row has fa-ellipsis -> per-row menu not captured").
3. CRAWL (targeted)  — cover the scout's gap list. Write the draft report to docs/reports/.
4. VERIFY (4 fresh)  — four fresh agents, each owning a region (e.g. nav+toolbar /
                       table+filters+row-actions / side panels / modals+dropdowns).
                       Each checks the report against the dump/live page and writes ONLY its
                       own tools/out/findings-N.md. Agents NEVER write the report.
5. MERGE             — the orchestrator (main thread, the SINGLE writer) dedupes all four
                       findings and merges them into the report in one write. No concurrent
                       writes -> no overwrite race.
```

- **Why fresh agents:** independent eyes catch what the mechanical crawler can't infer (a caret = dropdown, an ellipsis = row menu, a filter icon has contents).
- **Single-writer rule:** only the orchestrator writes `report.md`. Agents return findings or write `findings-N`. This is the fix for concurrent-overwrite.
- **Browser concurrency:** the four verifiers work from the dump (cheap, no collision). Only one process drives the CDP browser at a time.

Reusable scripts live in `tools/` (`crawl.js`, `icons.js`, `nav.js`, `menus.js`, `discover.js`); raw output goes to `tools/out/` (gitignored — may contain captured internal data).

## Feature Learning Mode (running app + frontend + backend)

Goal: **learn a feature end-to-end** — watch it run live, then trace it through the code:
live UI → frontend implementation → backend API. The report explains how the feature
actually works, grounded in observed network calls and real `path:line` references.

### Repos (Orbitax)

| Layer | Repo | Stack |
|---|---|---|
| Frontend | `C:\Workstation\orbitax-dashboard-webclient_fork` | Angular |
| Backend | `C:\Workstation\orbitax-platform-api_fork` | C# / .NET |
| Backend | `C:\Workstation\orbitax-admin-panel-api_fork` | C# / .NET |
| Backend | `C:\Workstation\orbitax-scheduler-api_fork` | C# / .NET |

All read-only — observe and learn, never edit. The running app defaults to `http://localhost:9000`
(confirm the URL with the user if different).

## API Repo Scope

`C:\Workstation\orbitax-internal-api_fork` — READ-ONLY. When a component is server-driven (banner, promo, config-driven content) and does not appear in the live DOM during capture:

1. Search the API repo for the relevant model/endpoint (search by component name, e.g. "LibraryBanner", "banner", "FilingManager")
2. Note the data shape (field names, types)
3. Create a fixture in `projects/itp/app/webclient/data/` with realistic sample data
4. Build the component using the fixture

Common patterns:
- `fieldValues['BannerList']` — server-pushed content blocks
- `FormsLibraryBannerQuery` — FM library banner
- Any `Query` suffix type in the API = data fetched on page load

### Hard rules

- **Playwright only** (not the Chrome plugin) for the running app. Connect over CDP to a
  Chrome the user logged into, or launch with a scratch `--user-data-dir` if a fresh login
  is acceptable. Never enter credentials yourself.
- **Interact, never commit.** Click/open/fill to trigger the feature and watch it run, but
  **never** click destructive or data-committing actions (Save, Submit, Apply, Create, Delete,
  logout, OK/Yes on confirms). Open → observe → Escape/Cancel out.
- **Network capture is the spine.** Every claim about the backend traces to a captured request
  (method + URL + status) or a real `path:line` — never an assumption. Unverified → Open Questions.
- **This feature only.** Don't wander to unrelated routes.
- **SPA navigation, not URL reload.** Many apps (e.g. Orbitax ITP) gate every full page load behind a
  splash/entry screen ("Continue to Orbitax") — `page.goto(<route>)` reloads the SPA and **re-triggers
  the splash**, losing your session. Drive the splash ONCE, then navigate **in-app** (click nav/tabs/
  launcher), never by `goto`. Capture state via DOM + network, not URL changes.
- **Clear blocking overlays first.** A welcome dialog / `cdk-overlay-backdrop` / cookie banner will
  intercept clicks ("element intercepts pointer events"). Dismiss it (Escape, "Done", "Don't Show Again")
  before interacting — then note it as a captured feature.
- **Static snapshots are not enough — drive the DEPTH checklist below** before declaring a screen mapped.
- **Everything must be reusable.** Every component, cell renderer, and UI element built in
  `projects/itp/app/webclient` must be reusable across screens — never page-specific. If it
  can't be reused, it's inline markup, not a component. Check `projects/itp/skills/` first;
  write the skill if missing; then build the component.
- **A feature is not "mapped" until the Coverage Oracle runs** (capture→manifest→reconcile→report) and the
  residual gap list is recorded. Never claim "captured everything" without a `coverage.md`. The server config
  is the denominator — hidden columns/tabs/widgets the DOM never renders are real gaps and must surface.

### Pipeline

```
1. DRIVE (Playwright)  — page.goto(localhost:9000), navigate to the feature, interact
                          (click/fill, no submit). Attach page.on('request'/'response') and
                          dump every XHR/fetch to tools/out/network.json (method, url, status,
                          payload shape). Capture the rendered UI + key elements to page-text.txt.
2. MAP UI→FRONTEND     — for each captured endpoint, grep the FRONTEND repo for the URL/path to
                          find the Angular service that calls it, then the component(s) that use
                          that service. Record component → service → HTTP call chain (path:line).
3. MAP FRONTEND→BACKEND— for each endpoint, grep the BACKEND repos (platform / admin-panel /
                          scheduler) for the matching route/controller. Trace controller →
                          handler/service → model. Record the backend chain (path:line).
4. SYNTHESIZE          — assemble the end-to-end flow: user action → component → frontend service
                          → HTTP endpoint → backend controller → handler → data. Explain what the
                          feature does and how, grounded in the above.
```

For a large/interactive feature, dispatch parallel read-only agents (one per backend repo, one
for the frontend) to map endpoints concurrently; the main thread is the single writer of the report.

### DRIVE depth checklist (run per screen — a static snapshot misses most of the UI)

A one-shot DOM snapshot captures only what is statically rendered and visible. Real apps hide
behaviour behind scroll, hover, and clicks. For each screen, drive these and capture results:

1. **Scroll virtualized grids BOTH axes.** Find the scroll container (e.g. Kendo `.k-grid-content`,
   `.k-virtual-content`; AG/Wijmo equivalents). Set `scrollLeft = scrollWidth` in steps to reveal
   **hidden right-edge columns / action cells**; set `scrollTop` down in steps to **materialise all
   virtual rows** (collect the real row count + ids — the pager "of N" often ≠ actual count).
2. **Hover to reveal.** Hover-only controls (info / edit / kebab icons, row-action buttons) are NOT
   in the static DOM. Hover each row + each interactive-looking cell; re-query the cell for newly
   appeared `button`/`a`/`i[class*=fa-]`. Lock cell→column indices by dumping a row's `td` texts first
   (a leading checkbox/index column shifts indices).
3. **Capture tooltips.** Steady-hover an info/`title` element ~1.5s; read `.mat-mdc-tooltip` /
   `[role="tooltip"]` / `.k-tooltip` text (or the element's `title`/`aria-label`).
4. **Open every dropdown / menu / dialog**, capture its contents, then Escape. Cover: header dropdowns
   (project/period selector, avatar/user menu, app-launcher), per-row Actions/kebab menus, column
   filter menus, column chooser ("Fields"), status/info → guide modals. Never click Save/Submit/Delete/
   sign-out — open → record → Escape/Cancel.
5. **Drill-down + back.** Click a row / cell / link that navigates; **record the destination URL**
   (often a magic-link detail route), then `page.goBack()` and confirm you returned. Capture where
   things lead without committing.
6. **Record icon identity** (full class list + `::before` font-family) for every icon — it identifies
   icon-only buttons and reveals the FA version.

Dump each interaction's result to `tools/out/<region>/` (e.g. `interactions.json`, screenshots).
Anything you did NOT drive → list under "Open Questions / interaction gaps", never assert it.

### Coverage Oracle (prove coverage, find gaps automatically)

A static snapshot cannot prove completeness, and the eye misses hidden config (e.g. a grid that
renders 10 columns while the server declares 17). The oracle finds gaps WITHOUT a human walking the app.
Three sources of truth: **server config (denominator)**, **DOM crawler**, **code grep**. A gap = anything
in any source not driven/captured. Run these scripts (from `tools/`, Chrome on CDP :9222):

1. **Capture** — `node tools/capture-cdp.js` (preferred) OR `node tools/config-capture.js ["<SubTab>"]`
   enters the tool via the app launcher, then saves XHR/fetch response **bodies** to `out/config/`.
   Structural bodies: `FilingManagerApi` fieldSections, `Platform/Command`, `DynamicGridData`, `/api/Query`.
   - **Use `capture-cdp.js` for Chrome ≥ 149** — it uses `chrome-remote-interface` (Runtime domain only)
     with a client-side XHR/fetch interceptor. Never `playwright-core` or `puppeteer-core` — both call
     `Network.enable` on connect, which times out on Chrome 149.
   - **Capture sequence (FM):** splash dismiss → launcher click → "Filing Manager" → Library tab →
     My Forms tab → More dropdown → Transmissions button. All clicks use
     `dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,view:window}))` — NOT `.click()`.
   - **Never `page.goto(route)`** for FM captures — fresh Angular boot has empty NgRx store, so the FM
     grid never mounts and fieldSections never fires. Navigate in-app only.
   - **Never click external links** as "navigate away" — filter to `localhost:9000` hrefs only.
   - **FM tab selectors:** `a.menu-item-dropdown` with text matching the tab. NOT `a[title="Library"]`.
     Transmissions is under the **More** dropdown (`button.mat-mdc-menu-item` text "Transmissions").
   - **Splash dismiss:** `dispatchEvent(MouseEvent)` on "Continue to Orbitax" button ONLY after guided
     tour is dismissed ("Finish" button, also via dispatchEvent). Do NOT click "Finish" from puppeteer's
     page.click() — it is not interactable from puppeteer.
   - **Captured files** must be named `fieldSections-*.json` for `build-manifest.js` to find them. If
     captured with a different prefix (e.g. `fm-fieldSections-*.json`), rename before running manifest.
   - **FM sourceTypes** (Orbitax ITP): Library = `FM-Library`, My Forms = `FM-FilingForms`,
     Transmissions = `FilingManager-Transmission`.
2. **Manifest** — `node tools/build-manifest.js ["<SourceType>"]` flattens config into coverage targets
   (`out/manifest.json`): tabs, columns (+cellViewer/canFilter/hasDetails), filters, toolbar items,
   widgets. Pass the tool's `sourceType` to scope to ONE screen — a cold load fires many tools'
   fieldSections, so scoping is required for a per-feature manifest.
3. **Reconcile** — `node tools/reconcile.js` drives each undriven target (bounded: ≤3 passes, stop at
   95% or no-progress), interleaves a DOM crawler (adds client-only controls), and applies the
   commit-guard (never Save/Submit/Apply/Create/Delete/Sign out). Writes driven/evidence/reason back
   to the manifest.
   - **Config-only shortcut:** if all declared targets are columns with `cellViewer` or filters
     (no tabs/widgets), run `node tools/reconcile-config-only.js` instead — credits everything from
     config definition alone, no browser required. Safe when the feature has no tab/widget targets.
4. **Map + critic (parallel read-only agents, no browser)** — one agent per feature maps each declared
   element to a component `path:line` (source 3 = code) and flags declared-but-no-code /
   code-but-not-declared; one critic agent answers "what's missing?". Agents write `out/findings-*.md`.
   The browser stays serial; agents never drive it. Run `node tools/stage-d.js` to generate
   ready-to-paste agent prompts in `out/agent-prompts/`. Dispatch each printed agent; collect their
   `findings-*.md` outputs; `coverage-report.js` folds them in automatically.
5. **Report** — `node tools/coverage-report.js` emits `out/coverage.json` + `out/coverage.md`
   (headline % = driven÷declared, residual gap table with a reason per row).

### Stage F — Auto-seed dual-verify (runs automatically after Stage E)

After `coverage-report.js` writes `coverage.md`, if the residual list is non-empty, Stage F runs automatically — no user prompt needed.

1. Run `node tools/stage-f-seed.js` — reads `coverage.json` residual gaps and writes a dual-verify seed prompt to `out/dual-verify-seed.md`.
2. Invoke `/dual-verify-orchestrator` with `out/dual-verify-seed.md` as the seed. **Mode 2 — autonomous. No questions. Decide from evidence.**
3. The orchestrator's A↔B loop answers each gap from the webclient source, updates `CONTEXT.md`, resolves CONFLICTs only if genuine.
4. Output: `out/coverage-enriched.md` (gaps resolved + code evidence + domain context).
5. **Carry on — no user gate.** `coverage-enriched.md` is the audit trail; the pipeline continues.
   - **Residual non-empty:** dual-verify's A↔B loop and plan-executor have already been invoked
     (steps 2–3 above). `plan-executor` + `execution-verifier` run to completion (max 3 passes).
     **STOP only on:** CONFLICT (two verified sources disagree, no code resolution) OR
     `audit-report.md` = COMPLETE (all tasks Done).
   - **Residual empty (100% coverage):** log
     `"Coverage complete — no residual gaps. No dual-verify seed needed."` and halt cleanly.
     Do not invoke dual-verify with an empty seed.

**What Stage F never does:** asks which approach to take, asks permission to run, asks "shall I start now or later?" — those are Mode 2 violations. Decide from evidence; log the decision; proceed.

---

## Shell / Header Architecture (ITP Next.js webclient)

- `Shell.tsx` no longer accepts `sidebarContent` prop — replaced by `detailsContent` + 4-panel system
- `SidebarPanel = "details" | "activity" | "alerts" | "chat" | null`
- `activePanel` state lives in `Shell.tsx`, starts `null` (sidebar closed)
- Clicking a header icon button sets `activePanel` to that panel's key; clicking the same button again sets it to `null` (closes sidebar)
- Sidebar title text changes to match the active panel name

### Side panel components

| Component file | Notes |
|---|---|
| `ActivityPanel/ActivityPanel.tsx` | "Edit History" \| "Data Tracing" tabs; empty state when no data |
| `ChatPanel/ChatPanel.tsx` | Empty state: "No active conversations." |
| `AlertsPanel/AlertsPanelInline.tsx` | Same data as AlertsPanel portal but rendered inline (no portal, no backdrop) |
| `AppLauncher/AppLauncher.tsx` | Full-width popup, 2-panel: Platform Tools left + 3-tab main apps right |
| `AppLauncher/apps.ts` | Data module: `PLATFORM_CATEGORIES`, `PLATFORM_SETTINGS`, `APP_LIST` (3 categories) |

### Real app panel sources (from webclient capture)

| Panel | Angular component | Notes |
|---|---|---|
| Details | FMGuide content | Falls back to "No details available" when no row selected |
| Activity | `ActivityFeedComponent` | "Edit History" + "Data Tracing" tabs |
| Alerts | `NotificationSideBarComponent` | Notification list |
| Chat | `ConversationListComponent` | Empty state when no conversations |

---

## CDP Technique Learnings

- `document.querySelector('button[aria-label="X"]')` fails inside Node template literals due to quote escaping — use array find instead:
  ```js
  [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label)
  ```
- `Input.dispatchMouseEvent` requires `window.focus()` first to register React synthetic click events
- CDP tool call is `Input.dispatchMouseEvent` — `Input.enable()` does **not** exist in `chrome-remote-interface` (calling it throws)

---

**Gotchas learned (Orbitax platform-tool):**
- Enter FM via in-app launcher navigation — never `page.goto()` or `Page.navigate()` (resets Angular NgRx store → FM grid never mounts, magic-link hash routes become invalid).
- **Magic-link detail routes** (`/transmissions/[hash]`, `/my-forms/[hash]`) are session-scoped tokens — they CANNOT be navigated to via URL. Must click the link from within the live grid (in-app navigation only). The capture script must: launcher → tool → grid → click row link.
- `fieldSections` fires only on FM module's FIRST load in a session — warm re-visits use cached columns.
- Attach the network interceptor BEFORE any navigation.
- The grid's full column set is in `fieldSections`, NOT the rendered DOM — hidden columns surface only via the config diff.
- `playwright-core` and `puppeteer-core` both fail with Chrome ≥ 149 (`Network.enable` times out). Use `chrome-remote-interface` (Runtime only) + client-side XHR/fetch interceptor.
- All interactive clicks in the Angular app require `dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true,view:window}))` — `.click()` or puppeteer's `page.click()` may not propagate through Angular.
- External links in the app DOM will navigate the tab away and break the session. Filter `querySelectorAll('a')` to `href.includes('localhost:9000')` for in-app navigation.
- Guided tour ("Next/Finish" buttons) intercepts "Continue to Orbitax" — click Finish via dispatchEvent FIRST, then Continue.
- The `hasUserConfirmedOnBoarding` sessionStorage key controls the splash. Angular overrides it during init — pre-setting it via `evaluateOnNewDocument` is unreliable.

**FM navigation sequence (working):**
```
1. Connect to CDP (chrome-remote-interface, Runtime only)
2. Install XHR/fetch interceptor via Runtime.evaluate
3. Check for splash ("Continue to Orbitax") → dispatchEvent click Finish, then Continue
4. Wait for FM nav: button[aria-label] present
5. Launcher → dispatchEvent click launcher button → wait 2s
6. Click "Filing Manager" text → wait 5-8s (FM module cold loads)
7. Dismiss welcome dialog (Done / Don't Show Again)
8. Click target tab (a.menu-item-dropdown text match) → wait 8s
   - Library, My Forms: direct a.menu-item-dropdown click
   - Transmissions: click "More" first, then button text "Transmissions"
9. For detail pages: click row link (td a or td button matching RPT-/Form-) → wait 8s
10. Read DOM via Runtime.evaluate
```

**Next.js rebuild pipeline (per screen):**
```
feature-learner (capture + Coverage Oracle) 
  → data/[screen].json fixture 
  → app/filing-manager/[screen]/page.tsx 
  → imports Shell + Breadcrumb + DataGrid + cell renderers
  → TypeScript check (npx tsc --noEmit)
  → git commit
```

**Reusable cell renderers built (ITP webclient):**
| cellViewer | Component | File |
|---|---|---|
| CountryWithFlagCellViewerComponent | CountryCell | cells/CountryCell.tsx |
| HyperlinkCellViewerComponent + HyperlinkWithActionIconsCellViewerComponent | HyperlinkCell | cells/HyperlinkCell.tsx |
| TransmissionStatusCellViewerComponent | StatusCell | cells/StatusCell.tsx |
| FormPublicationStatusCellViewerComponent | PubStatusCell | cells/PubStatusCell.tsx |
| ActionsCellViewer | ActionsCell | cells/ActionsCell.tsx |
| EntityCellViewer | EntityCell | cells/EntityCell.tsx |
| LocalDateCellViewerComponent | LocalDateCell | cells/LocalDateCell.tsx |
| EditStringCellViewerComponent | EditStringCell | cells/EditStringCell.tsx |
| FilingManagerWorkflowCellViewerComponent | WorkflowCell | cells/WorkflowCell.tsx |
| StringCellViewer / StringCellViewerComponent | (plain text — no component) | inline in DataGrid |

**Visual Fidelity Rules (ITP FM rebuild — from 2026-06-22 gap analysis):**

When building any ITP FM screen, these must match the real app exactly:

| Element | Correct value | Common mistake |
|---|---|---|
| Active nav tab | `color: var(--standard-0)` + class `itp-nav-tabs__item--active` via `usePathname()` | No active class → all tabs same color |
| Alerts panel notification dot | Colored 8px circle left of title: amber=#FF8B00 (analytics), green=#00C237 (workflow), blue=#0065FF (scenario) | Missing dot |
| Alerts panel action | Outlined pill button `border: 1px solid var(--standard-1000); border-radius: 100px` | Plain text link |
| Alerts panel date | On its own line above the action button | Inline with action |
| Avatar menu items | No FA icons on items. "Switch company" = subtitle under name. Only Sign out has icon. | Adding icons to all items |
| Project selector folder | `fa-regular fa-folder` before each recent project name | No icon |
| Project selector View All | In section header right-aligned | At bottom with divider |
| Project selector Edit icon | `fa-regular fa-gear` | `fa-regular fa-pen` |

**Visual gap analysis pipeline:**
1. Run `capture-cdp.js` or `visual-diff.js` to screenshot rebuild + real app at same viewport (1440×900)
2. Read screenshots with Claude image Read tool
3. Produce `docs/reports/YYYY-MM-DD-visual-gap-report.md` — structured table with region/real/rebuild/gap/fix
4. Apply fixes to CSS/component files
5. Re-screenshot to verify
6. Update both skills with new visual rules found

**Coverage semantics (important):** a column is COVERED when its config definition (`cellViewer`, type,
options) is captured — rendering it is NOT required to rebuild it. `reconcile` credits column→has-cellViewer,
filter→column-canFilter, widget→declared-in-config; `renderObserved` separately flags whether the live
cell was seen (interaction depth). The command-body `tabs` field holds component identifiers, not the
sub-nav — do not treat it as tab targets; nav is captured by the DOM crawler. The commit-guard applies
ONLY to clickable action targets (never column/filter labels — else "Created Date" trips on "create").

**Reliability + sanity guard:** capturing a specific tool's `fieldSections` needs a COLD load; a warm
re-visited sub-tab won't re-fetch, and a cold-booted Chrome can race the splash→launcher nav and miss it.
`build-manifest` emits ⚠️ WARNING + 0 columns when a grid screen's `fieldSections` wasn't captured, so a
missed capture reports 0% (not a hollow 100%) — re-run config-capture until columns are present before
trusting coverage. Prefer a warm, past-splash session; harden nav with a retry-until-columns loop.

### 4. Gather local codebase context

When a topic is in play, search the local codebase (Grep / Glob / Read) for files, symbols, or config related to it. Record concrete `path:line` references. Keep it relevant — don't dump unrelated files.

(In Feature Learning Mode this step is covered by pipeline stages 2–3 above.)

---

## Depth-2 Audit Protocol (NEW — 2026-06-23)

After any ITP solution is built, run a Depth-2 Audit before marking it done. Drives both apps simultaneously:
- Real app `localhost:9000` (Angular — ground truth)
- Rebuild `localhost:3200` (Next.js — what was built)

### 8 Audit Dimensions (run for EVERY screen)

| # | Dimension | Capture method |
|---|---|---|
| 1 | **Grid row drill-down** | Click **3 rows** per grid screen. Detect per row: ROUTE_CHANGE / DRAWER / MODAL / GRID_ONLY |
| 2 | **Dropdown drill-down** | Open every dropdown, mat-menu, BreadcrumbActionsMenu, More nav. List all items. Do NOT click destructive (Delete/Remove/Discard/Sign Out) |
| 3 | **Button drill-down** | Every bc-right button + content button. Click → route / modal / action / nothing per button |
| 4 | **Tab drill-down** | Every tab strip, sub-tabs, SegmentedControl. Click each tab → record content loaded |
| 5 | **Sidebar functional** | Click each header icon: Details / Activity / Alerts / Chat / XatBot. Does panel open? Content correct? |
| 6 | **Library visual+functional** | Screenshot real vs rebuild. Column diff. Image/card clicks → landing route. Welcome dialog present? Filters filter the grid? |
| 7 | **Interactive elements** | Form-group chips, nav tiles, segmented controls → filter applied / route navigated / no-op |
| 8 | **Breadcrumb verification** | bc-left items (icon + links + current page label) + bc-right controls. Compare real vs rebuild. Flag ANY mismatch. |

### CDP patterns for audit

```js
// keepAlive — MUST start BEFORE splash dismissal, runs every 3s
const keepAlive = setInterval(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Stay'));
  if (btn) btn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
}, 3000);

// Click row N in a grid
const rows = document.querySelectorAll('table tbody tr, [role="row"]:not([role="columnheader"])');
rows[N].dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));

// Detect what happened after row click
JSON.stringify({
  url: window.location.href,
  hasDrawer: !!document.querySelector('.mat-drawer-opened,[class*="drawer"][class*="open"]'),
  hasModal: !!document.querySelector('.mat-dialog-container,[role="dialog"]')
});

// Back navigation — ALWAYS use breadcrumb link, NEVER browser.back() or Page.navigate()
const bc = document.querySelector('[class*="breadcrumb"] a[href*="<solution-route>"]');
bc.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
```

### Gap report format

```markdown
| Screen | Dimension | Element | Real App | Rebuild | Gap | Priority |
|---|---|---|---|---|---|---|
| Global Filing | D1 Grid row | Row 0 click | Drawer opened | No handler | MISSING | HIGH |
| Library | D6 Visual | Columns | [list] | [different list] | Mismatch | HIGH |
| All | D8 Breadcrumb | Parent link | /due-date-tracker | /due-date-tracker/global | Wrong href | HIGH |
```

Priorities: **HIGH** = missing entirely | **MEDIUM** = present but wrong | **PASS** = matches real app | **SKIP** = intentional stub.

### Verified DDT audit learnings (2026-06-23)

- **Breadcrumb parent link bug:** All DDT sub-pages incorrectly linked "Due Date Tracker" to `/due-date-tracker/global` instead of `/due-date-tracker`. Always verify parent `href` in breadcrumb — it must go to the solution dashboard, not another sub-page.
- **Library page minimum:** Every solution Library page needs: LibraryBanner + SegmentedControl in bc-right + form-group filter chips (wired) + welcome dialog (localStorage) + solution-specific fixture + solution-labeled action button.
- **Sidebar stubs:** Plain `<p>` text in `detailsContent` = stub. Real sidebar needs a 4-step guide component with numbered badges.
- **Grid rows — 1 is not enough:** Research seeds that only click 1 row miss variation (row 2/3 may trigger different behavior). Always click 3.
- **CRI install:** `chrome-remote-interface` must be installed in `tools/` before audit scripts can run: `cd tools && npm install chrome-remote-interface`
- **Node REPL vs script:** Run audit scripts with `node path/to/script.js` from command line — NOT from inside `node` REPL.

### 5. Write the report

Write to `docs/reports/YYYY-MM-DD-<topic>.md` (slugify the topic; create the directory if missing). Use this structure:

```markdown
# Research: <topic>

- **Date:** YYYY-MM-DD
- **Source(s):** <url / "open tab" / "pasted text" / "codebase">
- **Browser:** <Claude Chrome plugin | Playwright | none>

## Summary

3–5 lines: what was researched and the headline findings.

## Findings

What the source/browser revealed. Bullet points, quotes, tables as fits.

## Codebase Context

Relevant local files with `path:line` references and one-line notes. Omit the section if no codebase context applies.

## Open Questions

Things unclear or unverified — what a follow-up would need to resolve.

## Raw Notes

Optional. Longer extracts or dumps kept for reference.
```

**Feature Learning Mode** uses this structure instead (`docs/reports/YYYY-MM-DD-<feature>.md`):

```markdown
# Feature: <feature name>

- **Date:** YYYY-MM-DD
- **App:** http://localhost:9000  (route: <route>)
- **Browser:** Playwright (CDP)
- **Repos:** dashboard-webclient (FE) · platform-api / admin-panel-api / scheduler-api (BE)

## Feature
What the feature does, in plain terms — the user-facing capability.

## UI (live)
What was observed driving it with Playwright — elements, states, interactions tried.

## Interactions (driven)
Results of the DRIVE depth checklist: grid scroll (hidden columns? real row count vs pager), hover-revealed
icons + tooltip text, every dropdown/menu/modal opened and its contents, drill-down clicks and their
destination URLs (+ that browser-back returns). One row per interaction. List anything NOT driven as a gap.

## Coverage
Headline coverage % (driven ÷ declared) from `coverage.md`, plus the residual gap table (each gap with a
reason: couldnt-locate / commit-guarded / hidden-needs-toggle / needs-auth / client-only / declared-no-code).
A feature is NOT "mapped" until the Coverage Oracle has run and this residual list is recorded.

## Network calls (captured)
| Method | Endpoint | Status | Triggered by |
|--------|----------|--------|--------------|
Each row from tools/out/network.json.

## Frontend impl
component → service → HTTP call, with `path:line` in dashboard-webclient.

## Backend impl
endpoint → controller → handler/service → model, with `path:line` per backend repo.

## End-to-end flow
User action → component → FE service → endpoint → BE controller → handler → data. Numbered steps.

## Open Questions
Anything not verified against a captured call or a real `path:line`.
```

### 6. Report back

Print the full path of the written report and a 2–3 line summary. Do **not** take further action — the user decides what happens next.

## Skill Blind Spots

These gaps are NOT caught by text/DOM capture — require additional investigation:

1. **Interactive states** — Kendo dropdowns, hover menus, click-triggered overlays only appear after interaction. Static DOM capture misses them. Fix: add explicit interaction steps (click column header, wait 500ms, capture state).

2. **CSS visual style vs data** — Skill captures data correctly but not HOW it renders. Tab-style vs pill chips look the same in text but completely different visually. Fix: always screenshot-compare the specific region, not just full-page.

3. **Server-driven optional components** — Banners, promotional content, data-driven sections only appear when the API returns data. Fix: read `orbitax-internal-api_fork` to find the data shape and endpoint, then create a fixture in `data/`.

## Mandatory Capture Protocol

Every DRIVE phase (Phase 1) MUST follow this protocol. Ad-hoc `sleep(N)` patterns are BANNED — use the helpers below.

### Setup (always first)
```js
const { CaptureSession } = require('./capture-session');
const session = new CaptureSession();
await session.connect(9222, 'localhost:9000');
session.startKeepAlive();        // ← MUST be first, before any navigation
await session.dismissSplash();   // waits up to 60s for enabled button
await session.dismissTour();     // clears guided tour (up to 10 steps)
```

### Per-screen capture loop
```js
// 1. Navigate (in-app click or Page.navigate if not an SPA route)
await session.clickNavByText('Global Filing');

// 2. Wait for stable DOM (replaces sleep)
await session.pollForStable('Global Filing', 12000);

// 3. Screenshot
await session.screenshot('gmt-global', 'real');

// 4. Auto zone inventory
const zones = await session.autoZoneInventory();
// zones = { 'bc-left', 'bc-right', 'content-header', 'content-body-top', 'sidebar' }

// 5. Write zone inventory to ledger
```

### Cleanup (always last)
```js
session.stopKeepAlive();
await session.close();
```

### Navigation hierarchy
1. App launcher tile click (first entry into a solution app)
2. `session.clickNavByText(label)` for visible nav items
3. More dropdown: click More → `clickNavByText(itemLabel)` after dropdown opens
4. NEVER use `Page.navigate()` for in-session SPA navigation — resets Angular NgRx store

### Zone inventory format (per layout-matrix.md)
Each captured screen MUST record:
| Zone | Contents |
|---|---|
| bc-left | (from `autoZoneInventory()`) |
| bc-right | (from `autoZoneInventory()`) |
| content-header | (from `autoZoneInventory()`) |
| content-body-top | (from `autoZoneInventory()`) |
| sidebar | (from `autoZoneInventory()`) |

### Maps — systematic 3-step source walk
For each screen (run in parallel agents, no browser needed):
1. Read `<solution>.routes.ts` → find path → identify component class
2. If `PlatformLinkCreatorComponent`: grep for `sourceType` near the command class → trace to `fieldSections` query → find API base config key
3. If direct component: read `.component.ts` → find `@Injectable` services → find `http.get/post` calls → record `path:line`

4. **Licensed component internals** — Kendo UI, Angular Material components generate complex DOM. The skill sees the outer container but not the full rendered behavior. Fix: read the Angular source for the component template + CSS to understand what it renders.

## Boundaries

- The report is the only deliverable. Do not implement code, open PRs, or invoke other skills unless the user explicitly asks after reading.
- Never enter credentials yourself. For a logged-in target, the user logs into the Chrome plugin (general research) or into a CDP-attached Chrome that Playwright then connects to (Feature Learning Mode) — you never type the password.
- All Orbitax repos (frontend + the three APIs) are **read-only** — observe and learn, never edit.
- Keep the report grounded in what was actually read or captured. Mark anything inferred as such under Open Questions; in Feature Learning Mode every backend claim must trace to a captured network call or a real `path:line`.
