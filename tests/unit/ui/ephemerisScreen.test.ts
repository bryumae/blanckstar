// Ephemeris screen mount (src/ui/ephemeris/index.ts) — split out of Data
// (mvp0_spec.md §7.4). happy-dom; sim state fed via a captured listener,
// matching the injected postMessage seam pattern from ADR-0001.
import { describe, it, expect, beforeEach } from 'vitest';
import { mountEphemerisScreen, type EphemerisScreenHandle } from '../../../src/ui/ephemeris/index';
import type { SimEvent } from '../../../src/sim/messages';
import type { EphemerisData } from '../../../src/core/ephemerisTypes';

const T0 = 1_800_000_000; // arbitrary epoch, unix seconds
const DAY = 86400;
const AU = 1.495978707e11;
const EARTH_ORBIT_R = AU;
const EARTH_PERIOD = 365.25 * DAY;
const EARTH_OMEGA = (2 * Math.PI) / EARTH_PERIOD;

function earthStateAt(t: number): readonly [number, number, number, number, number, number] {
  const theta = EARTH_OMEGA * (t - T0);
  const v = EARTH_ORBIT_R * EARTH_OMEGA;
  return [
    EARTH_ORBIT_R * Math.cos(theta),
    EARTH_ORBIT_R * Math.sin(theta),
    0,
    -v * Math.sin(theta),
    v * Math.cos(theta),
    0,
  ];
}

function buildEphemeris(): EphemerisData {
  const days = 400;
  const earthSamples = Array.from({ length: days + 1 }, (_, i) => earthStateAt(T0 + i * DAY));
  const staticSamples = (r: number) => Array.from({ length: days + 1 }, () => [r, 0, 0, 0, 0, 0] as const);

  return {
    frame: 'heliocentric-ecliptic-j2000',
    units: { position: 'm', velocity: 'm/s', time: 'unix-seconds' },
    bodies: {
      sun: { t0: T0, dt: DAY, samples: Array.from({ length: days + 1 }, () => [0, 0, 0, 0, 0, 0] as const) },
      earth: { t0: T0, dt: DAY, samples: earthSamples },
      moon: { t0: T0, dt: DAY, samples: staticSamples(EARTH_ORBIT_R + 3.84e8) },
      mars: { t0: T0, dt: DAY, samples: staticSamples(1.5 * AU) },
      venus: { t0: T0, dt: DAY, samples: staticSamples(0.7 * AU) },
      jupiter: { t0: T0, dt: DAY, samples: staticSamples(5.2 * AU) },
    },
  };
}

function toLocalDatetimeInputValue(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Harness {
  root: HTMLElement;
  handle: EphemerisScreenHandle;
  emit(e: SimEvent): void;
}

function setup(): Harness {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const listeners = new Set<(e: SimEvent) => void>();
  const handle = mountEphemerisScreen(root, {
    ephemeris: buildEphemeris(),
    addSimListener: (cb) => listeners.add(cb),
    removeSimListener: (cb) => listeners.delete(cb),
  });
  return { root, handle, emit: (e) => listeners.forEach((cb) => cb(e)) };
}

describe('mountEphemerisScreen', () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });

  it('renders the ephemeris card', () => {
    const title = h.root.querySelector('.data-card-title');
    expect(title?.textContent).toMatch(/EPHEMERIS/);
  });

  it('query matches core interpolation for Earth at t0', () => {
    const bodySelect = h.root.querySelector('select') as HTMLSelectElement;
    bodySelect.value = 'earth';
    const dateInput = h.root.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    dateInput.value = toLocalDatetimeInputValue(T0);
    const queryBtn = [...h.root.querySelectorAll('button')].find((b) => b.textContent === 'Query')!;
    queryBtn.click();
    const result = h.root.querySelector('.data-query-result')!;
    // Earth at T0 is at (AU, 0, 0) per the synthetic ephemeris -> x ~ AU/1000 km, y/z ~ 0.
    expect(result.textContent).toMatch(/149597870/); // AU in km, integer part
  });

  it('table shows all six bodies with |r| in AU, updated from state events', () => {
    h.emit({
      type: 'state',
      simTime: T0,
      missionElapsed: 0,
      warp: 0,
      ship: {
        position: { x: 1e11, y: 0, z: 0 },
        velocity: { x: 0, y: 29000, z: 0 },
        forward: { x: 1, y: 0, z: 0 },
        deltaVSpent: 0,
        burning: false,
      },
      bodies: { sun: { x: 0, y: 0, z: 0 }, earth: { x: AU, y: 0, z: 0 }, moon: { x: 0, y: 0, z: 0 }, mars: { x: 0, y: 0, z: 0 }, venus: { x: 0, y: 0, z: 0 }, jupiter: { x: 0, y: 0, z: 0 } },
    });
    const rows = h.root.querySelectorAll('tbody tr');
    expect(rows.length).toBe(6);
    const earthRow = [...rows].find((r) => r.textContent?.includes('Earth'))!;
    expect(earthRow.textContent).toMatch(/1\.0000/); // Earth at 1 AU
  });

  it('destroy() removes the sim listener and clears the DOM', () => {
    h.handle.destroy();
    expect(h.root.innerHTML).toBe('');
    expect(() => h.emit({ type: 'ready', seedId: 'x', epoch: T0 })).not.toThrow();
  });
});
