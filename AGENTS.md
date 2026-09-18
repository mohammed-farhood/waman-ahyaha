<!-- qa-studio-section -->

## Qapture

This project uses **Qapture** — an in-browser QA capture widget that ships
**zero AI** (no model, no API keys, no network calls). **You** are the AI.

### When you receive a `qa-notes-*.zip`

1. **Unzip** the file.
2. **Read `notes.md` top-to-bottom**, starting with everything above the
   `---NOTES---` separator:
   - **Project context** — name, stack, run commands, conventions.
   - **Theme tokens** — colour palette (respect these in any UI changes).
   - **Login Context** — dev/test/seed credentials for the relevant roles.
     _(DEV/TEST/SEED only — never commit, log, or forward these values.)_
   - **Coverage Report** — red/amber/green zone checklist.
   - **Invariants** — rules you must never violate (e.g. "prices ≥ 0",
     "checkout requires auth").
3. **Flag uncovered RED zones** before acting. RED = money / auth / irreversible
   state. If any red zone has no annotation in this ZIP, report it and ask the
   developer whether to proceed.
4. **Act on each `## Point N`** annotation:
   - **Page** + **Selector** + **Note** → locate the element in the source
     (priority: `#id` → `[data-testid]` → `aria-label` → `name` → visual match
     via the `screenshots/point-N.png`).
   - Make the change following the project conventions and invariants.
   - **Verify**: run the app, log in as the relevant role, navigate to the page,
     confirm the fix.
5. **Report** a summary table of changes, risk levels, and coverage status.

### Full protocol

`.claude/skills/qapture/SKILL.md` (always kept current by `qapture init`).

### Rules

- Never read `.env`, `.env.local`, `.env.production`, or any `secrets/` path.
- Never edit `qa.config.ts`, `qa.preamble.md`, or any qapture plugin files.
- Never push/publish/deploy without explicit human approval.
- Dev/test/seed credentials only — never use or request production credentials.

_Qapture — https://github.com/mohammed-farhood/qapture_

<!-- /qa-studio-section -->
