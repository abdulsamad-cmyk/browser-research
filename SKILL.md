---
name: browser-research
description: Use when the user wants to research a target (a web page, an open browser tab, pasted text, a live URL, and/or the local codebase) and capture findings as a structured Markdown report. Reads the browser via the Claude Chrome plugin when available (real logins), falls back to Playwright. Writes a report to docs/reports/ and prints its path.
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

The user may combine sources (e.g. "this Jira ticket + how our code handles it").

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

### 4. Gather local codebase context

When a topic is in play, search the local codebase (Grep / Glob / Read) for files, symbols, or config related to it. Record concrete `path:line` references. Keep it relevant — don't dump unrelated files.

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

### 6. Report back

Print the full path of the written report and a 2–3 line summary. Do **not** take further action — the user decides what happens next.

## Boundaries

- The report is the only deliverable. Do not implement code, open PRs, or invoke other skills unless the user explicitly asks after reading.
- Never enter credentials into Playwright. Auth'd targets go through the Claude Chrome plugin.
- Keep the report grounded in what was actually read. Mark anything inferred as such under Open Questions.
