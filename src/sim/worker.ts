// Worker #1 entry point (mvp0_spec.md §3): the simulation clock, tiered-timestep
// RK4 driver, ship model, instruments, and win/lose detection. This file is a
// thin shell only — it binds the real worker seams (self.postMessage as the
// event sink, setTimeout-based ticks as the warp scheduler, performance.now as
// the wall clock) to the worker-agnostic SimDispatcher. All logic and behavior
// live in the sibling modules, integration-tested without worker globals
// (ADR-0001).
import { SimDispatcher } from './dispatch';
import type { TickScheduler, WallClock } from './driver';
import type { SimCommand, SimEvent } from './messages';

const emit = (event: SimEvent): void => {
  self.postMessage(event);
};

// Warp ticks at ~60 Hz wall time; the driver converts wall-elapsed * warp into
// boundary-snapped sim substeps, so the tick rate only bounds emission cadence.
const schedule: TickScheduler = (tick) => {
  const handle = setInterval(tick, 16);
  return () => clearInterval(handle);
};

const now: WallClock = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

const dispatcher = new SimDispatcher(emit, schedule, now);

self.addEventListener('message', (event: MessageEvent<SimCommand>) => {
  try {
    dispatcher.handle(event.data);
  } catch (err) {
    emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
