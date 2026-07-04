import { describe, expect, it } from 'vitest';
import {
  formatMagnitudeKm,
  formatMagnitudeKmPerSec,
  formatMissionElapsed,
  formatNumber,
  formatSimTimeUtc,
  formatVectorKm,
  formatVectorKmPerSec,
  formatVectorRawMeters,
  formatVectorUnit,
  metersPerSecToKmPerSec,
  metersToKm,
} from '../../src/ui/debug/format';

describe('numeric formatting (§10)', () => {
  it('formatNumber fixes decimals', () => {
    expect(formatNumber(1.23456, 2)).toBe('1.23');
    expect(formatNumber(1, 3)).toBe('1.000');
  });

  it('metersToKm / metersPerSecToKmPerSec divide by 1000', () => {
    expect(metersToKm(1500)).toBe(1.5);
    expect(metersPerSecToKmPerSec(2500)).toBe(2.5);
  });

  it('formatVectorKm renders km with a unit suffix', () => {
    expect(formatVectorKm({ x: 1000, y: -2000, z: 0 }, 1)).toBe('(1.0, -2.0, 0.0) km');
  });

  it('formatVectorKmPerSec renders km/s with a unit suffix', () => {
    expect(formatVectorKmPerSec({ x: 1000, y: 0, z: 0 }, 1)).toBe('(1.0, 0.0, 0.0) km/s');
  });

  it('formatVectorRawMeters renders raw meters', () => {
    expect(formatVectorRawMeters({ x: 1.5, y: 2.5, z: -3.5 }, 1)).toBe('(1.5, 2.5, -3.5) m');
  });

  it('formatVectorUnit renders bare components with no unit suffix', () => {
    expect(formatVectorUnit({ x: 1, y: 0, z: 0 }, 2)).toBe('(1.00, 0.00, 0.00)');
  });

  it('formatMagnitudeKm / formatMagnitudeKmPerSec compute the norm in km', () => {
    expect(formatMagnitudeKm({ x: 3000, y: 4000, z: 0 }, 1)).toBe('5.0 km');
    expect(formatMagnitudeKmPerSec({ x: 3000, y: 4000, z: 0 }, 1)).toBe('5.0 km/s');
  });
});

describe('time formatting (§10, §6 UTC rule)', () => {
  it('formatSimTimeUtc renders a UTC ISO-ish timestamp', () => {
    expect(formatSimTimeUtc(0)).toBe('1970-01-01 00:00:00 Z');
    expect(formatSimTimeUtc(1_756_684_800)).toBe(new Date(1_756_684_800 * 1000).toISOString().slice(0, 10) + ' ' + new Date(1_756_684_800 * 1000).toISOString().slice(11, 19) + ' Z');
  });

  it('formatMissionElapsed renders Dd HH:MM:SS', () => {
    expect(formatMissionElapsed(0)).toBe('0d 00:00:00');
    expect(formatMissionElapsed(90061)).toBe('1d 01:01:01'); // 1 day, 1h, 1m, 1s
    expect(formatMissionElapsed(-5)).toBe('0d 00:00:00'); // clamps negative
  });
});
