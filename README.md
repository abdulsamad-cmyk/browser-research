# browser-research

A Claude Code skill that researches a target — a web page, the open browser tab, pasted text, a live URL, and/or the local codebase — and captures the findings as a structured Markdown report.

The report is the deliverable. You read it and decide the next step (implement, research deeper, generate, hand to another skill). The skill does not act beyond producing the report.

## How it reads the browser

1. **Claude Chrome plugin first** — drives your real Chrome with your existing logins, so internal/auth'd tools (Jira, Confluence, dashboards) work with no extra setup.
2. **Playwright fallback** — for public pages or when the plugin isn't available. First run downloads a Chromium browser via `npx playwright install chromium`. This is a separate browser with no logins; auth'd targets should use the plugin.

## Output

Reports are written to `docs/reports/YYYY-MM-DD-<topic>.md` with sections:
Summary · Findings · Codebase Context · Open Questions · Raw Notes.

## Install

Skills load from `~/.claude/skills/`. Symlink or copy this folder there:

```bash
# Windows (PowerShell, as admin for symlink)
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.claude\skills\browser-research" -Target "C:\Workstation\browser-research"

# Or copy
Copy-Item -Recurse "C:\Workstation\browser-research" "$env:USERPROFILE\.claude\skills\browser-research"
```

Restart Claude Code, then invoke with `/browser-research` or by asking to research a target.

## Usage

> "Research this Jira ticket and how our code handles it: <url>"
> "Summarize the open tab into a report."
> "Research the auth flow in the codebase."

The skill asks for the source only if you don't name one.
