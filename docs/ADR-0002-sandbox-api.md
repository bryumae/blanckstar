# ADR-0002 — Player-script sandbox: API design, execution model, and bridge

Status: accepted (Phase 5, MVP0). Scope: Worker #2 (`src/sandbox/`), the player-
script sandbox, its game-API bridge to Worker #1, and the sequence console UI
(`src/ui/sequence/`). Covers mvp0_spec.md §8 and the §14 deferred decision on the
`wait()` implementation.

## Context

Players program the ship in real JavaScript (§8.1, resolving the custom-mini-
language alternative). That script is untrusted: it must not touch the DOM, the
network, nested workers, or the hidden ship truth, and a runaway loop must always
be stoppable (§8.1, §8.3, §12 AC9). It also has to feel natural — `await
wait(600)`, `await ship.burn(...)` — while the spec's hard rule holds: script-
visible sim time only advances during `wait()`, and the script never races the
clock (§6, §8.1).

The simulation (Worker #1) already owns the authoritative state behind a frozen
command/event protocol (ADR-0001). The sandbox cannot reach it directly, so a
main-thread bridge must relay each API call to the sim and correlate the reply.
Several decisions had to be made: how to run untrusted code with a clean scope,
how the async API suspends, how to correlate replies over a protocol that has no
per-call request id for most commands, what `wait()` does on interrupt, how the
kill switch works, and how `predict()` stays "the same engine" as the sim.

## Decision

### Execution model — AsyncFunction over the injected API names, await convention

A script is compiled as the body of an **async function** whose parameters are
the injected game-API names (`compileScript` in `runner.ts`, using the
`AsyncFunction` constructor reached via an async function's prototype — never a
named global). Players write ordinary `await` against ordinary locals; there is
no source transform (the §14 deferred choice resolves to the **await
convention**, not a rewriter). The contract, documented for players: instrument/
ship/`wait` calls return Promises and should be awaited; script-visible time only
moves during `await wait(s)`. This is the whole of the "light transform"
mentioned in §8.1 — the transform is "the code is a function body," nothing more.

### Global-scope neutralization — delete on `self` plus parameter shadowing

`neutralize.ts` deletes the dangerous globals off the worker's `self`
(`fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB`, `caches`,
`Worker`, `BroadcastChannel`, `postMessage`, `addEventListener`, …) before any
script runs. `Math`/`JSON`/`Promise`/`Date`/`console` stay so the language is
usable. Two layers, because a single delete is not a security guarantee:

1. delete/shadow off `self` so bare identifiers and `self.fetch` find nothing;
2. the §8.3 forbidden names (`debug`, `solveTransfer`, `autopilot`) are
   additionally re-bound to `undefined` as function parameters, so inside the
   body they resolve to the shadow, not to any ambient value. `ship` is the
   injected object with only the allowed methods — `ship.truePosition` etc. are
   simply never assembled, so they read `undefined`.

The bridge channel (`postMessage`/`addEventListener`) is captured into closures
**before** neutralization runs, so the worker keeps talking to the bridge even
though the script can no longer reach those functions.

### Bridge correlation — requestId where the protocol has one, FIFO-by-kind where it doesn't

`bridge.ts` (main thread, fully injected seams — it never constructs a Worker or
touches the DOM) relays each proxied call to the sim and resolves it on the
matching sim event:

- **ephemeris** queries use the protocol's `requestId` echo → exact correlation,
  order-independent.
- **measurements** (`radioLockEarth`/`sunDirection`/`starAttitude`/
  `angularSeparation`) have **no** request id on `measurementAdded`. The bridge
  correlates by **kind + FIFO queue**: it is the sole issuer of these commands
  during a run and the sim processes commands single-threaded and in order, so
  first-issued-of-a-kind matches first-`measurementAdded`-of-that-kind exactly.
- **ship commands**: `point` resolves on the next `state`; `burn` resolves on
  `burnEnded` (rejects on `error`); `scheduleBurn` resolves the handle from
  `scheduledBurnAdded`; `cancelBurn` resolves on `scheduledBurnCancelled`.
- **status/timeNow/measurements-read** resolve synchronously from mirrors the
  bridge keeps off the `state`/`measurementAdded`/`scheduledBurn*` stream.

This lets Phase 5 consume the frozen ADR-0001 protocol **without adding a
command or event** — no per-call id was retrofitted onto measurements.

### `wait(seconds)` — skip-to-time, resolve on target, early-resolve on interrupt

`wait(s)` posts `skipToTime(now + s)` and resolves when the sim's
`state`/`skipProgress` time reaches the target. It resolves **early** (does not
reject) on `interrupted`/`won`/`lost`: the sim auto-interrupts warp/skip on a
scheduled-burn start, SOI entry, or a verdict (§6), leaving the clock paused
short of the target. The script then sees time simply stopped where it stopped —
`time.now()` reflects the real paused time — which matches "script-visible time
only moves during wait()" and keeps the script and clock from racing. A
non-positive `wait` resolves immediately without touching the sim.

### Runaway protection — terminate + respawn, plus a heartbeat watchdog

Stop calls `worker.terminate()` (kills any loop, however tight — §8.1) and
immediately respawns a fresh clean-global worker, so the next Run starts from
zero. A heartbeat watchdog (injected timer seam) pings the worker each interval;
if no heartbeat returns within the budget the bridge reports "unresponsive — Stop
to terminate" to the UI. The watchdog only *detects*; termination is always the
user's Stop (or a new Run, which stops first). Script errors surface with a line
number when the runtime attaches a usable stack; an error stops the script, not
the sim.

### `predict()` and vector math run inside the worker, not over the bridge

`vec`/`add`/…/`angleBetween`, the constants, and `predict()` are pure and need no
sim state, so they execute **in the worker** against `src/core` (the worker
bundle may import `src/core`; the player cannot). `predict()` (`predict.ts`)
propagates a **player-entered** state with the same `rk4`/`gravity`/tiered-
timestep/Hermite code path the sim uses (`src/core/advance`), against the
ephemeris handed to the worker at run start. That shared code — not a copy — is
the §7.7/§8.2 "same engine" guarantee; a unit test asserts predict() rows match a
direct core propagation.

### Measurement-log mirror is page-lifetime, not sim-lifetime

`log.measurements()` reads a mirror the bridge builds from every
`measurementAdded` since page load. A sim `reset` clears the sim's own log but
not the mirror; this is accepted for MVP0 because the page lifetime contains the
sim lifetime and a fresh page starts empty. If mid-run reset-and-replay is added
later, the bridge must clear the mirror on the sim's `ready`/`reset`.

### Sequence console UI — plain DOM, tab registration seam

`mountSequenceScreen(root, deps)` renders the tab bar (Script Console now;
Calculator / Candidates / Trajectory Predictor as placeholder panels with
`data-tab` attributes). Later phases add tabs through `deps.extraTabs`
(`registerSequenceTab(id, label, mount)`) rather than editing this file. The
console depends only on a `ScriptConsoleController` interface (run/stop/
isRunning) and a `ConsoleSink` it hands back via `deps.bindConsole` — not on the
bridge class — so it stays DOM-only and testable. Scripts persist (multiple
named, create/rename/delete, last-open) through the injected `StorageLike` seam
(`ScriptStore`).

## Consequences

- Phase 5 ships on the **frozen** sim protocol; no command/event was added.
- The measurement FIFO-by-kind correlation is correct only while the bridge is
  the sole issuer of those commands during a script run. GUI-issued measurements
  (Data/Telescope screens) still land in the mirror via `measurementAdded`, but
  the bridge does not await them — it only awaits the ones it posted. This holds
  as long as script `wait()` blocks the script between calls (it does), so a
  script and the GUI never interleave measurement commands mid-await.
- Security rests on delete-off-`self` **and** parameter shadowing **and** the
  worker process boundary — no single layer is trusted alone. A non-configurable
  non-writable ambient global (none exist among the forbidden set on real hosts)
  would defeat layer 1/2 but is still unreachable usefully without the bridge
  channel, which the script cannot see.
- `predict()` inside the worker means the ephemeris is copied into Worker #2 at
  run start (already copied into Worker #1 at init) — two resident copies. Fine
  for the MVP0 data size.

## Cost

- The bridge carries per-run correlation state (waiter queues per measurement
  kind, ephemeris waiters by id, single-slot `wait`) that must be reset on run/
  stop and rejected on teardown — more moving parts than a request-id-everywhere
  protocol, traded against not reopening the frozen sim protocol.
- The heartbeat watchdog only flags unresponsiveness; it cannot preempt (a Worker
  can't be interrupted mid-synchronous-loop from outside). Termination is the
  only real stop, which is why Stop always respawns.
- The old `src/sandbox/messages.ts` ping/pong scaffold is now superseded by
  `protocol.ts`; `main.ts` still imports it and is rewired by the orchestrator
  when it wires the bridge — the stub should be deleted then.

## Addendum (PR #14 code review)

Fixes to the correlation layer and the neutralization backstop found in review:

- **Parameter-shadow layer now actually covers the forbidden set.** The
  "delete-off-`self` **and** parameter shadowing **and** process boundary"
  claim above was aspirational: `runner.ts`'s `SHADOWED_NAMES` listed only the
  hint names (`debug`/`solveTransfer`/`autopilot`), so if deleting a
  non-configurable global ever failed, layer 2 would not catch it. It now
  includes every `FORBIDDEN_GLOBALS` name (deduped), making the layered claim
  true rather than intended.
- **`wait()` can no longer hang.** A `wait()` issued after the sim reached a
  verdict (or to an already-past target) posted a `skipToTime` the sim
  no-ops, so the waiter never settled. The bridge now tracks the terminal
  verdict (`won`/`lost`, cleared on `ready`) and resolves such a `wait()`
  immediately (time is frozen); the sim also emits a completed `skipProgress`
  on a no-op skip as a second guard.
- **Burn/error correlation is explicit, not positional.** The bridge uses the
  new `BurnEndedEvent.scheduledId` (resolve an immediate `burn()` only on a
  `scheduledId === null` end) and `ErrorEvent.command` (route a rejection to
  the matching waiter), replacing FIFO/fixed-priority guesses that
  mis-attributed when immediate and scheduled burns overlapped. See the
  ADR-0001 addendum for the two additive fields.
- **`predict()` parity.** The output-sample cadence is no longer fed into
  `stepToBoundary`, so predicted trajectories integrate the sim's own grid
  (burn boundaries + target) and match it regardless of `stepOut`; sample rows
  are emitted at the first step endpoint at/after each output tick.

## Addendum (issue #17) — shared advance/burn logic moved to `src/core`

The "same engine" guarantee above depended on `predict()` importing
`gravitatingBodiesAt`/`advance` from `src/sim/physics`, while the UI predictor
tab (`src/ui/sequence/tabs/predictorEngine.ts`) could not do the same across
the phase boundary and instead copied the logic — the two copies drifted and
caused the predictor-parity fixes noted above. That wiring, plus the
`thrustAt`/`burnBoundaries` burn-scheduling helpers (previously duplicated as
`PredictBurn`/`PredictorBurn`), now lives in `src/core/advance.ts` and
`src/core/burn.ts`: pure, importable by the sim, the sandbox, and the UI
alike. `predict()` and the predictor tab both import from `src/core` now;
`src/sim/physics.ts` no longer exists.
