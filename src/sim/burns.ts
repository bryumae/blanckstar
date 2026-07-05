// Burn bookkeeping for the simulation worker (mvp0_spec.md §5.2, §5.3).
//
// The ship has one forward-only engine, so at most one burn thrusts at any
// instant. This module tracks the single active (live) burn plus a set of
// future scheduled burns, and answers three questions the stepping loop needs:
//   - what step boundaries must be snapped onto (burn starts/ends),
//   - what thrust vector applies over the substep starting at time t,
//   - is a proposed new burn's [start,end) window free (overlap policy).
//
// Overlap policy (documented in ADR-0001): a new live `burn` or `scheduleBurn`
// is REJECTED if its [start, start+duration) window overlaps the active burn or
// any scheduled burn. The engine is single and forward-only; silently queueing
// or blending burns would be a physics lie. Rejection surfaces as an `error`
// event so the caller can reschedule.
import type { Vector3 } from '../core/vector3';
import { normalize, mul } from '../core/vector3';
import type { ScheduledBurn } from './types';

// An in-flight burn: fixed forward direction, throttle, and end time.
export interface ActiveBurn {
  readonly startTime: number;
  readonly endTime: number;
  readonly throttle: number;
  readonly forward: Vector3; // unit vector locked at burn start
  readonly scheduledId: number | null; // the scheduled handle this came from
}

// A half-open time window [start, end).
interface Window {
  readonly start: number;
  readonly end: number;
}

function overlaps(a: Window, b: Window): boolean {
  return a.start < b.end && b.start < a.end;
}

export class BurnManager {
  private active: ActiveBurn | null = null;
  private scheduled: ScheduledBurn[] = [];
  private nextId = 1;

  reset(): void {
    this.active = null;
    this.scheduled = [];
    this.nextId = 1;
  }

  getActive(): ActiveBurn | null {
    return this.active;
  }

  getScheduled(): readonly ScheduledBurn[] {
    return this.scheduled;
  }

  // Windows already committed (active + scheduled) that a new burn must miss.
  private committedWindows(): Window[] {
    const windows: Window[] = [];
    if (this.active) {
      windows.push({ start: this.active.startTime, end: this.active.endTime });
    }
    for (const s of this.scheduled) {
      windows.push({ start: s.startTime, end: s.startTime + s.duration });
    }
    return windows;
  }

  // True if [start, start+duration) is free of every committed burn window.
  isWindowFree(start: number, duration: number): boolean {
    const w: Window = { start, end: start + duration };
    return !this.committedWindows().some((c) => overlaps(w, c));
  }

  // Start a live burn now, locking the given forward vector. Caller must have
  // checked isWindowFree first. Returns the created ActiveBurn.
  startActive(now: number, throttle: number, duration: number, forward: Vector3, scheduledId: number | null): ActiveBurn {
    const burn: ActiveBurn = {
      startTime: now,
      endTime: now + duration,
      throttle,
      forward: normalize(forward),
      scheduledId,
    };
    this.active = burn;
    return burn;
  }

  endActive(): void {
    this.active = null;
  }

  // Register a scheduled burn, returning the handle with its assigned id.
  schedule(startTime: number, direction: Vector3, throttle: number, duration: number): ScheduledBurn {
    const burn: ScheduledBurn = {
      id: this.nextId++,
      startTime,
      direction: normalize(direction),
      throttle,
      duration,
    };
    this.scheduled.push(burn);
    return burn;
  }

  // Remove a scheduled burn by id. Returns true if one was removed.
  cancel(id: number): boolean {
    const before = this.scheduled.length;
    this.scheduled = this.scheduled.filter((s) => s.id !== id);
    return this.scheduled.length !== before;
  }

  // Remove and return the first scheduled burn whose startTime <= t, if any.
  // Used by the stepping loop when a scheduled-burn boundary is reached.
  takeDue(t: number): ScheduledBurn | null {
    const idx = this.scheduled.findIndex((s) => s.startTime <= t);
    if (idx === -1) {
      return null;
    }
    const [burn] = this.scheduled.splice(idx, 1);
    return burn ?? null;
  }

  // Step boundaries strictly ahead of `now`: the active burn's end, and every
  // scheduled burn's start. These get snapped onto step edges (§4.4).
  boundaries(now: number): number[] {
    const bounds: number[] = [];
    if (this.active && this.active.endTime > now) {
      bounds.push(this.active.endTime);
    }
    for (const s of this.scheduled) {
      if (s.startTime > now) {
        bounds.push(s.startTime);
      }
    }
    return bounds;
  }

  // Thrust acceleration vector applied over a substep, given the engine's max
  // acceleration. Zero when no burn is active.
  thrust(maxAcceleration: number): Vector3 {
    if (!this.active) {
      return { x: 0, y: 0, z: 0 };
    }
    return mul(this.active.forward, this.active.throttle * maxAcceleration);
  }
}

// Δv accumulated over a substep of length dt while burning (§5.2:
// Δv = throttle * maxAccel * burned-time).
export function deltaVForSubstep(throttle: number, maxAcceleration: number, dt: number): number {
  return throttle * maxAcceleration * dt;
}
