import { describe, expect, it } from 'vitest';
import { SimDispatcher } from '../../src/sim/dispatch';
import { STATE_EMIT_INTERVAL_MS } from '../../src/sim/driver';
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
