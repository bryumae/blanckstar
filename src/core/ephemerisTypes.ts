// TypeScript types for the offline-generated ephemeris JSON (mvp0_spec.md §4.5).
// The data-generation script (scripts/generateEphemeris.ts) emits this exact
// shape; the runtime consumes it read-only. Frame: heliocentric ecliptic J2000,
// SI units (meters, m/s), time in unix seconds.

export type BodyId = 'sun' | 'earth' | 'moon' | 'mars' | 'venus' | 'jupiter';

// One state sample: [x, y, z, vx, vy, vz].
export type StateSample = readonly [number, number, number, number, number, number];

// Uniformly-spaced samples for a single body: sample i is at time t0 + i*dt.
export interface BodyEphemeris {
  readonly t0: number; // unix seconds of sample 0
  readonly dt: number; // seconds between samples (86400 for planets, 3600 for the Moon)
  readonly samples: readonly StateSample[];
}

export interface EphemerisUnits {
  readonly position: string;
  readonly velocity: string;
  readonly time: string;
}

export interface EphemerisData {
  readonly frame: string;
  readonly units: EphemerisUnits;
  readonly bodies: Readonly<Partial<Record<BodyId, BodyEphemeris>>>;
}
