// Message protocol between the main-thread bridge and the player-script sandbox
// worker (Worker #2, mvp0_spec.md §8; ADR-0002). Two discriminated unions:
// `SandboxCommand` (bridge -> worker) and `SandboxOut` (worker -> bridge).
//
// The worker executes untrusted player JavaScript, so it cannot touch the sim
// worker or the DOM directly. Every game-API call the script makes is proxied:
// the worker posts a `call` out to the bridge, the bridge relays it to the sim
// worker (or resolves it locally), and replies with a `reply`. Vector math,
// constants, and predict() run *inside* the worker (they need no sim state) and
// never round-trip.
import type { EphemerisData } from '../core/ephemerisTypes';
import type { Vector3 } from '../core/vector3';
import type { SandboxVarValue, SandboxVarsSnapshot } from './vars';

// ---- bridge -> sandbox worker ----

// Run a player script. `ephemeris` is handed over once at run start so the
// worker's local predict() can propagate against the same data the sim uses.
export interface RunCommand {
  readonly type: 'run';
  readonly source: string;
  readonly ephemeris: EphemerisData;
  readonly vars: SandboxVarsSnapshot;
}

// Resolve/reject a pending proxied API call by its id.
export interface ReplyCommand {
  readonly type: 'reply';
  readonly callId: number;
  readonly ok: boolean;
  readonly value?: unknown; // present when ok
  readonly error?: string; // present when !ok
}

// Liveness probe (watchdog). The worker answers with a `heartbeat` out message
// as soon as its event loop is free — a script hogging the thread can't answer,
// which is how the bridge detects an unresponsive run.
export interface PingCommand {
  readonly type: 'ping';
  readonly nonce: number;
}

export type SandboxCommand = RunCommand | ReplyCommand | PingCommand;

// ---- sandbox worker -> bridge ----

// The set of proxied API method names the worker can ask the bridge to service.
// Vector math / constants / predict are NOT here — they run in-worker.
export type SandboxCallMethod =
  | 'radioLockEarth'
  | 'sunDirection'
  | 'starAttitude'
  | 'angularSeparation'
  | 'ephemerisPosition'
  | 'ephemerisVelocity'
  | 'point'
  | 'burn'
  | 'scheduleBurn'
  | 'cancelBurn'
  | 'status'
  | 'measurements'
  | 'timeNow'
  | 'wait';

// A proxied game-API call awaiting a `reply`.
export interface CallOut {
  readonly type: 'call';
  readonly callId: number;
  readonly method: SandboxCallMethod;
  readonly args: readonly unknown[];
}

// A `log(...)` line from the script, for the console output pane.
export interface LogOut {
  readonly type: 'log';
  readonly text: string;
}

// The script's async entry function resolved without throwing.
export interface DoneOut {
  readonly type: 'done';
}

// The script threw (or rejected). `message` is the error message; `line` is the
// 1-based source line when the runtime attached a usable stack (mvp0_spec.md
// §8.1).
export interface ScriptErrorOut {
  readonly type: 'scriptError';
  readonly message: string;
  readonly line: number | null;
}

// Answer to a `ping` (watchdog liveness).
export interface HeartbeatOut {
  readonly type: 'heartbeat';
  readonly nonce: number;
}

export interface VarSetOut {
  readonly type: 'varSet';
  readonly name: string;
  readonly value: SandboxVarValue;
}

export interface VarDeleteOut {
  readonly type: 'varDelete';
  readonly name: string;
}

export type SandboxOut =
  | CallOut
  | LogOut
  | DoneOut
  | ScriptErrorOut
  | HeartbeatOut
  | VarSetOut
  | VarDeleteOut;

// ---- shared value shapes carried over the wire ----

// Return of ship.status() (mvp0_spec.md §8.2, §7.8). Mirrors self-knowledge
// only — never position/velocity.
export interface ShipStatus {
  readonly forward: Vector3;
  readonly deltaVSpent: number;
  readonly burning: boolean;
  readonly scheduledBurns: readonly ScheduledBurnInfo[];
  readonly massKg: number;
  readonly maxAcceleration: number;
  readonly maxThrustNewtons: number;
}

export interface ScheduledBurnInfo {
  readonly id: number;
  readonly startTime: number;
  readonly direction: Vector3;
  readonly throttle: number;
  readonly duration: number;
}
