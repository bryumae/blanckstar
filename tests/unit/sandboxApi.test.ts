// Injected game-API surface (src/sandbox/api.ts, mvp0_spec.md §8.2, §8.3).
import { describe, it, expect, vi } from 'vitest';
import { buildGameApi } from '../../src/sandbox/api';
import { compileScript } from '../../src/sandbox/runner';
import { loadRealEphemeris, coverageEpoch } from './simHelpers';

const eph = loadRealEphemeris();

function build(callBridge = vi.fn(async () => undefined), log = vi.fn()) {
  return { api: buildGameApi({ callBridge, ephemeris: eph, log }), callBridge, log };
}

describe('buildGameApi surface (§8.2 completeness)', () => {
  it('defines every §8.2 top-level name', () => {
    const { api } = build();
    for (const name of [
      'time', 'wait', 'log', 'radio', 'sensors', 'telescope', 'ephemeris',
      'vars',
      'vec', 'add', 'sub', 'mul', 'dot', 'cross', 'norm', 'normalize', 'angleBetween',
      'ship', 'predict',
      'C', 'MU_SUN', 'MU_EARTH', 'MU_MOON', 'R_EARTH', 'R_MOON', 'R_SOI_EARTH', 'AU', 'SHIP_MASS_KG',
    ]) {
      expect(api[name], `missing ${name}`).toBeDefined();
    }
  });

  it('nests the documented methods', () => {
    const { api } = build();
    expect(typeof (api.time as { now: unknown }).now).toBe('function');
    expect(typeof (api.log as { measurements: unknown }).measurements).toBe('function');
    expect(typeof (api.radio as { lockEarth: unknown }).lockEarth).toBe('function');
    const sensors = api.sensors as Record<string, unknown>;
    expect(typeof sensors.sunDirection).toBe('function');
    expect(typeof sensors.starAttitude).toBe('function');
    expect(typeof (api.telescope as { angularSeparation: unknown }).angularSeparation).toBe('function');
    const ship = api.ship as Record<string, unknown>;
    for (const m of ['point', 'burn', 'scheduleBurn', 'cancelBurn', 'status']) {
      expect(typeof ship[m], `ship.${m}`).toBe('function');
    }
  });

  it('exposes the exact constant values from src/core', () => {
    const { api } = build();
    expect(api.C).toBe(299_792_458);
    expect(api.SHIP_MASS_KG).toBe(12_000);
    expect(api.AU).toBeCloseTo(1.495978707e11);
  });

  it('routes proxied calls through callBridge with the right method+args', async () => {
    const { api, callBridge } = build();
    await (api.radio as { lockEarth: () => Promise<unknown> }).lockEarth();
    await (api.ship as { burn: (t: number, d: number) => Promise<unknown> }).burn(0.5, 600);
    await (api.wait as (s: number) => Promise<unknown>)(120);
    expect(callBridge).toHaveBeenCalledWith('radioLockEarth', []);
    expect(callBridge).toHaveBeenCalledWith('burn', [0.5, 600]);
    expect(callBridge).toHaveBeenCalledWith('wait', [120]);
  });

  it('runs vec math locally without a bridge round-trip', () => {
    const { api, callBridge } = build();
    const v = (api.vec as (x: number, y: number, z: number) => unknown)(1, 2, 2);
    expect((api.norm as (a: unknown) => number)(v)).toBe(3);
    expect(callBridge).not.toHaveBeenCalled();
  });

  it('log() formats args and forwards to the log sink', () => {
    const { api, log } = build();
    (api.log as (...v: unknown[]) => void)('range', { x: 1 });
    expect(log).toHaveBeenCalledWith('range {"x":1}');
  });

  it('vars writes through synchronously via the injected variable seam', () => {
    const sets: unknown[] = [];
    const api = buildGameApi({
      callBridge: vi.fn(async () => undefined),
      ephemeris: eph,
      log: vi.fn(),
      reservedVarNames: new Set(['C', 'vars']),
      varsSnapshot: { entries: [] },
      setVar: (name, value) => sets.push([name, value]),
    });
    const vars = api.vars as Record<string, unknown>;
    vars.burnTime = 123;
    expect(vars.burnTime).toBe(123);
    expect(sets).toEqual([['burnTime', 123]]);
    expect(() => {
      vars.C = 5;
    }).toThrow(/built-in/);
  });

  it('predict() runs locally (same engine) with no bridge round-trip', () => {
    const { api, callBridge } = build();
    const epoch = coverageEpoch(eph);
    const rows = (api.predict as (s: unknown, b: unknown, d: number, so: number) => unknown[])(
      { position: { x: eph.bodies.earth!.samples[0]![0] + 3e10, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, epoch },
      [],
      3600,
      3600,
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(callBridge).not.toHaveBeenCalled();
  });
});

describe('forbidden surface is absent to a running script (§8.3, §12 AC4)', () => {
  it('ship.truePosition/trueVelocity/currentOrbit/distanceTo, debug, solveTransfer, autopilot are undefined', async () => {
    const { api } = build();
    const results: Record<string, string> = {};
    const testApi = { ...api, report: (k: string, ty: string) => { results[k] = ty; } };
    const src = `
      report('ship.truePosition', typeof ship.truePosition);
      report('ship.trueVelocity', typeof ship.trueVelocity);
      report('ship.currentOrbit', typeof ship.currentOrbit);
      report('ship.distanceTo', typeof ship.distanceTo);
      report('debug', typeof debug);
      report('solveTransfer', typeof solveTransfer);
      report('autopilot', typeof autopilot);
    `;
    await compileScript(src, testApi).run();
    expect(results).toEqual({
      'ship.truePosition': 'undefined',
      'ship.trueVelocity': 'undefined',
      'ship.currentOrbit': 'undefined',
      'ship.distanceTo': 'undefined',
      debug: 'undefined',
      solveTransfer: 'undefined',
      autopilot: 'undefined',
    });
  });
});
