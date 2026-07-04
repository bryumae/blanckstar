import { describe, expect, it } from 'vitest';
import { missionElapsed, timeFromElapsed } from '../../src/core/clock';

describe('clock', () => {
  it('computes mission-elapsed seconds from epoch', () => {
    expect(missionElapsed(1_000_000, 1_000_500)).toBe(500);
    expect(missionElapsed(1_000_000, 1_000_000)).toBe(0);
  });

  it('round-trips elapsed <-> absolute time', () => {
    const epoch = 1_755_993_600;
    const elapsed = 3600 * 48;
    const t = timeFromElapsed(epoch, elapsed);
    expect(t).toBe(epoch + elapsed);
    expect(missionElapsed(epoch, t)).toBe(elapsed);
  });
});
