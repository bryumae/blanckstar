// The simulation core (mvp0_spec.md §2, §4, §5, §6). Owns the truth: ship
// state, sim clock, burns, and the win/lose verdict. It is deliberately
// worker-agnostic — every side effect goes through the injected `emit` seam
// (messages.EmitFn) — so tests pump it synchronously with no worker globals or
// DOM (see ADR-0001). The wall-clock pacing of warp lives in driver.ts, on top
// of the `stepOnce` primitive here.
import type { State } from '../core/rk4';
import type { EphemerisData, BodyId } from '../core/ephemerisTypes';
import type { Vector3 } from '../core/vector3';
import { normalize, sub, norm } from '../core/vector3';
import { positionAt, velocityAt } from '../core/ephemerisInterp';
import { selectTimestep, stepToBoundary } from '../core/timestep';
import { isCaptured, failureCheck } from '../core/winLose';
import type { FailureReason } from '../core/winLose';
import { orbitalElementsFromState } from '../core/orbitalElements';
import { MU_EARTH, MAX_ACCELERATION, R_SOI_EARTH } from '../core/constants';
import type { EmitFn } from './messages';
import { BODY_IDS } from './types';
import type { InterruptReason, ScenarioSeed, ShipState, WarpFactor } from './types';
import { BurnManager, deltaVForSubstep } from './burns';
import { gravitatingBodiesAt, advance } from './physics';
import {
  MeasurementLog,
  radioLockEarth,
  sunDirection,
  starAttitude,
  angularSeparation,
} from './instruments';

// Outcome of a single stepOnce call. `interrupt` (when set) means warp/skip must
// stop and drop to pause; `over` means the game ended (win or lose) and no
// further stepping should occur until reset.
export interface StepResult {
  readonly interrupt: InterruptReason | null;
  readonly over: boolean;
}

const NO_STEP: StepResult = { interrupt: null, over: false };

export class Simulation {
  private ephemeris: EphemerisData | null = null;
  private seed: ScenarioSeed | null = null;
  private maxAcceleration = MAX_ACCELERATION;

  private state: State = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
  private forward: Vector3 = { x: 1, y: 0, z: 0 };
  private deltaVSpent = 0;
  private simTime = 0;
  private warp: WarpFactor = 0;

  private over = false; // win or lose reached; stepping halts until reset
  private insideSOI = false; // for inward-crossing edge detection

  // DEBUG diagnostics (§10): integrator counters surfaced on the state stream.
  // `substepsLastTick` counts stepOnce calls since the last emitState, then
  // resets — it approximates "substeps executed this tick" for whatever cadence
  // the caller emits state at (a driver tick or a single stepOnce+emit in tests).
  private lastDt = 0;
  private substepsSinceEmit = 0;
  private totalSteps = 0;

  private readonly burns = new BurnManager();
  private readonly log = new MeasurementLog();

  constructor(private readonly emit: EmitFn) {}

  // ---- lifecycle ----

  init(ephemeris: EphemerisData, seed: ScenarioSeed): void {
    this.ephemeris = ephemeris;
    this.seed = seed;
    this.reset();
  }

  // Restart from the seed; clears measurement log, burns, Δv, warp (§2.3).
  // Emits `ready` + the initial state so every consumer (shell, data, telescope,
  // and the sandbox bridge's `simEnded` guard) re-initializes identically to a
  // fresh init — a plain reset used to emit only `state`, silently stranding
  // those `ready`-keyed resets on "Retry same seed".
  reset(): void {
    const seed = this.requireSeed();
    this.maxAcceleration = seed.maxAcceleration ?? MAX_ACCELERATION;
    this.state = { position: seed.position, velocity: seed.velocity };
    // Initial attitude: forward = normalized velocity (a sane, documented default
    // so the first burn without an explicit point() thrusts prograde; §5.1).
    this.forward = norm(seed.velocity) === 0 ? { x: 1, y: 0, z: 0 } : normalize(seed.velocity);
    this.deltaVSpent = 0;
    this.simTime = seed.epoch;
    this.warp = 0;
    this.over = false;
    this.burns.reset();
    this.log.reset();
    this.insideSOI = this.computeInsideSOI();
    this.lastDt = 0;
    this.substepsSinceEmit = 0;
    this.totalSteps = 0;
    this.emit({ type: 'ready', seedId: seed.id, epoch: seed.epoch });
    this.emitState();
  }

  // ---- accessors (used by the driver and tests) ----

  getSimTime(): number {
    return this.simTime;
  }

  getWarp(): WarpFactor {
    return this.warp;
  }

  isOver(): boolean {
    return this.over;
  }

  // ---- ship commands ----

  point(direction: Vector3): void {
    if (norm(direction) === 0) {
      this.emit({ type: 'error', message: 'point: zero-length direction', command: 'point' });
      return;
    }
    this.forward = normalize(direction);
    this.emitState();
  }

  // Start a burn now for `duration` seconds at `throttle` along current forward.
  burn(throttle: number, duration: number): void {
    if (!this.validateBurnParams(throttle, duration, 'burn')) {
      return;
    }
    if (!this.burns.isWindowFree(this.simTime, duration)) {
      this.emit({ type: 'error', message: 'burn: overlaps an active or scheduled burn', command: 'burn' });
      return;
    }
    const active = this.burns.startActive(this.simTime, throttle, duration, this.forward, null);
    this.emit({
      type: 'burnStarted',
      startTime: active.startTime,
      endTime: active.endTime,
      throttle: active.throttle,
      scheduledId: null,
    });
    this.emitState();
  }

  scheduleBurn(startTime: number, direction: Vector3, throttle: number, duration: number): void {
    if (!this.validateBurnParams(throttle, duration, 'scheduleBurn')) {
      return;
    }
    if (startTime < this.simTime) {
      this.emit({ type: 'error', message: 'scheduleBurn: startTime is in the past', command: 'scheduleBurn' });
      return;
    }
    if (norm(direction) === 0) {
      this.emit({ type: 'error', message: 'scheduleBurn: zero-length direction', command: 'scheduleBurn' });
      return;
    }
    if (!this.burns.isWindowFree(startTime, duration)) {
      this.emit({ type: 'error', message: 'scheduleBurn: overlaps an active or scheduled burn', command: 'scheduleBurn' });
      return;
    }
    const burn = this.burns.schedule(startTime, direction, throttle, duration);
    this.emit({ type: 'scheduledBurnAdded', burn });
  }

  // DEBUG-only (§10): force ship position/velocity, e.g. from the debug map's
  // teleport form. No-op when uninitialized or the game is already over,
  // matching every other ship command's guard. Recomputes the SOI edge-detect
  // flag from the new position so a teleport across the SOI boundary doesn't
  // spuriously fire (or miss) the inward-crossing interrupt on the next step.
  debugTeleport(position: Vector3, velocity: Vector3): void {
    if (!this.ephemeris || !this.seed || this.over) {
      return;
    }
    this.state = { position, velocity };
    this.insideSOI = this.computeInsideSOI();
    this.emitState();
  }

  cancelBurn(id: number): void {
    if (this.burns.cancel(id)) {
      this.emit({ type: 'scheduledBurnCancelled', id });
    } else {
      this.emit({ type: 'error', message: `cancelBurn: no scheduled burn ${id}`, command: 'cancelBurn' });
    }
  }

  // Shared by burn() and scheduleBurn(); `command` tags the emitted error so the
  // bridge can route the rejection to the right waiter (§8.2 correlation).
  private validateBurnParams(throttle: number, duration: number, command: 'burn' | 'scheduleBurn'): boolean {
    if (!(throttle >= 0 && throttle <= 1)) {
      this.emit({ type: 'error', message: 'burn: throttle must be in [0,1]', command });
      return false;
    }
    if (!(duration > 0)) {
      this.emit({ type: 'error', message: 'burn: duration must be positive', command });
      return false;
    }
    return true;
  }

  // ---- instruments ----

  measureRadioLockEarth(): void {
    const data = radioLockEarth(this.requireEphemeris(), this.state.position, this.simTime);
    this.emit({ type: 'measurementAdded', measurement: this.log.add(this.simTime, data) });
  }

  measureSunDirection(): void {
    const data = sunDirection(this.requireEphemeris(), this.state.position, this.simTime);
    this.emit({ type: 'measurementAdded', measurement: this.log.add(this.simTime, data) });
  }

  measureStarAttitude(): void {
    const data = starAttitude(this.forward);
    this.emit({ type: 'measurementAdded', measurement: this.log.add(this.simTime, data) });
  }

  measureAngularSeparation(bodyA: BodyId, bodyB: BodyId): void {
    const data = angularSeparation(this.requireEphemeris(), this.state.position, this.simTime, bodyA, bodyB);
    this.emit({ type: 'measurementAdded', measurement: this.log.add(this.simTime, data) });
  }

  annotateMeasurement(id: number, note: string): void {
    const entry = this.log.annotate(id, note);
    if (entry) {
      this.emit({ type: 'measurementAdded', measurement: entry });
    } else {
      this.emit({ type: 'error', message: `annotateMeasurement: no measurement ${id}`, command: 'annotateMeasurement' });
    }
  }

  ephemerisQuery(requestId: number, body: BodyId, t: number): void {
    const eph = this.requireEphemeris();
    this.emit({
      type: 'ephemerisResult',
      requestId,
      position: positionAt(eph, body, t),
      velocity: velocityAt(eph, body, t),
    });
  }

  // ---- time control ----

  setWarp(factor: WarpFactor): void {
    this.warp = factor;
    this.emitState();
  }

  // One integration substep. Fires a due scheduled burn (interrupt), advances by
  // a boundary-snapped dt no larger than `maxDt` (the driver's remaining budget;
  // Infinity for skip), ends the active burn on its boundary, then checks
  // SOI-entry / win / lose. Returns the resulting StepResult. No-op once over.
  stepOnce(maxDt: number): StepResult {
    if (this.over) {
      return NO_STEP;
    }

    // A scheduled burn due now: re-point, start thrust, interrupt warp/skip
    // (§6). We snap steps onto scheduled starts, so "due" means startTime <= now.
    const due = this.burns.takeDue(this.simTime);
    if (due) {
      this.forward = due.direction;
      const active = this.burns.startActive(this.simTime, due.throttle, due.duration, due.direction, due.id);
      this.emit({
        type: 'burnStarted',
        startTime: active.startTime,
        endTime: active.endTime,
        throttle: active.throttle,
        scheduledId: due.id,
      });
      // A scheduled burn auto-interrupts warp/skip (§6), so zero the warp and
      // re-emit state — mirroring the SOI/win/lose interrupt paths in
      // checkVerdict(). Without this the driver stops ticking but leaves
      // `warp` non-zero, so the shell shows an active warp while time is frozen
      // until the user re-selects a factor.
      this.warp = 0;
      this.emitState();
      return { interrupt: 'scheduled-burn', over: false };
    }

    const eph = this.requireEphemeris();
    const bodies = gravitatingBodiesAt(eph, this.simTime);
    const baseDt = selectTimestep(this.state.position, bodies);
    const boundaries = this.burns.boundaries(this.simTime);
    let dt = stepToBoundary(this.simTime, baseDt, boundaries);
    if (dt > maxDt) {
      dt = maxDt;
    }

    const active = this.burns.getActive();
    const burning = active !== null;
    const thrust = this.burns.thrust(this.maxAcceleration);

    this.state = advance(eph, this.state, this.simTime, dt, thrust);
    this.simTime += dt;
    this.lastDt = dt; // DEBUG diagnostics
    this.substepsSinceEmit += 1;
    this.totalSteps += 1;
    if (burning && active) {
      this.deltaVSpent += deltaVForSubstep(active.throttle, this.maxAcceleration, dt);
    }

    // End the active burn if we've reached its end boundary (snapped exactly).
    if (active && this.simTime >= active.endTime) {
      this.burns.endActive();
      this.emit({
        type: 'burnEnded',
        endTime: this.simTime,
        deltaVSpent: this.deltaVSpent,
        scheduledId: active.scheduledId,
      });
    }

    return this.checkVerdict();
  }

  // Skip-to-time (§6): step as fast as possible to targetTime, chunked so the
  // worker stays responsive, emitting skipProgress and stopping on any
  // interrupt/verdict. Steps are snapped onto targetTime too. Returns the final
  // StepResult of the run.
  skipToTime(targetTime: number, chunkSteps = 2000): StepResult {
    // Already over: the terminal won/lost was emitted when the game ended; a
    // caller (e.g. the sandbox wait() bridge) tracks that separately.
    if (this.over) {
      return NO_STEP;
    }
    // Target already reached: no stepping to do, but still surface a completed
    // skipProgress so a waiter keyed to a past/now target resolves rather than
    // hanging on an event that would otherwise never come (§8.2 wait()).
    if (targetTime <= this.simTime) {
      this.emit({ type: 'skipProgress', simTime: this.simTime, fraction: 1 });
      return NO_STEP;
    }
    const startTime = this.simTime;
    const span = targetTime - startTime;
    let steps = 0;
    let last: StepResult = NO_STEP;
    while (this.simTime < targetTime && !this.over) {
      const maxDt = targetTime - this.simTime;
      last = this.stepOnce(maxDt);
      // A win/lose verdict already emitted won/lost + a final state in
      // checkVerdict; stop here without also emitting a spurious `interrupted`
      // (which the shell would render as "Interrupted: win" beside the modal).
      if (last.over) {
        return last;
      }
      if (last.interrupt) {
        this.warp = 0;
        this.emit({ type: 'interrupted', reason: last.interrupt, simTime: this.simTime });
        this.emitState();
        return last;
      }
      if (++steps % chunkSteps === 0) {
        this.emit({ type: 'skipProgress', simTime: this.simTime, fraction: (this.simTime - startTime) / span });
      }
    }
    this.emit({ type: 'skipProgress', simTime: this.simTime, fraction: 1 });
    this.emitState();
    return last;
  }

  // ---- verdict + interrupt detection ----

  private checkVerdict(): StepResult {
    const eph = this.requireEphemeris();
    const earthPos = positionAt(eph, 'earth', this.simTime);
    const earthVel = velocityAt(eph, 'earth', this.simTime);
    const moonPos = positionAt(eph, 'moon', this.simTime);
    const sunPos = positionAt(eph, 'sun', this.simTime);

    const failure: FailureReason | null = failureCheck(this.state.position, earthPos, moonPos, sunPos);
    if (failure) {
      this.over = true;
      this.warp = 0;
      this.emit({ type: 'lost', reason: failure, simTime: this.simTime });
      this.emitState();
      return { interrupt: 'lose', over: true };
    }

    const earthState: State = { position: earthPos, velocity: earthVel };
    if (isCaptured(this.state, earthState)) {
      this.over = true;
      this.warp = 0;
      const orbit = orbitalElementsFromState(
        this.state.position,
        this.state.velocity,
        MU_EARTH,
        earthPos,
        earthVel,
      );
      this.emit({
        type: 'won',
        stats: { missionElapsed: this.simTime - this.requireSeed().epoch, deltaVSpent: this.deltaVSpent, orbit },
      });
      this.emitState();
      return { interrupt: 'win', over: true };
    }

    // Earth SOI inward crossing (§6): interrupt only on the outside->inside edge.
    const nowInside = norm(sub(this.state.position, earthPos)) < R_SOI_EARTH;
    const crossedInward = nowInside && !this.insideSOI;
    this.insideSOI = nowInside;
    if (crossedInward) {
      this.warp = 0;
      this.emit({ type: 'interrupted', reason: 'earth-soi-entry', simTime: this.simTime });
      this.emitState();
      return { interrupt: 'earth-soi-entry', over: false };
    }

    return NO_STEP;
  }

  private computeInsideSOI(): boolean {
    const eph = this.requireEphemeris();
    const earthPos = positionAt(eph, 'earth', this.simTime);
    return norm(sub(this.state.position, earthPos)) < R_SOI_EARTH;
  }

  // ---- state stream (§5.1 truth emission) ----

  emitState(): void {
    const eph = this.requireEphemeris();
    const bodies = {} as Record<BodyId, Vector3>;
    for (const id of BODY_IDS) {
      bodies[id] = positionAt(eph, id, this.simTime);
    }
    const active = this.burns.getActive();
    const ship: ShipState = {
      position: this.state.position,
      velocity: this.state.velocity,
      forward: this.forward,
      deltaVSpent: this.deltaVSpent,
      burning: active !== null,
    };
    this.emit({
      type: 'state',
      simTime: this.simTime,
      missionElapsed: this.simTime - this.requireSeed().epoch,
      warp: this.warp,
      ship,
      bodies,
      debug: { lastDt: this.lastDt, substepsLastTick: this.substepsSinceEmit, totalSteps: this.totalSteps },
    });
    this.substepsSinceEmit = 0; // DEBUG diagnostics: reset the per-emit counter
  }

  private requireEphemeris(): EphemerisData {
    if (!this.ephemeris) {
      throw new Error('Simulation: not initialized (no ephemeris)');
    }
    return this.ephemeris;
  }

  private requireSeed(): ScenarioSeed {
    if (!this.seed) {
      throw new Error('Simulation: not initialized (no seed)');
    }
    return this.seed;
  }
}
