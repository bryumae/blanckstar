// Message protocol between the main thread and the simulation worker (Worker #1;
// mvp0_spec.md §3, §4.4, §5, §6). Two discriminated unions: `SimCommand`
// (main -> sim) and `SimEvent` (sim -> main). The worker shell (worker.ts) binds
// these to `self.onmessage` / `self.postMessage`; the simulation core stays
// worker-agnostic and takes an injected `emit(event)` seam so it is
// integration-testable without worker globals (see ADR-0001).
import type { EphemerisData } from '../core/ephemerisTypes';
import type {
  BodyId,
  InterruptReason,
  FailureReason,
  Measurement,
  ScenarioSeed,
  ScheduledBurn,
  ShipState,
  Vector3,
  WarpFactor,
  WinStats,
} from './types';

// ---- Commands: main thread -> simulation worker ----

// Load ephemeris + a scenario seed and start the sim (paused). Carries the full
// EphemerisData JSON so the worker owns its own copy (§9, §4.5).
export interface InitCommand {
  readonly type: 'init';
  readonly ephemeris: EphemerisData;
  readonly seed: ScenarioSeed;
}

// Restart the current scenario from its seed; measurement log clears (§2.3).
export interface ResetCommand {
  readonly type: 'reset';
}

// Set the time-warp factor (§6). 0 pauses.
export interface SetWarpCommand {
  readonly type: 'setWarp';
  readonly factor: WarpFactor;
}

// Advance sim time to `targetTime` as fast as possible, chunked, emitting
// skipProgress (§6). Auto-interrupts land as `interrupted` events.
export interface SkipToTimeCommand {
  readonly type: 'skipToTime';
  readonly targetTime: number; // unix seconds
}

// Re-orient the ship instantly to a (not-necessarily-unit) direction (§5.3).
export interface PointCommand {
  readonly type: 'point';
  readonly direction: Vector3;
}

// Start a burn now: thrust at `throttle` along current forward for `duration` s.
export interface BurnCommand {
  readonly type: 'burn';
  readonly throttle: number;
  readonly duration: number;
}

// Schedule a future burn (§5.3). Replies with a scheduledBurnAdded event
// carrying the assigned handle id.
export interface ScheduleBurnCommand {
  readonly type: 'scheduleBurn';
  readonly startTime: number;
  readonly direction: Vector3;
  readonly throttle: number;
  readonly duration: number;
}

// Cancel a scheduled burn by handle id.
export interface CancelBurnCommand {
  readonly type: 'cancelBurn';
  readonly id: number;
}

// Take a radio lock on the Earth beacon (§7.2); auto-logs.
export interface RadioLockEarthCommand {
  readonly type: 'radioLockEarth';
}

// Read exact ship->Sun direction (§7.3, §7.5); auto-logs.
export interface SunDirectionCommand {
  readonly type: 'sunDirection';
}

// Read ship attitude / forward vector (§7.3); auto-logs.
export interface StarAttitudeCommand {
  readonly type: 'starAttitude';
}

// Angular separation between two bodies' apparent directions (§7.1); auto-logs.
export interface AngularSeparationCommand {
  readonly type: 'angularSeparation';
  readonly bodyA: BodyId;
  readonly bodyB: BodyId;
}

// Attach a note to a logged measurement (§7.5).
export interface AnnotateMeasurementCommand {
  readonly type: 'annotateMeasurement';
  readonly id: number;
  readonly note: string;
}

// One-shot pass-through of an ephemeris query (§7.4, allowed knowledge). Replies
// with an ephemerisResult event echoing the requestId.
export interface EphemerisQueryCommand {
  readonly type: 'ephemerisQuery';
  readonly requestId: number;
  readonly body: BodyId;
  readonly t: number;
}

export type SimCommand =
  | InitCommand
  | ResetCommand
  | SetWarpCommand
  | SkipToTimeCommand
  | PointCommand
  | BurnCommand
  | ScheduleBurnCommand
  | CancelBurnCommand
  | RadioLockEarthCommand
  | SunDirectionCommand
  | StarAttitudeCommand
  | AngularSeparationCommand
  | AnnotateMeasurementCommand
  | EphemerisQueryCommand;

// ---- Events: simulation worker -> main thread ----

// Confirms init/reset succeeded; carries the initial state stream frame.
export interface ReadyEvent {
  readonly type: 'ready';
  readonly seedId: string;
  readonly epoch: number;
}

// The truth stream (§5.1): full ship + body state at the current sim time.
// Throttled to ~10 Hz wall time under warp; emitted once per discrete change
// otherwise. Normal UI screens never display position/velocity; debug mode and
// the render layer consume this. Hiding truth is a UI-honesty rule, not a
// process boundary (see ADR-0001).
export interface StateEvent {
  readonly type: 'state';
  readonly simTime: number; // unix seconds
  readonly missionElapsed: number; // seconds since epoch
  readonly warp: WarpFactor;
  readonly ship: ShipState;
  readonly bodies: Readonly<Record<BodyId, Vector3>>; // positions at simTime
}

export interface MeasurementAddedEvent {
  readonly type: 'measurementAdded';
  readonly measurement: Measurement;
}

export interface BurnStartedEvent {
  readonly type: 'burnStarted';
  readonly startTime: number;
  readonly endTime: number;
  readonly throttle: number;
  readonly scheduledId: number | null; // set when a scheduled burn fired
}

export interface BurnEndedEvent {
  readonly type: 'burnEnded';
  readonly endTime: number;
  readonly deltaVSpent: number; // cumulative after this burn
}

export interface ScheduledBurnAddedEvent {
  readonly type: 'scheduledBurnAdded';
  readonly burn: ScheduledBurn;
}

export interface ScheduledBurnCancelledEvent {
  readonly type: 'scheduledBurnCancelled';
  readonly id: number;
}

// Warp/skip auto-interrupted; sim is left paused (§6, ADR-0001).
export interface InterruptedEvent {
  readonly type: 'interrupted';
  readonly reason: InterruptReason;
  readonly simTime: number;
}

export interface WonEvent {
  readonly type: 'won';
  readonly stats: WinStats;
}

export interface LostEvent {
  readonly type: 'lost';
  readonly reason: FailureReason;
  readonly simTime: number;
}

// Progress during skip-to-time (§6): fraction in [0,1] of the interval done.
export interface SkipProgressEvent {
  readonly type: 'skipProgress';
  readonly simTime: number;
  readonly fraction: number;
}

export interface EphemerisResultEvent {
  readonly type: 'ephemerisResult';
  readonly requestId: number;
  readonly position: Vector3;
  readonly velocity: Vector3;
}

export interface ErrorEvent {
  readonly type: 'error';
  readonly message: string;
}

export type SimEvent =
  | ReadyEvent
  | StateEvent
  | MeasurementAddedEvent
  | BurnStartedEvent
  | BurnEndedEvent
  | ScheduledBurnAddedEvent
  | ScheduledBurnCancelledEvent
  | InterruptedEvent
  | WonEvent
  | LostEvent
  | SkipProgressEvent
  | EphemerisResultEvent
  | ErrorEvent;

// The injected sink the simulation core emits through (worker.ts binds this to
// self.postMessage; tests capture into an array).
export type EmitFn = (event: SimEvent) => void;
