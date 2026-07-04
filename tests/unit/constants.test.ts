import { describe, expect, it } from 'vitest';
import { AU, C, MU_EARTH, MU_MOON, MU_SUN, SHIP_MASS_KG } from '../../src/core/constants';

describe('constants', () => {
  it('exposes the expected physical constants', () => {
    expect(C).toBe(299_792_458);
    expect(MU_SUN).toBeGreaterThan(MU_EARTH);
    expect(MU_EARTH).toBeGreaterThan(MU_MOON);
    expect(AU).toBeGreaterThan(0);
    expect(SHIP_MASS_KG).toBe(12_000);
  });
});
