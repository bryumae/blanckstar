import { describe, expect, it } from 'vitest';
import { SimDispatcher } from '../../src/sim/dispatch';
import { STATE_EMIT_INTERVAL_MS, MAX_STEPS_PER_TICK } from '../../src/sim/driver';
import { DT_CRUISE } from '../../src/core/timestep';
import type { TickScheduler, WallClock } from '../../src/sim/driver';
import { EventCollector, loadRealEphemeris, coverageEpoch, cruiseSeed } from './simHelpers';

const eph = loadRealEphemeris();
const epoch = coverageEpoch(eph);

// A manual scheduler + clock: the test pumps ticks by hand and advances the fake
// wall clock explicitly, so warp pacing is exercised without real timers.
function harness() {
  const c = new EventCollector();
  let wallMs = 0;
  const now: WallClock = () => wallMs;
  const ticks: Array<() => void> = [];
  const schedule: TickScheduler = (tick) => {
    ticks.push(tick);
    return () => {
      const i = ticks.indexOf(tick);
      if (i >= 0) ticks.splice(i, 1);
    };
  };
  const dispatcher = new SimDispatcher(c.emit, schedule, now);
  const advanceWall = (ms: number) => {
    wallMs += ms;
  };
  const pump = () => ticks.forEach((t) => t());
  return { c, dispatcher, advanceWall, pump, activeTicks: () => ticks.length };
}

describe('WarpDriver pacing (§6)', () => {
  it('advances ~warp sim-seconds per wall second', () => {
    const { c, dispatcher, advanceWall, pump } = harness();
    dispatcher.handle({ type: 'init', ephemeris: eph, seed: cruiseSeed(eph, epoch) });
    dispatcher.handle({ type: 'setWarp', factor: 100 });
    // 2 wall seconds at 100x -> ~200 sim seconds.
    advanceWall(2000);
    pump();
    const simTime = dispatcher.sim.getSimTime();
    expect(simTime - epoch).toBeGreaterThan(150);
    expect(simTime - epoch).toBeLessThan(250);
    // Warp emits state; at least one state event fired.
    expect(c.ofType('state').length).toBeGreaterThan(0);
  });

  it('warp trajectory is frame-rate independent and matches skip (#7)', () => {
    // The integration grid must not depend on tick cadence: covering the same
    // total wall time in ragged ticks yields the same substeps as one big tick,
    // and matches an equivalent skipToTime. (Previously the per-tick dt clamp
    // made warp frame-rate dependent and divergent from skip.)
    function runWarp(increments: number[]): { simTime: number; pos: unknown } {
      const { c, dispatcher, advanceWall, pump } = harness();
      dispatcher.handle({ type: 'init', ephemeris: eph, seed: cruiseSeed(eph, epoch) });
      dispatcher.handle({ type: 'setWarp', factor: 1000 });
      for (const ms of increments) {
        advanceWall(ms);
        pump();
      }
      dispatcher.handle({ type: 'setWarp', factor: 0 }); // force a final state emit
      return { simTime: dispatcher.sim.getSimTime(), pos: c.ofType('state').at(-1)!.ship.position };
    }
    const even = runWarp([100, 100, 100, 100]);
    const ragged = runWarp([7, 213, 5, 175]); // same 400 ms total, uneven frames
    expect(ragged.simTime).toBe(even.simTime);
    expect(ragged.pos).toEqual(even.pos);

    // And a skip to the same reached time lands on the identical state.
    const cs = new EventCollector();
    const skipDisp = new SimDispatcher(cs.emit, (t) => () => void t, () => 0);
    skipDisp.handle({ type: 'init', ephemeris: eph, seed: cruiseSeed(eph, epoch) });
    skipDisp.sim.skipToTime(even.simTime);
    expect(cs.ofType('state').at(-1)!.ship.position).toEqual(even.pos);
  });

  it('caps substeps per tick and drops leftover budget under overload (no spiral) (#D1)', () => {
    // A huge wall delta at high warp (e.g. a backgrounded tab) would inject an
    // enormous budget. The tick must run at most MAX_STEPS_PER_TICK substeps and
    // drop the rest — carrying it would let the budget grow tick-over-tick into a
    // freeze. Advancing a bounded amount and returning is the proof it didn't.
    const { dispatcher, advanceWall, pump } = harness();
    dispatcher.handle({ type: 'init', ephemeris: eph, seed: cruiseSeed(eph, epoch) });
    dispatcher.handle({ type: 'setWarp', factor: 10_000 });
    advanceWall(3_600_000); // 1 hour of wall time in one tick -> 3.6e10 sim-sec budget
    pump();
    const advanced = dispatcher.sim.getSimTime() - epoch;
    // Bounded by the per-tick cap (cruise dt), not the (astronomically larger) budget.
    expect(advanced).toBeLessThanOrEqual(MAX_STEPS_PER_TICK * DT_CRUISE);
    expect(advanced).toBeGreaterThan(0);
    // A subsequent normal tick still advances (budget was dropped, not stuck).
    const midTime = dispatcher.sim.getSimTime();
    advanceWall(100);
    pump();
    expect(dispatcher.sim.getSimTime()).toBeGreaterThan(midTime);
  });

  it('pause (factor 0) stops the tick loop', () => {
    const { dispatcher, activeTicks } = harness();
    dispatcher.handle({ type: 'init', ephemeris: eph, seed: cruiseSeed(eph, epoch) });
    dispatcher.handle({ type: 'setWarp', factor: 10 });
    expect(activeTicks()).toBe(1);
    dispatcher.handle({ type: 'setWarp', factor: 0 });
    expect(activeTicks()).toBe(0);
  });

  it('throttles state emission to ~10 Hz wall time', () => {
    const { c, dispatcher, advanceWall, pump } = harness();
    dispatcher.handle({ type: 'init', ephemeris: eph, seed: cruiseSeed(eph, epoch) });
    dispatcher.handle({ type: 'setWarp', factor: 1 });
    c.clear();
    // Six ticks each just under the emit interval -> far fewer than six emits.
    for (let i = 0; i < 6; i++) {
      advanceWall(STATE_EMIT_INTERVAL_MS / 3);
      pump();
    }
    expect(c.ofType('state').length).toBeLessThanOrEqual(2);
  });
});

describe('SimDispatcher command routing', () => {
  it('routes ephemerisQuery to an ephemerisResult echoing requestId', () => {
    const { c, dispatcher } = harness();
    dispatcher.handle({ type: 'init', ephemeris: eph, seed: cruiseSeed(eph, epoch) });
    c.clear();
    dispatcher.handle({ type: 'ephemerisQuery', requestId: 42, body: 'mars', t: epoch });
    const res = c.ofType('ephemerisResult');
    expect(res).toHaveLength(1);
    expect(res[0]!.requestId).toBe(42);
    expect(res[0]!.position).toBeDefined();
    expect(res[0]!.velocity).toBeDefined();
  });

  it('routes an angular-separation measurement into the log', () => {
    const { c, dispatcher } = harness();
    dispatcher.handle({ type: 'init', ephemeris: eph, seed: cruiseSeed(eph, epoch) });
    c.clear();
    dispatcher.handle({ type: 'angularSeparation', bodyA: 'earth', bodyB: 'mars' });
    const added = c.ofType('measurementAdded');
    expect(added).toHaveLength(1);
    expect(added[0]!.measurement.data.kind).toBe('angularSeparation');
  });

  it('point re-orients and emits state', () => {
    const { c, dispatcher } = harness();
    dispatcher.handle({ type: 'init', ephemeris: eph, seed: cruiseSeed(eph, epoch) });
    c.clear();
    dispatcher.handle({ type: 'point', direction: { x: 0, y: 0, z: 1 } });
    const st = c.ofType('state').at(-1)!;
    expect(st.ship.forward).toEqual({ x: 0, y: 0, z: 1 });
  });
});
