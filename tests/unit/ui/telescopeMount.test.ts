// Integration test for mountTelescopeScreen's destroy() teardown — the mount
// itself is exercised indirectly by tests/unit/render/scene.test.ts and
// tests/unit/ui/telescopeState.test.ts; this covers the window-level
// listener leak fixed in #16.
import { describe, expect, it, vi } from 'vitest';
import { mountTelescopeScreen, type TelescopeScreenDeps } from '../../../src/ui/telescope/index';
import type { EphemerisData } from '../../../src/core/ephemerisTypes';

function makeEphemeris(): EphemerisData {
  const t0 = 0;
  const dt = 86400;
  const zero: readonly [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const earth: readonly [number, number, number, number, number, number] = [1.5e11, 0, 0, 0, 0, 0];
  return {
    frame: 'heliocentric-ecliptic-j2000',
    units: { position: 'm', velocity: 'm/s', time: 's' },
    bodies: {
      sun: { t0, dt, samples: [zero, zero] },
      earth: { t0, dt, samples: [earth, earth] },
      moon: { t0, dt, samples: [earth, earth] },
      mars: { t0, dt, samples: [earth, earth] },
      venus: { t0, dt, samples: [earth, earth] },
      jupiter: { t0, dt, samples: [earth, earth] },
    },
  };
}

function makeDeps(): TelescopeScreenDeps {
  return {
    ephemeris: makeEphemeris(),
    starCatalog: [],
    instruments: {
      measureAngularSeparation: async () => ({ radians: 0, id: 'a-b' }),
    },
    getFrameState: () => ({
      time: 0,
      shipPosition: { x: 1.5e11, y: 0, z: 0 },
      shipForward: { x: 1, y: 0, z: 0 },
    }),
  };
}

describe('mountTelescopeScreen destroy() (#16)', () => {
  it('removes the window-level click/mousemove/mouseup listeners added at mount', () => {
    const root = document.createElement('div');
    const addSpy = vi.spyOn(window, 'addEventListener');
    const handle = mountTelescopeScreen(root, makeDeps());
    const windowCalls = addSpy.mock.calls.filter(
      ([type]) => (type as string) === 'click' || (type as string) === 'mousemove' || (type as string) === 'mouseup',
    );
    expect(windowCalls.length).toBe(3);
    handle.destroy();
    for (const [, , options] of windowCalls) {
      expect((options as AddEventListenerOptions).signal?.aborted).toBe(true);
    }
    addSpy.mockRestore();
  });
});
