---
name: ship
description: Ship one blanckstar roadmap issue end-to-end — plan, implement code+tests, self-review, open a PR — and stop at the human merge gate. Invoke as `/ship <issue-number>` (e.g. /ship 12).
---

# /ship — drive one roadmap issue through the full cycle

You were invoked as `/ship <issue-number>`. The **issue number is the argument you were given** — call it `<ISSUE>` below. This runs the per-issue cycle for the **blanckstar** repo; if the current working directory isn't that repo, stop and say so.

Follow `CLAUDE.md` throughout (hard rules 1–5 + the Working-discipline section). Proceed autonomously on the routine path; **stop and ask only at the points marked 🛑**.

> Sandbox note: `grep` in Bash is intercepted here — use `rg PATTERN > "$TMPDIR/out" && Read`, never pipe to `grep`. Capture long command output to a file and Read it (e.g. `npm test > "$TMPDIR/test.log" 2>&1`).

> Parallel / worktree note: this skill assumes it **owns its working directory**. To run several `/ship`s at once, launch each session with `claude --worktree <name>` so they don't collide on git state or files — **never run two `/ship`s in the same dir**. Only parallelize dependency-independent issues; never run an issue against an unmerged dependency.

> Subagent note: any `Agent` call this skill makes — for planning, review, or analysis — is **read-only** by default, and inherits this entire file plus CLAUDE.md just by being spawned mid-run. Inheriting these steps is not the same as being told to execute them. State the boundary explicitly in the subagent's prompt (no Edit/Write, no git/gh mutating commands, no TaskCreate/TaskUpdate, no memory writes — return only the requested output), and prefer a fresh non-fork agent over `fork` for this kind of fan-out. **Steps 5–7 — reconcile, PR, and the merge gate — are performed by this session only, never delegated to a subagent.** After any batch of subagents returns, verify with `git diff`, `git log`, and `gh pr list` before trusting a self-reported summary.

## 1 — Orient & set up the workspace
- **Collision guard (parallel safety).** Before any git op, confirm isolation: `[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]` → true means you're in a dedicated worktree (good). If you're in the **main** working tree (the two are equal) **and** `git worktree list` shows more than one entry, 🛑 **stop** and tell me — another session may share this dir; relaunch with `claude --worktree <name>`. Main tree as the *sole* worktree is fine for a single `/ship` — note it and proceed.
- `gh issue view <ISSUE>` — read Goal / scope / Key implementation / **Acceptance criteria** (and any "Reconciled" banner).
- Check its place in the roadmap. **blanckstar has no roadmap meta-issue yet (TBD placeholder)** — once one exists, read its phase/dependency/parallelization sections here the way the sibling altinity-sql-browser project's `/ship` reads its #68. Until then, rely on the issue body's own Acceptance criteria and any explicitly linked dependency issues. 🛑 If a hard dependency is unfinished, stop and tell me — don't build out of order.
- **Pick the right base.** If `<ISSUE>` is independent or builds only on *merged* work → branch off `main`: `git fetch && git checkout main && git pull`. If it builds on **unmerged** work, branch off **that** branch instead or wait for it to merge — branching off `main` would build against stale code and conflict.
- `git checkout -b <type>/<slug>-<ISSUE>` (e.g. `feat/rk4-integrator-12`, `fix/radio-light-time-19`).
- **Deps:** if `node_modules` is missing (fresh worktree/clone), run `npm install` before any `npm test` / `npm run build`.

## 2 — Plan
- **Always write the plan — no issue skips this, however small or well-specified.** From the Acceptance criteria, state: files to touch (pure logic → `src/core/`; worker glue → `src/sim/` or `src/sandbox/`; Three.js glue → `src/render/`; DOM → `src/ui/`; any side-effectful call behind an **injected seam** per `CLAUDE.md` rules 1/2), the test files you'll add/extend, and the migration order. Produce this write-up unconditionally before touching code.
- 🛑 If the issue is ambiguous, under-specified, or needs a decision **not** already recorded (issue body / `docs/mvp0_spec.md` / `CLAUDE.md`), stop and ask. This is a settled-spec project — don't invent decisions.
- **High-risk issues get a deeper plan review.** Treat as high-risk: swapping or materially changing the RK4 integrator (`src/core/rk4.ts`, `src/core/gravity.ts`), changing the worker messaging protocol between the main thread and `src/sim/` or `src/sandbox/`, or changing the sandbox API surface (`docs/mvp0_spec.md` §8.2/§8.3 — security-relevant, since forbidden APIs must not leak true ship state). Any other issue you judge under-determined despite its Acceptance criteria also qualifies. For these, **before writing code**: (1) **second opinion** — spawn a `Plan` subagent (Agent tool, `subagent_type: "Plan"`) to independently stress the approach (seams, migration order, coverage strategy, rollback, and — for sandbox changes — what a script could exploit to learn the true state) and fold its critique into the plan; (2) **🛑 post the resulting plan and wait for my approval** (I review on mobile). Skip this for the well-specified, low-risk issues.
- The plan write-up above is required either way; for well-specified, low-risk issues you proceed straight from it (no approval gate).

## 3 — Implement (inner loop)
- Write the code **and its tests in the same change** (rule 1). Keep `src/core/` pure at 100/95/90; keep new worker/DOM/third-party code behind an injected seam so the layering stays honest (rule 2).
- Loop until green: `npm test` (the coverage gate) and `npm run build`. Never proceed on a red suite or a broken build.
- **e2e harness caveat:** unlike the sibling altinity-sql-browser project (which serves raw ESM over a plain HTTP server and needs import-map entries for bundled deps), this repo's Playwright suite runs against the **Vite dev server** (`playwright.config.js`), which already resolves `node_modules` imports and worker URLs natively. Don't assume the sibling's import-map gotcha applies — if a UI change breaks e2e in a way that looks like a module-resolution issue, re-derive the cause from how Vite actually serves the page rather than reapplying that fix.

## 4 — Review (the cycle, before the PR)
- `/code-review` on the working diff → apply real findings → re-run `npm test`.
- `/security-review` if the change touches the sandbox worker (`src/sandbox/`), the message protocol, or anything that could leak true ship state or widen the script API surface — that's this project's security boundary; there is no auth to review.
- **UI-visible change → run `npm run test:e2e`** (Playwright, all three engines). If browsers aren't installed yet: `npx playwright install chromium firefox webkit`. Fix any failures before opening the PR. Then also verify behaviour with the `verify` / `run` skill or agent Chrome.

## 5 — Reconcile (Working-discipline, same change)
- If this reshaped tracked work, reconcile it now: the roadmap meta-issue (**TBD** — skip until blanckstar has one), the issue body's Goal/Acceptance, the relevant ADR addendum (see `CLAUDE.md` "ADR pattern"), and **CHANGELOG.md `[Unreleased]`**.
- An out-of-scope bug / footgun you spotted → open a **separate** issue labelled **`inbox`** (file:line + why deferred) and mention it; don't fold it into this PR.

## 6 — PR
- Performed by **this session only** (see the subagent note above) — never delegate the commit/push/PR-create sequence to a spawned agent.
- Commit using the repo's footer convention (Co-Authored-By + Claude-Session). `git push -u origin <branch>`.
- `gh pr create --base main` — title + body per `.github/PULL_REQUEST_TEMPLATE.md`; **`Closes #<ISSUE>`** if it fully satisfies the issue, else **`Part of #<ISSUE>`**. Tick the checklist (gate, layers, deps, CHANGELOG, reconcile).
- Report the **PR URL**.

## 7 — 🛑 Merge gate — STOP
Do **not** merge. Summarise what shipped + the PR link, and wait. Merging to `main` is a human call. If told to continue, pick the next issue and run the same cycle on it.

## After — friction → memory
If anything needed retries or surprised you (test / env / scope), save a memory so the next `/ship` doesn't repeat it. This session does the saving, not a subagent it spawned.
