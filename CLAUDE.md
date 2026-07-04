# Contributor guide — blanckstar

A browser-based, true-scale, no-map spacecraft navigation simulator. Vite +
TypeScript + Three.js, no backend, no network dependency during gameplay (see
`docs/mvp0_spec.md` for the full design). Quality is held by tests.

## Hard rules

1. **Coverage gate, scoped to `src/core/`.** `npm test` must pass. `src/core/`
   (vectors, constants, RK4 integrator, gravity, orbital elements, ephemeris
   interpolation) is pure logic — no DOM, no worker globals — and is gated at
   **100% statements/lines, 95% functions, 90% branches, per file**. Everything
   else (`src/sim/`, `src/sandbox/`, `src/render/`, `src/ui/`, `src/main.ts`) is
   worker/DOM/browser glue: integration-tested, no hard numeric floor. Add
   tests in the same change as the code.
2. **Keep the layers honest.**
   - `src/core/` — pure logic only. No DOM, no `self`/`postMessage`, no
     `window`, no imports from other `src/` directories that aren't equally
     pure.
   - `src/sim/` and `src/sandbox/` — the two Web Workers (simulation clock +
     instrument models; player-script sandbox). Talk to the main thread only
     through an injected `postMessage` seam — never assume a live DOM.
   - `src/render/` — Three.js glue (scene/camera/starfield). Push math (e.g.
     the spacecraft-centered floating-origin transform) into `src/core/`
     rather than computing it inline here.
   - `src/ui/` — DOM screens (`telescope/`, `sequence/`, `data/`). Plain
     DOM/CSS, no canvas, no UI framework (rule 5).
   - `src/net/` — side-effectful environment access (localStorage, JSON
     fetch) is **injected**, never imported directly — e.g.
     `loadEphemeris(fetchImpl)` in `src/net/loadEphemeris.ts`. This mirrors
     the sibling altinity-sql-browser project's `createApp(env)` pattern; as
     the bootstrap grows, wire these seams through an analogous
     `createGame(env)` entry point in `src/main.ts`.
3. **No secrets in git.** There is no backend or auth today, so this is mostly
   future-proofing — but if a build step or integration ever needs a token or
   key, it does not get committed, full stop.
4. **The build is Vite-only; runtime dependencies are rare and deliberate.**
   Currently the only runtime dependency is `three`. Adding another is a
   deliberate decision, not a default — prefer solving the problem in
   `src/core/` or with a browser-native API first.
5. **No UI framework for game screens.** Per `docs/mvp0_spec.md` §7, the
   Telescope/Sequence/Data screens are plain HTML/CSS (DOM, not canvas). Use
   vanilla DOM or minimal hand-rolled helpers — no React/Vue/Svelte/etc.

## Repo map

| Path | What |
|---|---|
| `src/core/*` | pure math/physics — vectors, constants, RK4, gravity, orbital elements, ephemeris interpolation. 100/95/90 covered. |
| `src/sim/*` | Worker #1 glue — sim clock, tiered-timestep driver, instrument models, message types |
| `src/sandbox/*` | Worker #2 glue — player-script sandbox bootstrap, injected API surface, forbidden-API enforcement |
| `src/render/*` | Three.js scene/camera/starfield |
| `src/ui/telescope/*`, `src/ui/sequence/*`, `src/ui/data/*` | the three primary DOM screens |
| `src/net/*` | injected seams for localStorage / JSON fetch |
| `src/main.ts` | bootstrap: creates workers, wires DOM, starts the render loop |
| `scripts/*` | offline data-generation and scenario-validation scripts (ephemeris, star catalog, seed validation) |
| `data/*` | generated ephemeris + star catalog JSON, consumed at runtime |
| `tests/unit/*` | vitest + happy-dom, one spec per module |
| `tests/e2e/*` | Playwright smoke/regression specs |
| `tests/vitest.config.ts` | coverage config — per-file thresholds scoped to `src/core/` |

## Conventions

Pure-by-construction `src/core/`, injected side-effect seams (`src/net/`, the
worker `postMessage` boundaries), per-file coverage thresholds on the pure
layer, and a single Vite build.

## Working discipline

- **Surface out-of-scope findings, don't bury them.** Spot a real bug, data
  inconsistency, deprecated API, or future footgun outside the current task →
  open an issue labeled `inbox` (file:line + why deferred) and tell the user.
  High signal only, not style nits.
- **Reconcile forward work after a substantive change.** A change to behavior,
  schema, or a settled decision can stale tracked work. In the same commit,
  reconcile what it reshaped: the roadmap meta-issue (**#3 — MVP0 roadmap**,
  phase issues #4–#12) — re-check
  or re-scope the track it touches; the affected issue's body (Goal/Acceptance);
  the relevant ADR addendum and `CHANGELOG.md` `[Unreleased]`; and any issue it
  obsoletes (close via "Closes #N" in the PR). Flag it if the rework is large.
  (Trivial typo/comment changes exempt.)
- **Convert friction into memory.** If a task needed retried commits or hit an
  unexpected failure (test/env/scope surprise), save a memory so the next
  session doesn't repeat it.
- **Subagent fan-out is read-only unless the prompt says otherwise.** A
  forked or spawned agent inherits the *entire* parent conversation —
  including this file and any skill script being run — so without an
  explicit boundary it can conclude it's the one meant to finish the whole
  task: committing, pushing, opening a PR, editing `CHANGELOG.md`, or
  writing to the memory directory. When fanning out review/finder/analysis
  subagents mid-task, state the boundary in every prompt ("read-only: no
  Edit/Write, no git/gh mutating commands, no TaskCreate/TaskUpdate, no
  memory writes — return only \<schema\>"), and prefer a fresh,
  self-contained agent over `fork` when the parent context includes an
  in-progress mutating workflow — a fork inherits that context, a fresh
  agent doesn't. Diff the working tree, `git log`, and `gh pr list` after
  every batch regardless: an instruction in a prompt is not an enforced tool
  restriction.

## ADR pattern

Once a real architectural decision arises (e.g. the RK4/tiered-timestep
implementation, the worker messaging protocol, the sandbox API design), record
it as `docs/ADR-NNNN-<slug>.md` with context / decision / consequences / cost
sections — same convention as the sibling altinity-sql-browser project. Don't
create one preemptively; `docs/mvp0_spec.md` already captures the MVP0-level
decisions.
