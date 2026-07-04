// Main-thread bridge between the player-script sandbox worker (Worker #2) and
// the simulation worker (Worker #1). mvp0_spec.md §8; ADR-0002.
//
// The sandbox worker runs untrusted JS and cannot talk to the sim directly.
// Every proxied game-API call arrives here as a `call` out message; the bridge
// relays it to the sim as a SimCommand, correlates the sim's reply event, and
// answers the worker with a `reply`. It also owns the worker lifecycle (Stop =
// terminate + recreate) and a heartbeat watchdog for runaway scripts.
//
// Fully injected seams (repo rule 2): the bridge never constructs a Worker or
// touches the DOM. The host passes `createSandboxWorker()` plus the sim
// command/listener surface. This keeps the whole correlation path testable with
// fake endpoints.
import type { SimCommand, SimEvent } from '../sim/messages';
import type { BodyId } from '../core/ephemerisTypes';
import type { EphemerisData } from '../core/ephemerisTypes';
import type { Measurement, MeasurementData, Vector3 } from '../sim/types';
import { SHIP_MASS_KG } from '../core/constants';
import type {
  SandboxCommand,
  SandboxOut,
  CallOut,
  SandboxCallMethod,
  ShipStatus,
  ScheduledBurnInfo,
} from './protocol';

// The minimal worker surface the bridge drives — a Worker without the DOM types,
// so tests supply a fake.
export interface WorkerLike {
  postMessage(msg: SandboxCommand): void;
  addEventListener(type: 'message', cb: (e: MessageEvent<SandboxOut>) => void): void;
  removeEventListener(type: 'message', cb: (e: MessageEvent<SandboxOut>) => void): void;
  terminate(): void;
}

export interface BridgeDeps {
  // Construct a fresh sandbox worker. Called once at construction and again on
  // every Stop (terminate + recreate a clean-global worker).
  readonly createSandboxWorker: () => WorkerLike;
  // Relay a command to the sim worker.
  readonly postToSim: (cmd: SimCommand) => void;
  // Subscribe/unsubscribe to sim events. The bridge keeps one listener for its
  // whole lifetime.
  readonly addSimListener: (cb: (event: SimEvent) => void) => void;
  readonly removeSimListener: (cb: (event: SimEvent) => void) => void;
  // Ephemeris handed to the worker at run start (for local predict()).
  readonly ephemeris: EphemerisData;
  // Per-scenario engine override, mirrored into ship.status() (§5.2).
  readonly maxAcceleration?: number;
  // Console/status callbacks for the UI (all optional).
  readonly onLog?: (text: string) => void;
  readonly onScriptError?: (message: string, line: number | null) => void;
  readonly onDone?: () => void;
  readonly onRunningChange?: (running: boolean) => void;
  readonly onUnresponsive?: (unresponsive: boolean) => void;
  // Watchdog knobs (injected for deterministic tests). Defaults suit a browser.
  readonly watchdog?: WatchdogDeps;
}

// Injected timer seam for the heartbeat watchdog so tests drive it without real
// timers.
export interface WatchdogDeps {
  readonly setInterval: (cb: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
  readonly pingIntervalMs: number; // how often to ping
  readonly unresponsiveAfterMs: number; // no heartbeat for this long => unresponsive
  readonly now: () => number;
}

const DEFAULT_MAX_ACCELERATION = 0.5; // m/s^2 (§5.2); mirrored, not authoritative

// A pending proxied call resolved by a specific sim event.
interface PendingCall {
  readonly method: SandboxCallMethod;
  resolve: (value: unknown) => void;
  reject: (error: string) => void;
}

// Measurement kinds the bridge correlates by FIFO order (no requestId in the
// protocol; the bridge is the sole issuer during a run and the sim is
// single-threaded, so first-in-first-matched is exact — ADR-0002).
type MeasurementKind = MeasurementData['kind'];

const METHOD_TO_MEASUREMENT_KIND: Partial<Record<SandboxCallMethod, MeasurementKind>> = {
  radioLockEarth: 'radioLock',
  sunDirection: 'sunDirection',
  starAttitude: 'starAttitude',
  angularSeparation: 'angularSeparation',
};

const METHOD_TO_SIM_MEASUREMENT_CMD: Partial<Record<SandboxCallMethod, SimCommand['type']>> = {
  radioLockEarth: 'radioLockEarth',
  sunDirection: 'sunDirection',
  starAttitude: 'starAttitude',
  angularSeparation: 'angularSeparation',
};

export class SandboxBridge {
  private worker: WorkerLike;
  private workerListener: (e: MessageEvent<SandboxOut>) => void;
  private running = false;

  // Correlation state, reset per run.
  private nextEphemerisReqId = 1;
  private readonly ephemerisWaiters = new Map<number, PendingCall>();
  // FIFO queues per measurement kind (radioLock/sunDirection/...).
  private readonly measurementWaiters = new Map<MeasurementKind, PendingCall[]>();
  private pointWaiters: PendingCall[] = [];
  private burnWaiters: PendingCall[] = [];
  private scheduleWaiters: PendingCall[] = [];
  private readonly cancelWaiters = new Map<number, PendingCall>();
  // wait(): one at a time (a script awaits sequentially). Target sim time.
  private waitWaiter: { target: number; call: PendingCall } | null = null;

  // Mirrors updated from the sim stream (§8.2: status/measurements/timeNow).
  private latestSimTime = 0;
  private latestForward: Vector3 = { x: 1, y: 0, z: 0 };
  private latestDeltaV = 0;
  private latestBurning = false;
  private readonly scheduledBurns = new Map<number, ScheduledBurnInfo>();
  // Measurement log mirror (§7.5, §8.2). Sees measurements since page load —
  // acceptable for MVP0 since a sim reset clears the sim log and the page
  // lifetime contains the sim lifetime (ADR-0002 measurement-mirror tradeoff).
  private readonly measurementLog: Measurement[] = [];

  // Watchdog.
  private watchdogHandle: unknown = null;
  private lastHeartbeat = 0;
  private unresponsive = false;

  constructor(private readonly deps: BridgeDeps) {
    this.workerListener = (e) => this.onWorkerMessage(e.data);
    this.worker = this.spawnWorker();
    this.deps.addSimListener(this.onSimEvent);
  }

  // ---- lifecycle ----

  private spawnWorker(): WorkerLike {
    const w = this.deps.createSandboxWorker();
    w.addEventListener('message', this.workerListener);
    return w;
  }

  // Run a script. If one is already running it is stopped first (fresh worker).
  run(source: string): void {
    if (this.running) {
      this.stop();
    }
    this.resetCorrelation();
    this.running = true;
    this.deps.onRunningChange?.(true);
    this.startWatchdog();
    this.worker.postMessage({ type: 'run', source, ephemeris: this.deps.ephemeris });
  }

  // Stop the running script: terminate the worker (kills any runaway loop —
  // §8.1) and recreate a clean one so the next run starts fresh.
  stop(): void {
    this.stopWatchdog();
    this.worker.removeEventListener('message', this.workerListener);
    this.worker.terminate();
    this.rejectAll('script stopped');
    this.worker = this.spawnWorker();
    if (this.running) {
      this.running = false;
      this.deps.onRunningChange?.(false);
    }
    if (this.unresponsive) {
      this.unresponsive = false;
      this.deps.onUnresponsive?.(false);
    }
  }

  // Detach from the sim stream. The host calls this when tearing down the
  // screen. Does not affect the sim.
  dispose(): void {
    this.stopWatchdog();
    this.worker.removeEventListener('message', this.workerListener);
    this.worker.terminate();
    this.deps.removeSimListener(this.onSimEvent);
  }

  isRunning(): boolean {
    return this.running;
  }

  private resetCorrelation(): void {
    this.rejectAll('script restarted');
    this.nextEphemerisReqId = 1;
    this.waitWaiter = null;
  }

  private rejectAll(reason: string): void {
    for (const p of this.ephemerisWaiters.values()) p.reject(reason);
    this.ephemerisWaiters.clear();
    for (const q of this.measurementWaiters.values()) q.forEach((p) => p.reject(reason));
    this.measurementWaiters.clear();
    this.pointWaiters.forEach((p) => p.reject(reason));
    this.pointWaiters = [];
    this.burnWaiters.forEach((p) => p.reject(reason));
    this.burnWaiters = [];
    this.scheduleWaiters.forEach((p) => p.reject(reason));
    this.scheduleWaiters = [];
    for (const p of this.cancelWaiters.values()) p.reject(reason);
    this.cancelWaiters.clear();
    if (this.waitWaiter) {
      this.waitWaiter.call.reject(reason);
      this.waitWaiter = null;
    }
  }

  // ---- worker -> bridge ----

  private onWorkerMessage(msg: SandboxOut): void {
    switch (msg.type) {
      case 'call':
        this.handleCall(msg);
        return;
      case 'log':
        this.deps.onLog?.(msg.text);
        return;
      case 'done':
        this.finishRun();
        this.deps.onDone?.();
        return;
      case 'scriptError':
        this.finishRun();
        this.deps.onScriptError?.(msg.message, msg.line);
        return;
      case 'heartbeat':
        this.onHeartbeat();
        return;
    }
  }

  private finishRun(): void {
    this.stopWatchdog();
    this.rejectAll('script ended');
    if (this.running) {
      this.running = false;
      this.deps.onRunningChange?.(false);
    }
    if (this.unresponsive) {
      this.unresponsive = false;
      this.deps.onUnresponsive?.(false);
    }
  }

  private reply(callId: number, ok: boolean, value?: unknown, error?: string): void {
    this.worker.postMessage({ type: 'reply', callId, ok, value, error });
  }

  private handleCall(call: CallOut): void {
    const settle = (p: Promise<unknown>): void => {
      p.then(
        (value) => this.reply(call.callId, true, value),
        (err: unknown) => this.reply(call.callId, false, undefined, String(err instanceof Error ? err.message : err)),
      );
    };

    const pend = (register: (pc: PendingCall) => void): void => {
      settle(
        new Promise<unknown>((resolve, reject) => {
          register({ method: call.method, resolve, reject: (e) => reject(new Error(e)) });
        }),
      );
    };

    switch (call.method) {
      // -- synchronous, mirror-backed --
      case 'timeNow':
        this.reply(call.callId, true, this.latestSimTime);
        return;
      case 'measurements':
        this.reply(call.callId, true, this.measurementLog.slice());
        return;
      case 'status':
        this.reply(call.callId, true, this.buildStatus());
        return;

      // -- measurement instruments (FIFO by kind) --
      case 'radioLockEarth':
      case 'sunDirection':
      case 'starAttitude':
      case 'angularSeparation': {
        const kind = METHOD_TO_MEASUREMENT_KIND[call.method]!;
        pend((pc) => {
          const q = this.measurementWaiters.get(kind) ?? [];
          q.push(pc);
          this.measurementWaiters.set(kind, q);
          this.postMeasurementCommand(call);
        });
        return;
      }

      // -- ephemeris (requestId echo) --
      case 'ephemerisPosition':
      case 'ephemerisVelocity': {
        const [body, t] = call.args as [BodyId, number];
        const wantVelocity = call.method === 'ephemerisVelocity';
        const requestId = this.nextEphemerisReqId++;
        settle(
          new Promise<unknown>((resolve, reject) => {
            this.ephemerisWaiters.set(requestId, {
              method: call.method,
              resolve: (v) => {
                const r = v as { position: Vector3; velocity: Vector3 };
                resolve(wantVelocity ? r.velocity : r.position);
              },
              reject: (e) => reject(new Error(e)),
            });
            this.deps.postToSim({ type: 'ephemerisQuery', requestId, body, t });
          }),
        );
        return;
      }

      // -- ship commands --
      case 'point':
        pend((pc) => {
          this.pointWaiters.push(pc);
          this.deps.postToSim({ type: 'point', direction: call.args[0] as Vector3 });
        });
        return;
      case 'burn':
        pend((pc) => {
          this.burnWaiters.push(pc);
          const [throttle, duration] = call.args as [number, number];
          this.deps.postToSim({ type: 'burn', throttle, duration });
        });
        return;
      case 'scheduleBurn':
        pend((pc) => {
          this.scheduleWaiters.push(pc);
          const [startTime, direction, throttle, duration] = call.args as [
            number,
            Vector3,
            number,
            number,
          ];
          this.deps.postToSim({ type: 'scheduleBurn', startTime, direction, throttle, duration });
        });
        return;
      case 'cancelBurn': {
        const id = call.args[0] as number;
        pend((pc) => {
          this.cancelWaiters.set(id, pc);
          this.deps.postToSim({ type: 'cancelBurn', id });
        });
        return;
      }

      // -- wait --
      case 'wait': {
        const seconds = call.args[0] as number;
        const target = this.latestSimTime + seconds;
        if (!(seconds > 0)) {
          // No-op wait resolves immediately (time doesn't move).
          this.reply(call.callId, true, undefined);
          return;
        }
        settle(
          new Promise<unknown>((resolve, reject) => {
            this.waitWaiter = { target, call: { method: 'wait', resolve, reject: (e) => reject(new Error(e)) } };
            this.deps.postToSim({ type: 'skipToTime', targetTime: target });
          }),
        );
        return;
      }
    }
  }

  private postMeasurementCommand(call: CallOut): void {
    const cmdType = METHOD_TO_SIM_MEASUREMENT_CMD[call.method]!;
    if (cmdType === 'angularSeparation') {
      const [bodyA, bodyB] = call.args as [BodyId, BodyId];
      this.deps.postToSim({ type: 'angularSeparation', bodyA, bodyB });
    } else {
      this.deps.postToSim({ type: cmdType } as SimCommand);
    }
  }

  private buildStatus(): ShipStatus {
    const maxAccel = this.deps.maxAcceleration ?? DEFAULT_MAX_ACCELERATION;
    return {
      forward: this.latestForward,
      deltaVSpent: this.latestDeltaV,
      burning: this.latestBurning,
      scheduledBurns: [...this.scheduledBurns.values()].sort((a, b) => a.startTime - b.startTime),
      massKg: SHIP_MASS_KG,
      maxAcceleration: maxAccel,
      maxThrustNewtons: SHIP_MASS_KG * maxAccel,
    };
  }

  // ---- sim -> bridge ----

  private onSimEvent = (event: SimEvent): void => {
    switch (event.type) {
      case 'state':
        this.latestSimTime = event.simTime;
        this.latestForward = event.ship.forward;
        this.latestDeltaV = event.ship.deltaVSpent;
        this.latestBurning = event.ship.burning;
        this.resolvePointOnState();
        this.checkWaitProgress(event.simTime);
        return;
      case 'skipProgress':
        this.checkWaitProgress(event.simTime);
        return;
      case 'measurementAdded': {
        const m = event.measurement;
        // Mirror every measurement (page-lifetime log, §7.5). De-dupe on id so
        // an annotate re-emit doesn't double-count.
        const existing = this.measurementLog.findIndex((x) => x.id === m.id);
        if (existing >= 0) {
          this.measurementLog[existing] = m;
        } else {
          this.measurementLog.push(m);
          this.resolveMeasurement(m);
        }
        return;
      }
      case 'burnEnded':
        this.latestDeltaV = event.deltaVSpent;
        this.burnWaiters.shift()?.resolve(undefined);
        return;
      case 'scheduledBurnAdded': {
        const b = event.burn;
        this.scheduledBurns.set(b.id, {
          id: b.id,
          startTime: b.startTime,
          direction: b.direction,
          throttle: b.throttle,
          duration: b.duration,
        });
        this.scheduleWaiters.shift()?.resolve(b.id);
        return;
      }
      case 'scheduledBurnCancelled': {
        this.scheduledBurns.delete(event.id);
        this.cancelWaiters.get(event.id)?.resolve(undefined);
        this.cancelWaiters.delete(event.id);
        return;
      }
      case 'ephemerisResult': {
        const w = this.ephemerisWaiters.get(event.requestId);
        if (w) {
          this.ephemerisWaiters.delete(event.requestId);
          w.resolve({ position: event.position, velocity: event.velocity });
        }
        return;
      }
      case 'interrupted':
      case 'won':
      case 'lost':
        // wait() resolves early — script sees time stopped (§6, ADR-0002).
        this.resolveWaitEarly();
        return;
      case 'error':
        // A sim-side rejection: fail the most recent pending ship command that
        // can error (burn/schedule/cancel/point). Prefer the newest issued.
        this.failPendingOnSimError(event.message);
        return;
    }
  };

  private resolvePointOnState(): void {
    // point() resolves on the next state after the command; each state advances
    // all queued point waiters (a state confirms the attitude change).
    if (this.pointWaiters.length > 0) {
      const waiters = this.pointWaiters;
      this.pointWaiters = [];
      waiters.forEach((p) => p.resolve(undefined));
    }
  }

  private resolveMeasurement(m: Measurement): void {
    const q = this.measurementWaiters.get(m.data.kind);
    if (!q || q.length === 0) return;
    const waiter = q.shift()!;
    if (q.length === 0) this.measurementWaiters.delete(m.data.kind);
    waiter.resolve(this.measurementReturn(m));
  }

  // Shape returned to the script per §8.2 (e.g. radio.lockEarth() returns
  // {rangeMeters, direction, quality, tSent, tReceived}).
  private measurementReturn(m: Measurement): unknown {
    switch (m.data.kind) {
      case 'radioLock':
        return {
          rangeMeters: m.data.rangeMeters,
          direction: m.data.direction,
          quality: m.data.quality,
          tSent: m.data.tSent,
          tReceived: m.data.tReceived,
        };
      case 'sunDirection':
        return m.data.direction;
      case 'starAttitude':
        return { forward: m.data.forward };
      case 'angularSeparation':
        return m.data.radians;
    }
  }

  private checkWaitProgress(simTime: number): void {
    if (this.waitWaiter && simTime >= this.waitWaiter.target - 1e-6) {
      const w = this.waitWaiter;
      this.waitWaiter = null;
      w.call.resolve(undefined);
    }
  }

  private resolveWaitEarly(): void {
    if (this.waitWaiter) {
      const w = this.waitWaiter;
      this.waitWaiter = null;
      w.call.resolve(undefined);
    }
  }

  private failPendingOnSimError(message: string): void {
    // Reject the oldest pending errable command; burns are the common case.
    if (this.burnWaiters.length > 0) {
      this.burnWaiters.shift()!.reject(message);
      return;
    }
    if (this.scheduleWaiters.length > 0) {
      this.scheduleWaiters.shift()!.reject(message);
      return;
    }
    if (this.pointWaiters.length > 0) {
      this.pointWaiters.shift()!.reject(message);
      return;
    }
    // Cancel errors: reject any single outstanding cancel.
    const firstCancel = this.cancelWaiters.keys().next();
    if (!firstCancel.done) {
      this.cancelWaiters.get(firstCancel.value)!.reject(message);
      this.cancelWaiters.delete(firstCancel.value);
    }
  }

  // ---- watchdog (§8.1 runaway protection) ----

  private startWatchdog(): void {
    const wd = this.deps.watchdog;
    if (!wd) return;
    this.lastHeartbeat = wd.now();
    this.watchdogHandle = wd.setInterval(() => this.watchdogTick(), wd.pingIntervalMs);
  }

  private watchdogTick(): void {
    const wd = this.deps.watchdog!;
    this.worker.postMessage({ type: 'ping', nonce: wd.now() });
    const since = wd.now() - this.lastHeartbeat;
    const nowUnresponsive = since > wd.unresponsiveAfterMs;
    if (nowUnresponsive !== this.unresponsive) {
      this.unresponsive = nowUnresponsive;
      this.deps.onUnresponsive?.(nowUnresponsive);
    }
  }

  private onHeartbeat(): void {
    if (this.deps.watchdog) {
      this.lastHeartbeat = this.deps.watchdog.now();
    }
    if (this.unresponsive) {
      this.unresponsive = false;
      this.deps.onUnresponsive?.(false);
    }
  }

  private stopWatchdog(): void {
    if (this.watchdogHandle !== null && this.deps.watchdog) {
      this.deps.watchdog.clearInterval(this.watchdogHandle);
      this.watchdogHandle = null;
    }
  }
}
