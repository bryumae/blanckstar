// The player-script game API (mvp0_spec.md §8.2), constructed inside the sandbox
// worker. Two families of member:
//   - proxied: time.now, wait, log.measurements, radio/sensors/telescope/
//     ephemeris/ship calls. These need live sim state, so each posts a `call`
//     to the bridge (via the injected `callBridge`) and awaits its `reply`.
//   - local: vec math, constants, predict(). These are pure and run in-worker
//     against src/core + the ephemeris handed over at run start — no round-trip.
//
// The forbidden surface (§8.3: ship.truePosition/trueVelocity/currentOrbit/
// distanceTo, solveTransfer, autopilot, debug.*) is simply never assembled here,
// so those names are `undefined` inside a running script. runner.ts additionally
// shadows them as explicit parameters as a belt-and-braces guard.
import type { Vector3 } from '../core/vector3';
import { vec3, add, sub, mul, dot, cross, norm, normalize, angleBetween } from '../core/vector3';
import type { EphemerisData } from '../core/ephemerisTypes';
import {
  C,
  MU_SUN,
  MU_EARTH,
  MU_MOON,
  R_EARTH,
  R_MOON,
  R_SOI_EARTH,
  AU,
  SHIP_MASS_KG,
} from '../core/constants';
import type { SandboxCallMethod, ShipStatus } from './protocol';
import { predict, type PredictBurn, type PredictSample, type PredictInput } from './predict';

// The bridge-call seam: send a proxied method call and resolve/reject with the
// bridge's reply. Injected so api.ts is testable without a worker.
export type CallBridge = (method: SandboxCallMethod, args: readonly unknown[]) => Promise<unknown>;

// Names bound into the script scope. Deliberately loose (`unknown`) — the script
// is untyped player JS; the shape is documented in the README/§8.2.
export type GameApi = Record<string, unknown>;

export interface BuildApiDeps {
  readonly callBridge: CallBridge;
  readonly ephemeris: EphemerisData;
  readonly log: (text: string) => void;
  readonly maxAcceleration?: number;
}

// Format one log() argument the way the console pane shows it: JSON for
// objects/arrays, String() otherwise. Keeps vectors readable.
function formatLogArg(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export function buildGameApi(deps: BuildApiDeps): GameApi {
  const { callBridge, ephemeris, log } = deps;

  // log(...values) is a function that also carries log.measurements().
  const logFn = (...values: unknown[]): void => {
    log(values.map(formatLogArg).join(' '));
  };
  (logFn as { measurements?: unknown }).measurements = (): Promise<unknown> =>
    callBridge('measurements', []);

  const api: GameApi = {
    // ---- time ----
    time: {
      now: (): Promise<unknown> => callBridge('timeNow', []),
    },
    wait: (seconds: number): Promise<unknown> => callBridge('wait', [seconds]),

    // ---- logging ----
    log: logFn,

    // ---- radio ----
    radio: {
      lockEarth: (): Promise<unknown> => callBridge('radioLockEarth', []),
    },

    // ---- sensors + telescope ----
    sensors: {
      sunDirection: (): Promise<unknown> => callBridge('sunDirection', []),
      starAttitude: (): Promise<unknown> => callBridge('starAttitude', []),
    },
    telescope: {
      angularSeparation: (a: string, b: string): Promise<unknown> =>
        callBridge('angularSeparation', [a, b]),
    },

    // ---- ephemeris ----
    ephemeris: {
      position: (body: string, t: number): Promise<unknown> =>
        callBridge('ephemerisPosition', [body, t]),
      velocity: (body: string, t: number): Promise<unknown> =>
        callBridge('ephemerisVelocity', [body, t]),
    },

    // ---- vector math (local, pure) ----
    vec: (x: number, y: number, z: number): Vector3 => vec3(x, y, z),
    add: (a: Vector3, b: Vector3): Vector3 => add(a, b),
    sub: (a: Vector3, b: Vector3): Vector3 => sub(a, b),
    mul: (a: Vector3, s: number): Vector3 => mul(a, s),
    dot: (a: Vector3, b: Vector3): number => dot(a, b),
    cross: (a: Vector3, b: Vector3): Vector3 => cross(a, b),
    norm: (a: Vector3): number => norm(a),
    normalize: (a: Vector3): Vector3 => normalize(a),
    angleBetween: (a: Vector3, b: Vector3): number => angleBetween(a, b),

    // ---- ship ----
    ship: {
      point: (direction: Vector3): Promise<unknown> => callBridge('point', [direction]),
      burn: (throttle: number, durationSeconds: number): Promise<unknown> =>
        callBridge('burn', [throttle, durationSeconds]),
      scheduleBurn: (
        startTime: number,
        direction: Vector3,
        throttle: number,
        duration: number,
      ): Promise<unknown> => callBridge('scheduleBurn', [startTime, direction, throttle, duration]),
      cancelBurn: (handle: number): Promise<unknown> => callBridge('cancelBurn', [handle]),
      status: (): Promise<ShipStatus> => callBridge('status', []) as Promise<ShipStatus>,
    },

    // ---- prediction (local, pure — same engine as the sim) ----
    predict: (
      state: PredictInput,
      burns: readonly PredictBurn[] = [],
      duration: number,
      stepOut: number,
    ): PredictSample[] => predict(ephemeris, state, burns, duration, stepOut, deps.maxAcceleration),

    // ---- constants ----
    C,
    MU_SUN,
    MU_EARTH,
    MU_MOON,
    R_EARTH,
    R_MOON,
    R_SOI_EARTH,
    AU,
    SHIP_MASS_KG,
  };

  return api;
}
