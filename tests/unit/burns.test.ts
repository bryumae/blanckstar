import { describe, expect, it } from 'vitest';
import { BurnManager, deltaVForSubstep } from '../../src/sim/burns';
import { MAX_ACCELERATION } from '../../src/core/constants';
import { norm } from '../../src/core/vector3';

describe('BurnManager', () => {
  it('assigns incrementing ids and normalizes scheduled directions', () => {
    const m = new BurnManager();
    const a = m.schedule(100, { x: 3, y: 0, z: 0 }, 0.5, 10);
    const b = m.schedule(200, { x: 0, y: 4, z: 0 }, 0.5, 10);
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(norm(a.direction)).toBeCloseTo(1, 12);
    expect(a.direction).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('detects overlapping windows (half-open [start,end))', () => {
    const m = new BurnManager();
    m.schedule(100, { x: 1, y: 0, z: 0 }, 0.5, 50); // [100,150)
    expect(m.isWindowFree(150, 10)).toBe(true); // abuts, does not overlap
    expect(m.isWindowFree(149, 10)).toBe(false); // overlaps
    expect(m.isWindowFree(60, 40)).toBe(true); // ends exactly at 100
    expect(m.isWindowFree(60, 41)).toBe(false); // crosses into 100
  });

  it('boundaries lists active-end and future scheduled starts strictly ahead', () => {
    const m = new BurnManager();
    m.startActive(0, 0.5, 30, { x: 1, y: 0, z: 0 }, null); // end 30
    m.schedule(100, { x: 1, y: 0, z: 0 }, 0.5, 10);
    m.schedule(5, { x: 1, y: 0, z: 0 }, 0.5, 10); // starts before now=10 below
    expect(m.boundaries(10).sort((x, y) => x - y)).toEqual([30, 100]);
  });

  it('takeDue pops the first scheduled burn at or before t', () => {
    const m = new BurnManager();
    m.schedule(100, { x: 1, y: 0, z: 0 }, 0.5, 10);
    expect(m.takeDue(50)).toBeNull();
    const due = m.takeDue(100);
    expect(due?.startTime).toBe(100);
    expect(m.getScheduled()).toHaveLength(0);
  });

  it('thrust is zero when idle and throttle×maxAccel along forward when active', () => {
    const m = new BurnManager();
    expect(m.thrust(MAX_ACCELERATION)).toEqual({ x: 0, y: 0, z: 0 });
    m.startActive(0, 0.4, 10, { x: 0, y: 1, z: 0 }, null);
    const t = m.thrust(MAX_ACCELERATION);
    expect(t.y).toBeCloseTo(0.4 * MAX_ACCELERATION, 12);
    expect(t.x).toBe(0);
  });

  it('cancel returns whether a burn was removed; reset clears everything', () => {
    const m = new BurnManager();
    const a = m.schedule(100, { x: 1, y: 0, z: 0 }, 0.5, 10);
    expect(m.cancel(a.id)).toBe(true);
    expect(m.cancel(a.id)).toBe(false);
    m.startActive(0, 0.5, 10, { x: 1, y: 0, z: 0 }, null);
    m.reset();
    expect(m.getActive()).toBeNull();
    expect(m.getScheduled()).toHaveLength(0);
  });

  it('deltaVForSubstep = throttle × maxAccel × dt', () => {
    expect(deltaVForSubstep(0.5, MAX_ACCELERATION, 20)).toBeCloseTo(0.5 * MAX_ACCELERATION * 20, 12);
  });
});
