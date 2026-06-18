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
2. **Playwright fallback.** If the plugin is unavailable, or the page is public and headless is fine:
   - Check Playwright is installed. If not, run `npx playwright install chromium` (tell the user this is happening — first run downloads a browser).
   - Drive a Playwright Chromium instance to navigate and read the page.
   - Playwright launches a **separate** browser with **no** existing logins. If the target needs auth, say so and prefer the plugin instead — do not attempt to handle credentials.

Record which mechanism was used; it goes in the report header.

### 3. Read the page

Capture the rendered, human-visible content — headings, body text, tables, key fields. Prefer meaningful text over raw HTML. For long pages, focus on the parts relevant to the topic. Note anything that looks important but unclear under Open Questions.

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
