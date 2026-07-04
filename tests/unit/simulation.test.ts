import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/simulation';
import { positionAt, velocityAt } from '../../src/core/ephemerisInterp';
import { MU_EARTH, MAX_ACCELERATION, R_SOI_EARTH } from '../../src/core/constants';
import { sub, norm } from '../../src/core/vector3';
import {
  EventCollector,
  loadRealEphemeris,
  coverageEpoch,
  cruiseSeed,
  captureSeed,
  atmosphereSeed,
} from './simHelpers';

const eph = loadRealEphemeris();
const epoch = coverageEpoch(eph);

function freshSim(seed = cruiseSeed(eph, epoch)) {
  const c = new EventCollector();
  const sim = new Simulation(c.emit);
  sim.init(eph, seed);
  c.clear(); // drop the init ready+state events
  return { sim, c };
}

describe('init', () => {
  it('emits ready + initial state, forward defaults to normalized velocity', () => {
    const c = new EventCollector();
    const sim = new Simulation(c.emit);
    const seed = cruiseSeed(eph, epoch);
    sim.init(eph, seed);
    expect(c.ofType('ready')).toHaveLength(1);
    const state = c.ofType('state');
    expect(state).toHaveLength(1);
    const fwd = state[0]!.ship.forward;
    expect(norm(fwd)).toBeCloseTo(1, 12);
    // forward should be parallel to the seed velocity direction
    const vhat = { x: seed.velocity.x, y: seed.velocity.y, z: seed.velocity.z };
    const vmag = norm(vhat);
    expect(fwd.x).toBeCloseTo(vhat.x / vmag, 9);
  });
});

describe('determinism (AC2)', () => {
  it('two runs produce bit-identical ship state (deep equality)', () => {
    const stateAfter = () => {
      const c = new EventCollector();
      const sim = new Simulation(c.emit);
      sim.init(eph, cruiseSeed(eph, epoch));
      sim.point({ x: 0.3, y: 1, z: 0.1 });
      sim.burn(1, 120);
      for (let i = 0; i < 400; i++) sim.stepOnce(Infinity);
      c.clear();
      sim.emitState();
      return c.ofType('state')[0]!.ship;
    };
    expect(stateAfter()).toEqual(stateAfter());
  });
});

describe('burns and Δv accounting (§5.2, AC10)', () => {
  it('Δv spent equals throttle × maxAccel × duration exactly', () => {
    const { sim, c } = freshSim();
    const throttle = 0.6;
    const duration = 200;
    sim.burn(throttle, duration);
    // Step until the burn ends (dt snaps onto the end boundary).
    let guard = 0;
    while (c.ofType('burnEnded').length === 0 && guard++ < 100000) {
      sim.stepOnce(Infinity);
    }
    const ended = c.ofType('burnEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.deltaVSpent).toBeCloseTo(throttle * MAX_ACCELERATION * duration, 6);
  });

  it('burn boundary snapping: burn end lands exactly on a step edge', () => {
    const { sim, c } = freshSim();
    sim.burn(0.5, 175); // 175 s, not a multiple of any dt tier
    const startTime = sim.getSimTime();
    while (c.ofType('burnEnded').length === 0) sim.stepOnce(Infinity);
    expect(sim.getSimTime()).toBeCloseTo(startTime + 175, 6);
  });

  it('rejects a live burn that overlaps a scheduled burn', () => {
    const { sim, c } = freshSim();
    const now = sim.getSimTime();
    sim.scheduleBurn(now + 50, { x: 1, y: 0, z: 0 }, 0.5, 100);
    c.clear();
    sim.burn(0.5, 100); // [now, now+100) overlaps [now+50, now+150)
    expect(c.ofType('error')).toHaveLength(1);
    expect(c.ofType('burnStarted')).toHaveLength(0);
  });

  it('rejects invalid throttle / duration / past scheduled start', () => {
    const { sim, c } = freshSim();
    const now = sim.getSimTime();
    sim.burn(1.5, 10);
    sim.burn(0.5, 0);
    sim.scheduleBurn(now - 10, { x: 1, y: 0, z: 0 }, 0.5, 10);
    expect(c.ofType('error').length).toBe(3);
  });
});

describe('scheduled burns (§5.3)', () => {
  it('executes during skip: re-points, thrusts, interrupts, accounts Δv', () => {
    const { sim, c } = freshSim();
    const now = sim.getSimTime();
    const start = now + 500;
    sim.scheduleBurn(start, { x: 0, y: 1, z: 0 }, 0.8, 100);
    c.clear();
    // Skip past the scheduled start; it should interrupt at the burn start.
    sim.skipToTime(now + 5000);
    const interrupts = c.ofType('interrupted');
    expect(interrupts.some((e) => e.reason === 'scheduled-burn')).toBe(true);
    const started = c.ofType('burnStarted');
    expect(started).toHaveLength(1);
    expect(started[0]!.scheduledId).not.toBeNull();
    expect(sim.getSimTime()).toBeCloseTo(start, 6);

    // Continue skipping — the burn now runs and ends; Δv is exactly right.
    c.clear();
    sim.skipToTime(start + 5000);
    const ended = c.ofType('burnEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.deltaVSpent).toBeCloseTo(0.8 * MAX_ACCELERATION * 100, 6);
  });

  it('cancelBurn removes a scheduled burn', () => {
    const { sim, c } = freshSim();
    const now = sim.getSimTime();
    sim.scheduleBurn(now + 100, { x: 1, y: 0, z: 0 }, 0.5, 50);
    const id = c.ofType('scheduledBurnAdded')[0]!.burn.id;
    c.clear();
    sim.cancelBurn(id);
    expect(c.ofType('scheduledBurnCancelled')).toHaveLength(1);
    sim.cancelBurn(id); // second cancel -> error
    expect(c.ofType('error')).toHaveLength(1);
  });
});

describe('win / lose (§2, AC12)', () => {
  it('detects capture from a contrived bound near-Earth state', () => {
    const { sim, c } = freshSim(captureSeed(eph, epoch));
    sim.stepOnce(Infinity);
    const won = c.ofType('won');
    expect(won).toHaveLength(1);
    expect(won[0]!.stats.orbit.eccentricity).toBeLessThan(1); // bound
    expect(won[0]!.stats.orbit.specificEnergy).toBeLessThan(0);
    expect(sim.isOver()).toBe(true);
    // Further stepping is a no-op once over.
    const t = sim.getSimTime();
    sim.stepOnce(Infinity);
    expect(sim.getSimTime()).toBe(t);
  });

  it('detects atmospheric loss below 120 km', () => {
    const { sim, c } = freshSim(atmosphereSeed(eph, epoch));
    sim.stepOnce(Infinity);
    const lost = c.ofType('lost');
    expect(lost).toHaveLength(1);
    expect(lost[0]!.reason).toBe('earth-atmosphere');
    expect(sim.isOver()).toBe(true);
  });

  it('reset restarts from the seed and clears the log', () => {
    const { sim, c } = freshSim(atmosphereSeed(eph, epoch));
    sim.stepOnce(Infinity);
    expect(sim.isOver()).toBe(true);
    sim.measureSunDirection(); // still records? log then cleared by reset
    sim.reset();
    expect(sim.isOver()).toBe(false);
    expect(sim.getSimTime()).toBe(epoch);
    c.clear();
    sim.measureRadioLockEarth();
    // After reset the log restarts at id 1.
    expect(c.ofType('measurementAdded')[0]!.measurement.id).toBe(1);
  });
});

describe('auto-interrupt on Earth SOI entry (§6)', () => {
  it('interrupts on the inward crossing of R_SOI_EARTH', () => {
    // Start just outside SOI, heading straight at Earth.
    const earthP = positionAt(eph, 'earth', epoch);
    const earthV = velocityAt(eph, 'earth', epoch);
    const seed = {
      id: 'soi',
      title: 'soi',
      epoch,
      position: { x: earthP.x + R_SOI_EARTH + 5e6, y: earthP.y, z: earthP.z },
      velocity: { x: earthV.x - 5000, y: earthV.y, z: earthV.z }, // closing at 5 km/s
      playerDescription: 'test',
    };
    const { sim, c } = freshSim(seed);
    let guard = 0;
    while (c.ofType('interrupted').length === 0 && !sim.isOver() && guard++ < 200000) {
      sim.stepOnce(Infinity);
    }
    const soi = c.ofType('interrupted').filter((e) => e.reason === 'earth-soi-entry');
    expect(soi).toHaveLength(1);
    // At interrupt the ship is just inside the SOI radius.
    const shipToEarth = norm(sub(c.ofType('state').at(-1)!.ship.position, positionAt(eph, 'earth', sim.getSimTime())));
    expect(shipToEarth).toBeLessThan(R_SOI_EARTH);
  });
});
