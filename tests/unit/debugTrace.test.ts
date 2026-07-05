import { describe, expect, it } from 'vitest';
import { TrajectoryTrace } from '../../src/ui/debug/trace';

describe('TrajectoryTrace (§10)', () => {
  it('rejects a non-positive capacity', () => {
    expect(() => new TrajectoryTrace(0)).toThrow();
    expect(() => new TrajectoryTrace(-1)).toThrow();
  });

  it('accumulates points up to capacity', () => {
    const t = new TrajectoryTrace(3);
    t.push({ x: 1, y: 0, z: 0 });
    t.push({ x: 2, y: 0, z: 0 });
    expect(t.points()).toHaveLength(2);
  });

  it('drops the oldest point once capacity is exceeded (rolling buffer)', () => {
    const t = new TrajectoryTrace(2);
    t.push({ x: 1, y: 0, z: 0 });
    t.push({ x: 2, y: 0, z: 0 });
    t.push({ x: 3, y: 0, z: 0 });
    const points = t.points();
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ x: 2, y: 0, z: 0 });
    expect(points[1]).toEqual({ x: 3, y: 0, z: 0 });
  });

  it('clear() empties the buffer', () => {
    const t = new TrajectoryTrace(5);
    t.push({ x: 1, y: 0, z: 0 });
    t.clear();
    expect(t.points()).toHaveLength(0);
  });
});
