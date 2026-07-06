// Shared value types for the simulation worker (mvp0_spec.md §5, §6, §9). These
// are pure data — no worker globals, no DOM — so the simulation core is
// integration-testable by pumping it directly. Vectors are the plain
// `{x,y,z}` shape from core so they serialize cleanly across postMessage.
import type { Vector3 } from '../core/vector3';
import type { BodyId } from '../core/ephemerisTypes';
import type { FailureReason } from '../core/winLose';
import type { OrbitalElements } from '../core/orbitalElements';

export type { Vector3, BodyId, FailureReason, OrbitalElements };

// The six modeled bodies (§4.2). Iteration order for the state-stream body map.
export const BODY_IDS: readonly BodyId[] = ['sun', 'earth', 'moon', 'mars', 'venus', 'jupiter'];

// Warp factor: 0 = paused, otherwise sim-seconds advanced per wall second.
export type WarpFactor = 0 | 1 | 10 | 100 | 1000 | 10000;

export const WARP_FACTORS: readonly WarpFactor[] = [0, 1, 10, 100, 1000, 10000];

// A curated scenario seed (§9, bvt §14.2). Position/velocity are the hidden true
// start state in heliocentric ecliptic J2000, SI units. `maxAcceleration` is an
// optional per-seed engine override (§5.2); absent means the default 0.5 m/s².
export interface ScenarioSeed {
  readonly id: string;
  readonly title: string;
  readonly epoch: number; // unix seconds; sim clock starts here
  readonly position: Vector3; // m, heliocentric ecliptic J2000
  readonly velocity: Vector3; // m/s
  readonly playerDescription: string; // never reveals true state
  readonly maxAcceleration?: number; // m/s^2 override (default MAX_ACCELERATION)
}

// The ship's live state. `forward` is a unit vector in the inertial frame
// (attitude, §5.3). Position/velocity are hidden truth — emitted only on the
// state stream that debug mode and the render layer consume (§5.1).
export interface ShipState {
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly forward: Vector3;
  readonly deltaVSpent: number; // m/s, cumulative (§5.2)
  readonly burning: boolean;
}

// A scheduled burn (§5.3): re-point to `direction` at `startTime`, then thrust
// at `throttle` for `duration` seconds. `id` is the cancellation handle.
export interface ScheduledBurn {
  readonly id: number;
  readonly startTime: number; // unix seconds
  readonly direction: Vector3;
  readonly throttle: number;
  readonly duration: number; // seconds
}

// One measurement-log entry (§7.5). Append-only, timestamped, id'd. `data` is a
// discriminated union keyed by `kind`.
export interface Measurement {
  readonly id: number;
  readonly simTime: number; // sim clock time the measurement was taken (unix s)
  readonly note?: string;
  readonly data: MeasurementData;
}

export type MeasurementData =
  | RadioLockData
  | SunDirectionData
  | StarAttitudeData
  | AngularSeparationData;

// Radio lock on Earth beacon (§7.2). Light-time honest: direction is toward
// Earth-at-transmit-time, and range is the geometric distance to that position.
// At ephemeris coverage edges, tSent can be clamped to the nearest available
// sample time; derive light-time displays from rangeMeters / c, not timestamps.
export interface RadioLockData {
  readonly kind: 'radioLock';
  readonly body: 'earth';
  readonly rangeMeters: number;
  readonly direction: Vector3; // unit vector, inertial frame
  readonly quality: number; // cosmetic constant (1) in MVP0
  readonly tSent: number; // emission sample time
  readonly tReceived: number; // reception time (= simTime)
}

// Exact unit vector ship -> Sun now (§7.3, §7.5).
export interface SunDirectionData {
  readonly kind: 'sunDirection';
  readonly direction: Vector3;
}

// Ship attitude / forward vector from the star tracker (§7.3).
export interface StarAttitudeData {
  readonly kind: 'starAttitude';
  readonly forward: Vector3;
}

// Angular separation between two bodies' apparent directions (§7.1).
export interface AngularSeparationData {
  readonly kind: 'angularSeparation';
  readonly bodyA: BodyId;
  readonly bodyB: BodyId;
  readonly radians: number;
}

// Win result stats (§2.1). `orbit` is the final Earth-relative orbit.
export interface WinStats {
  readonly missionElapsed: number; // seconds since epoch
  readonly deltaVSpent: number; // m/s
  readonly orbit: OrbitalElements; // Earth-centered
}

// Why warp/skip was auto-interrupted (§6).
export type InterruptReason = 'scheduled-burn' | 'earth-soi-entry' | 'win' | 'lose';
