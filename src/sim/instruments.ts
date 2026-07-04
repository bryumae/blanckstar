// Instrument models + the append-only measurement log (mvp0_spec.md §7.2, §7.3,
// §7.5). Each instrument is a pure function of the current ship state, sim time,
// and ephemeris; taking a measurement appends an id'd, timestamped entry to the
// log. The GUI Data screen and the script API both drive these same models — a
// radio lock from either path is the same measurement type in the same log
// (§1 "the GUI screens and the script API read the same underlying instrument
// models").
import type { EphemerisData, BodyId } from '../core/ephemerisTypes';
import type { Vector3 } from '../core/vector3';
import { sub, norm, normalize, angleBetween } from '../core/vector3';
import { positionAt } from '../core/ephemerisInterp';
import { solveEmissionTime, apparentDirection } from '../core/lightTime';
import { C } from '../core/constants';
import type {
  Measurement,
  MeasurementData,
  RadioLockData,
  SunDirectionData,
  StarAttitudeData,
  AngularSeparationData,
} from './types';

// Radio lock on the Earth beacon (§7.2). Light-time honest: solve for the
// emission time such that light from Earth's position then reaches the ship now;
// range = c*(tNow - tEmit); direction = unit vector to Earth-at-emit.
export function radioLockEarth(ephemeris: EphemerisData, shipPosition: Vector3, tNow: number): RadioLockData {
  const sol = solveEmissionTime((t) => positionAt(ephemeris, 'earth', t), shipPosition, tNow);
  const toEarth = sub(sol.position, shipPosition);
  const direction = sol.distance === 0 ? { x: 0, y: 0, z: 0 } : normalize(toEarth);
  return {
    kind: 'radioLock',
    body: 'earth',
    rangeMeters: C * (tNow - sol.tEmit),
    direction,
    quality: 1, // cosmetic constant in MVP0 (§7.2)
    tSent: sol.tEmit,
    tReceived: tNow,
  };
}

// Exact ship -> Sun unit vector, now (§7.3, §7.5).
export function sunDirection(ephemeris: EphemerisData, shipPosition: Vector3, tNow: number): SunDirectionData {
  const toSun = sub(positionAt(ephemeris, 'sun', tNow), shipPosition);
  return { kind: 'sunDirection', direction: norm(toSun) === 0 ? { x: 0, y: 0, z: 0 } : normalize(toSun) };
}

// Ship attitude / forward vector from the star tracker (§7.3).
export function starAttitude(forward: Vector3): StarAttitudeData {
  return { kind: 'starAttitude', forward };
}

// Angular separation between two bodies' apparent (light-time-corrected)
// directions from the ship (§7.1). θ = arccos(u_A · u_B), exact.
export function angularSeparation(
  ephemeris: EphemerisData,
  shipPosition: Vector3,
  tNow: number,
  bodyA: BodyId,
  bodyB: BodyId,
): AngularSeparationData {
  const a = apparentDirection((t) => positionAt(ephemeris, bodyA, t), shipPosition, tNow);
  const b = apparentDirection((t) => positionAt(ephemeris, bodyB, t), shipPosition, tNow);
  return {
    kind: 'angularSeparation',
    bodyA,
    bodyB,
    radians: angleBetween(a.direction, b.direction),
  };
}

// Append-only, id'd, timestamped measurement log (§7.5). Resets with the sim.
export class MeasurementLog {
  private entries: Measurement[] = [];
  private nextId = 1;

  reset(): void {
    this.entries = [];
    this.nextId = 1;
  }

  // Append a measurement taken at simTime; returns the stored entry.
  add(simTime: number, data: MeasurementData): Measurement {
    const entry: Measurement = { id: this.nextId++, simTime, data };
    this.entries.push(entry);
    return entry;
  }

  all(): readonly Measurement[] {
    return this.entries;
  }

  // Attach/replace a note on an entry. Returns the updated entry, or null if the
  // id is unknown.
  annotate(id: number, note: string): Measurement | null {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) {
      return null;
    }
    const updated: Measurement = { ...this.entries[idx]!, note };
    this.entries[idx] = updated;
    return updated;
  }
}
