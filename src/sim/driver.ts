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

export class WarpDriver {
  private cancel: (() => void) | null = null;
  private lastTickWallMs = 0;
  private lastEmitWallMs = 0;

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
    this.lastTickWallMs = this.now();
    this.lastEmitWallMs = this.lastTickWallMs;
    this.cancel = this.schedule(() => this.tick(factor));
  }

  stop(): void {
    if (this.cancel) {
      this.cancel();
      this.cancel = null;
    }
  }

  // One animation-ish tick: advance sim by (wall elapsed * warp) sim-seconds in
  // boundary-snapped substeps, stopping early on any interrupt or verdict.
  private tick(factor: WarpFactor): void {
    const wallNow = this.now();
    const wallElapsedMs = wallNow - this.lastTickWallMs;
    this.lastTickWallMs = wallNow;

    let budget = (wallElapsedMs / 1000) * factor; // sim-seconds to advance this tick
    while (budget > 0 && !this.sim.isOver()) {
      const before = this.sim.getSimTime();
      const result = this.sim.stepOnce(budget);
      const advanced = this.sim.getSimTime() - before;
      if (result.interrupt || result.over) {
        this.stop();
        return;
      }
      if (advanced <= 0) {
        break; // no progress possible (defensive; shouldn't happen with dt>0)
      }
      budget -= advanced;
    }

    // Throttled state emission (~10 Hz), plus one at the batch end.
    if (wallNow - this.lastEmitWallMs >= STATE_EMIT_INTERVAL_MS) {
      this.lastEmitWallMs = wallNow;
      this.sim.emitState();
    }
  }
}
