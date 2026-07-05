import { describe, expect, it } from 'vitest';
import { computeBodyPlacement, MIN_RESOLVABLE_ANGULAR_SIZE } from '../../../src/render/bodies';
import type { EphemerisData } from '../../../src/core/ephemerisTypes';
import { norm } from '../../../src/core/vector3';

// Minimal synthetic ephemeris: sun at origin (stationary), earth on a fixed
// point far away (also stationary — light-time is small relative to the
// coverage window so a wide t0/dt/samples window is enough to interpolate
// near tNow without needing real orbital motion for this unit test).
function makeEphemeris(): EphemerisData {
  const t0 = 0;
  const dt = 86400;
  const sunSample: readonly [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const earthPos = { x: 1.5e11, y: 0, z: 0 };
  const earthSample: readonly [number, number, number, number, number, number] = [
    earthPos.x,
    earthPos.y,
    earthPos.z,
    0,
    0,
    0,
  ];
  return {
    frame: 'heliocentric-ecliptic-j2000',
    units: { position: 'm', velocity: 'm/s', time: 's' },
    bodies: {
      sun: { t0, dt, samples: [sunSample, sunSample] },
      earth: { t0, dt, samples: [earthSample, earthSample] },
    },
  };
}

describe('computeBodyPlacement', () => {
  it('gives the sun a direction/distance consistent with light-time to a distant ship', () => {
    const ephemeris = makeEphemeris();
    const shipPosition = { x: 1.4e11, y: 0, z: 0 }; // near earth, off to the side of the sun
    const placement = computeBodyPlacement(ephemeris, 'sun', shipPosition, 1000);
    expect(norm(placement.direction)).toBeCloseTo(1, 6);
    // Sun and earth and ship are stationary here, so distance should equal
    // the straight-line distance exactly (light-time solve converges to the
    // static case).
    expect(placement.distance).toBeCloseTo(1.4e11, -2);
    expect(placement.brightness).toBeGreaterThan(0);
  });

  it('marks a nearby large body as resolvable and a far small one as not', () => {
    const ephemeris = makeEphemeris();
    // tNow well inside the sample window so the emission-time solve (which
    // looks slightly earlier than tNow) stays within ephemeris coverage.
    const tNow = 40000;
    const closeShip = { x: 1.5e11 - 1e7, y: 0, z: 0 }; // very close to earth
    const placementClose = computeBodyPlacement(ephemeris, 'earth', closeShip, tNow);
    expect(placementClose.angularSizeRad).toBeGreaterThan(MIN_RESOLVABLE_ANGULAR_SIZE);
    expect(placementClose.resolvable).toBe(true);

    const farShip = { x: -1.5e11, y: 0, z: 0 }; // far side of the sun from earth
    const placementFar = computeBodyPlacement(ephemeris, 'earth', farShip, tNow);
    expect(placementFar.angularSizeRad).toBeLessThan(MIN_RESOLVABLE_ANGULAR_SIZE);
    expect(placementFar.resolvable).toBe(false);
  });

  it('gives earth a brightness that responds to phase (full vs. new)', () => {
    const ephemeris = makeEphemeris();
    // Ship on the sun-ward side of earth (near-full phase as seen from ship
    // looking back toward the sun through earth's near side).
    const shipNear = { x: 1.4e11, y: 0, z: 0 };
    const placementNear = computeBodyPlacement(ephemeris, 'earth', shipNear, 1000);

    // Ship on the far side of earth from the sun (dark side facing the ship).
    const shipFar = { x: 1.6e11, y: 0, z: 0 };
    const placementFar = computeBodyPlacement(ephemeris, 'earth', shipFar, 1000);

    expect(placementNear.brightness).toBeGreaterThan(placementFar.brightness);
  });
});
