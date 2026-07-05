// Wall-clock pacing for time warp (mvp0_spec.md §6). At warp factor w the sim
// advances w sim-seconds per wall second, in dt-sized substeps batched per
// animation tick. Both the tick scheduler and the wall clock are injected so
// tests pump ticks synchronously and control time exactly — no timers, no
// requestAnimationFrame, no worker globals (ADR-0001).
//
// State emission is throttled to ~10 Hz wall time: at most one `state` event per
// STATE_EMIT_INTERVAL_MS of wall time while warping, plus one at the end of each
// batch so the last frame always lands.
import type { Simulation } from './simulation';
import type { WarpFactor } from './types';

// Schedules `tick` to run repeatedly; returns a cancel function. In the worker
// this wraps setInterval/setTimeout; in tests it captures the callback so it can
// be pumped by hand.
export type TickScheduler = (tick: () => void) => () => void;

// Injected monotonically-increasing wall clock, milliseconds.
export type WallClock = () => number;

export const STATE_EMIT_INTERVAL_MS = 100; // ~10 Hz (§7 events)

// Hard ceiling on physics substeps run in a single tick. Bounds worst-case
// compute per frame and, together with dropping any leftover budget when it is
// hit, prevents a "spiral of death": if substeps ever cost more wall time than
// they represent (high warp near a body), the carried budget can't grow without
// bound and freeze the worker — warp just falls behind real time under overload.
// Well above any normal per-tick need (max warp × a slow frame ÷ smallest dt).
export const MAX_STEPS_PER_TICK = 5000;

export class WarpDriver {
  private cancel: (() => void) | null = null;
  private lastTickWallMs = 0;
  private lastEmitWallMs = 0;
  // Unspent sim-seconds carried between ticks. Wall-clock time is accumulated
  // here and drawn down by whole physics substeps; it is NEVER used to shorten a
  // substep. That keeps the integration grid (selectTimestep + burn boundaries)
  // independent of frame cadence, so a warped run is deterministic across
  // machines/frame rates and follows the same grid as skipToTime (identical
  // state at any shared step edge) — the previous per-tick dt clamp made warp
  // frame-rate dependent (§6 reproducibility). Warp overshoots an arbitrary
  // target by up to one substep (it has no target to land on), so it is not
  // bit-identical to a skip to an off-grid time; it averages out.
  private budget = 0;

  constructor(
    private readonly sim: Simulation,
    private readonly schedule: TickScheduler,
    private readonly now: WallClock,
  ) {}

  // Start pacing at the given warp factor. Pause (0) stops the tick loop.
  setWarp(factor: WarpFactor): void {
    this.sim.setWarp(factor);
    this.stop();
    if (factor === 0 || this.sim.isOver()) {
      return;
    }
    this.budget = 0;
    this.lastTickWallMs = this.now();
    this.lastEmitWallMs = this.lastTickWallMs;
    this.cancel = this.schedule(() => this.tick(factor));
  }

  stop(): void {
    if (this.cancel) {
      this.cancel();
      this.cancel = null;
    }
    this.budget = 0; // don't carry pacing debt across a stop/reset/init boundary
  }

  // One animation-ish tick: advance sim by (wall elapsed * warp) sim-seconds in
  // boundary-snapped substeps, stopping early on any interrupt or verdict.
  private tick(factor: WarpFactor): void {
    const wallNow = this.now();
    const wallElapsedMs = wallNow - this.lastTickWallMs;
    this.lastTickWallMs = wallNow;

    this.budget += (wallElapsedMs / 1000) * factor; // sim-seconds to advance
    let steps = 0;
    while (this.budget > 0 && !this.sim.isOver()) {
      if (steps >= MAX_STEPS_PER_TICK) {
        // Overloaded: substeps can't keep pace with the requested warp. Drop the
        // unspent budget so it can't accumulate tick-over-tick into a freeze;
        // warp simply runs slower than requested this frame.
        this.budget = 0;
        break;
      }
      const before = this.sim.getSimTime();
      // Infinity: take a full boundary-snapped substep, never a wall-clock-sized
      // partial one — the grid must not depend on frame timing (see `budget`).
      const result = this.sim.stepOnce(Infinity);
      const advanced = this.sim.getSimTime() - before;
      if (result.interrupt || result.over) {
        this.budget = 0;
        this.stop();
        return;
      }
      if (advanced <= 0) {
        // No forward progress (a boundary within a float ULP at large simTime).
        // Drop the budget rather than carrying it, or it would be retried every
        // tick forever with no advance.
        this.budget = 0;
        break;
      }
      this.budget -= advanced; // may go slightly negative; carried to next tick
      steps += 1;
    }

    // Throttled state emission (~10 Hz), plus one at the batch end.
    if (wallNow - this.lastEmitWallMs >= STATE_EMIT_INTERVAL_MS) {
      this.lastEmitWallMs = wallNow;
      this.sim.emitState();
    }
  }
}
