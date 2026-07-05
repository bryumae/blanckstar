# ADR-0001 — Simulation worker protocol and driver architecture

Status: accepted (Phase 4, MVP0). Scope: Worker #1 (`src/sim/`), the simulation
clock / ship model / instruments / win-lose engine (mvp0_spec.md §2, §4, §5, §6).

## Context

Worker #1 owns the authoritative game state: ship position/velocity/attitude,
the sim clock, burns, and the win/lose verdict. The main thread (render layer,
DOM screens, and later the script sandbox bridge) must drive it and observe it
without ever holding the truth in a way normal UI can leak (§5.1, §7.8). It has
to be deterministic (§12 AC2), testable without worker globals or a DOM, and
correct through time warp (pause–10,000×) and skip-to-time with the tiered
fixed-step RK4 from `src/core` (§4.4).

Several shape decisions had to be made: the message protocol, whether the truth
stream is a leak, how wall-clock pacing is injected, how overlapping burns are
resolved, and what auto-interrupt does to the clock.

## Decision

### Message protocol — two discriminated unions over an injected `emit` seam

`src/sim/messages.ts` defines `SimCommand` (main → sim) and `SimEvent`
(sim → main), each a discriminated union keyed by `type`. The simulation core
never touches `self`; it emits through an injected `EmitFn`. `worker.ts` is a
thin shell that binds `self.postMessage` as the emit sink and `self.onmessage`
to a `SimDispatcher`. This mirrors the project's other injected side-effect
seams (`src/net/loadEphemeris(fetchImpl)`) and makes the whole command→event
path integration-testable by capturing emitted events into an array.

Commands: `init`, `reset`, `setWarp`, `skipToTime`, `point`, `burn`,
`scheduleBurn`, `cancelBurn`, `radioLockEarth`, `sunDirection`, `starAttitude`,
`angularSeparation`, `annotateMeasurement`, `ephemerisQuery`.

Events: `ready`, `state`, `measurementAdded`, `burnStarted`, `burnEnded`,
`scheduledBurnAdded`, `scheduledBurnCancelled`, `interrupted`, `won`, `lost`,
`skipProgress`, `ephemerisResult`, `error`.

### The truth is emitted; hiding it is a UI rule, not a process boundary

The `state` event carries the full truth: ship position, velocity, forward
vector, engine state, cumulative Δv, and all six body positions at the current
sim time. This is deliberate. The render layer needs true positions to draw the
spacecraft-centered floating-origin scene, and debug mode (§10) needs the full
state. The UI-honesty rule from §5.1/§7.8 — "the player must earn knowledge" —
is enforced by the *normal UI screens simply never displaying position/velocity*,
not by withholding it across the worker boundary. Putting the truth on the
stream keeps one source of state and avoids a second privileged channel.

### Warp pacing is injected (scheduler + wall clock), not timer-bound

`WarpDriver` (`src/sim/driver.ts`) converts wall-elapsed time × warp factor into
sim-seconds and advances the sim in boundary-snapped substeps via the
`Simulation.stepOnce(maxDt)` primitive. Both the tick scheduler (`TickScheduler`)
and the wall clock (`WallClock`) are injected. In the worker they are
`setInterval` + `performance.now`; in tests they are a manual pump and a fake
clock, so pacing and the ~10 Hz state-emission throttle are exercised
deterministically without real timers. State emission is throttled to at most
one `state` event per 100 ms of wall time while warping (§7 events, ~10 Hz).

Skip-to-time runs the same `stepOnce` primitive as fast as possible, chunked
(default 2000 steps) with `skipProgress` events so the worker stays responsive.

### Burn overlap policy — reject, don't queue

The ship has one forward-only engine (§5.2), so at most one burn thrusts at any
instant. A live `burn` or a `scheduleBurn` whose `[start, start+duration)`
window overlaps the active burn or any already-scheduled burn is **rejected**
with an `error` event. Silently queueing or blending would be a physics lie
(two simultaneous thrust vectors, or a hidden reordering the player didn't ask
for). Rejection is explicit and lets the caller reschedule. Windows are
half-open, so an abutting burn (`start == previous end`) is allowed.

### Auto-interrupt drops the clock to pause and emits an event

Warp and skip auto-interrupt on: a scheduled-burn start, Earth SOI **inward**
crossing (outside→inside `R_SOI_EARTH`, edge-detected so we don't re-fire while
already inside), win, and lose (§6). On any interrupt the warp factor is set to
0 (pause) and an `interrupted` / `won` / `lost` event is emitted; the UI decides
what to do next. Pausing (rather than dropping to 1×) is the safe default:
around a burn start or SOI entry the player wants to stop and act, not keep
drifting. Win and lose additionally set an `over` flag that makes `stepOnce` a
no-op until `reset`.

### Determinism

`stepOnce` is a pure function of the current state plus the (deterministic)
ephemeris and burn schedule: `selectTimestep` → `stepToBoundary` → `rk4Step`
with a gravity+thrust accel callback. No wall-clock time or randomness enters
the physics; wall time only meters *how many* substeps a warp tick runs, never
their size or result. Two runs with the same seed and same commands produce
bit-identical ship state (tested by deep-equality of independent runs).

## Consequences

- The simulation core (`simulation.ts`, `burns.ts`, `instruments.ts`,
  `physics.ts`, `driver.ts`, `dispatch.ts`) is fully testable without a Worker
  or DOM; `worker.ts` holds no logic worth unit-testing.
- The render layer and debug mode consume the same `state` stream; there is a
  single authoritative state, no duplicated propagation.
- Rejecting overlapping burns means a script/UI that wants back-to-back burns
  must sequence them explicitly (abutting windows are fine).
- Interrupt-to-pause means the UI must offer a resume affordance; a future
  difficulty mode could switch to 1× instead by changing one line in the driver.
- The `state` event contains truth, so any future non-UI consumer added to the
  main thread must be trusted not to surface it on a normal screen; the honesty
  guarantee is a code-review rule on the UI layer, restated here.

## Cost

- One extra abstraction layer (injected scheduler/clock/emit) versus calling
  `self.postMessage` and `setInterval` directly — paid back immediately in
  testability.
- The truth-on-the-stream decision concentrates the honesty guarantee in the UI
  layer rather than enforcing it structurally at the worker boundary; this is a
  deliberate trade (single source of state) with a documented review rule.
- Per-substep verdict checks (`failureCheck`, `isCaptured`) and body-position
  sampling add cost to every step; acceptable at MVP0 scale and required for
  correctness (§2 "checked every integrator step").

## Addendum (PR #14 code review) — two additive event fields

The protocol was called "frozen" above; this addendum records two strictly
additive, backward-compatible field additions made to fix event-correlation
bugs found in review. No command was added or changed; no existing field
changed meaning.

- `BurnEndedEvent.scheduledId: number | null` — the scheduled handle a burn came
  from (mirrors `BurnStartedEvent.scheduledId`), or `null` for an immediate
  `burn()`. The sandbox bridge awaits an immediate `burn()` on its `burnEnded`;
  without an id it resolved by FIFO and a scheduled burn completing mid-await
  would wrongly resolve the immediate burn's waiter.
- `ErrorEvent.command?: SimCommand['type']` — the command that produced the
  error, when it came from one. The bridge routes the rejection to the matching
  waiter instead of guessing by fixed priority (which mis-attributed when a
  `burn()` and `scheduleBurn()` were outstanding together). Absent for errors
  not tied to a single command.

Also in this pass (no protocol change): `skipToTime` emits a completed
`skipProgress` on a no-op skip (target already reached) so a bridge `wait()`
keyed to a now/past target resolves rather than hanging; a win/lose verdict
reached during a skip returns without also emitting `interrupted`; and the
`WarpDriver` advances whole boundary-snapped substeps against a carried budget
rather than clamping `dt` to the per-tick wall-clock slice, making a warped run
frame-rate independent and deterministic across machines — it follows the same
integration grid as `skipToTime` (identical state at any shared step edge),
though it overshoots an arbitrary target by up to one substep so it is not
bit-identical to a skip to an off-grid time. A per-tick substep cap
(`MAX_STEPS_PER_TICK`) drops leftover budget under overload, so the carried
budget cannot accumulate into a freeze.
