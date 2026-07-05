// Shared types for the render layer. Deliberately decoupled from src/sim —
// see the Phase 7 task boundary: this module defines its own input contract
// so it doesn't import anything from the sim worker (built in parallel).
import type { Vector3 } from '../core/vector3';
import type { BodyId } from '../core/ephemerisTypes';

export type { BodyId };

// Minimal per-frame state the render layer needs. Produced by whatever feeds
// it (main.ts, adapting sim-worker events) — this module never assumes a
// live sim worker or DOM beyond the canvas it's given.
export interface RenderFrameState {
  readonly time: number; // sim time, unix seconds (receive time t_now)
  readonly shipPosition: Vector3; // heliocentric ecliptic meters
  readonly shipForward: Vector3; // unit vector, inertial frame
}

export type IdentifiedKind = 'star' | 'body';

export interface IdentifiedObject {
  readonly kind: IdentifiedKind;
  readonly id: string; // stable key: body id, or "star:<index>"
  readonly name: string | null;
  readonly bodyId?: BodyId;
}

// Injected instrument seam the Telescope UI calls into (mvp0_spec.md §7.1,
// §8.2 telescope.angularSeparation). Main-thread wiring (done by the
// orchestrator) adapts real sim-worker measurement events into this shape.
export interface TelescopeInstruments {
  measureAngularSeparation(bodyA: BodyId, bodyB: BodyId): Promise<{ radians: number; id: string }>;
}
