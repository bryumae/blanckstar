// Data screen mount (src/ui/data/index.ts, mvp0_spec.md §7, §7.2-7.3, §7.8,
// §7 inserted-state, §12 AC6/AC7/AC8). happy-dom; sim worker is faked via a
// captured listener + a send() spy, matching the injected postMessage seam
// pattern from ADR-0001. Ephemeris query and measurement log now live in
// their own screens (tests/unit/ui/ephemerisScreen.test.ts,
// measurementLogScreen.test.ts) — this file covers what's left in Data:
// radio, ship data, scheduled burns, time controls, inserted-state analysis.
import { describe, it, expect, beforeEach } from 'vitest';
import { mountDataScreen, type DataScreenHandle } from '../../../src/ui/data/index';
import type { SimCommand, SimEvent } from '../../../src/sim/messages';
import type { ShipState } from '../../../src/sim/types';
import { createCandidateStore, type CandidateStore } from '../../../src/ui/candidateStore';
import type { StorageLike } from '../../../src/net/storage';
import type { EphemerisData } from '../../../src/core/ephemerisTypes';
import { MU_SUN } from '../../../src/core/constants';

class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

// ---- synthetic ephemeris: circular-ish orbit for Earth, straight lines for
// everything else. Sample interval large enough to cover a 90-day horizon. ----
const T0 = 1_800_000_000; // arbitrary epoch, unix seconds
const DAY = 86400;
const AU = 1.495978707e11;
const EARTH_ORBIT_R = AU;
const EARTH_PERIOD = 365.25 * DAY;
const EARTH_OMEGA = (2 * Math.PI) / EARTH_PERIOD;

function earthStateAt(t: number): readonly [number, number, number, number, number, number] {
  const theta = EARTH_OMEGA * (t - T0);
  const v = (EARTH_ORBIT_R * EARTH_OMEGA);
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
  // Static-ish far-away bodies (never approached in these tests); zero velocity
  // straight "orbits" so gravity accel from them stays small/simple.
  const staticSamples = (r: number) =>
    Array.from({ length: days + 1 }, () => [r, 0, 0, 0, 0, 0] as const);

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

// <input type="datetime-local"> has no timezone; the screen parses its value
// with `new Date(value)`, which happy-dom/JS interprets as local time. Build
// the value from local wall-clock components so it round-trips to the
// intended unix-seconds instant regardless of the test runner's timezone.
function toLocalDatetimeInputValue(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeShipState(overrides: Partial<ShipState> = {}): ShipState {
  return {
    position: { x: 1e11, y: 0, z: 0 },
    velocity: { x: 0, y: 29000, z: 0 },
    forward: { x: 1, y: 0, z: 0 },
    deltaVSpent: 0,
    burning: false,
    ...overrides,
  };
}

interface Harness {
  root: HTMLElement;
  handle: DataScreenHandle;
  sent: SimCommand[];
  emit(e: SimEvent): void;
  candidates: CandidateStore;
  ephemeris: EphemerisData;
}

function setup(overrides: Partial<Parameters<typeof mountDataScreen>[1]> = {}): Harness {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const sent: SimCommand[] = [];
  const listeners = new Set<(e: SimEvent) => void>();
  const ephemeris = buildEphemeris();
  const candidates = createCandidateStore(new FakeStorage());

  const handle = mountDataScreen(root, {
    ephemeris,
    send: (cmd) => sent.push(cmd),
    addSimListener: (cb) => listeners.add(cb),
    removeSimListener: (cb) => listeners.delete(cb),
    candidates,
    ...overrides,
  });

  return {
    root,
    handle,
    sent,
    emit: (e) => listeners.forEach((cb) => cb(e)),
    candidates,
    ephemeris,
  };
}

describe('mountDataScreen', () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });

  it('renders the four remaining module cards', () => {
    const titles = [...h.root.querySelectorAll('.data-card-title')].map((el) => el.textContent);
    expect(titles.some((t) => t?.includes('RADIO'))).toBe(true);
    expect(titles.some((t) => t?.includes('SHIP DATA'))).toBe(true);
    expect(titles.some((t) => t?.includes('SCHEDULED BURNS'))).toBe(true);
    expect(titles.some((t) => t?.includes('INSERTED-STATE'))).toBe(true);
    // Ephemeris and Measurement Log are their own first-level screens; Time
    // Controls (warp + skip-to-time) moved into the shell header.
    expect(titles.some((t) => t?.includes('EPHEMERIS'))).toBe(false);
    expect(titles.some((t) => t?.includes('MEASUREMENT LOG'))).toBe(false);
    expect(titles.some((t) => t?.includes('TIME CONTROLS'))).toBe(false);
  });

  it('radio lock button sends radioLockEarth; measurementAdded round-trips to the display', () => {
    const btn = [...h.root.querySelectorAll('button')].find((b) => b.textContent?.includes('lockEarth'))!;
    btn.click();
    expect(h.sent).toContainEqual({ type: 'radioLockEarth' });

    h.emit({
      type: 'measurementAdded',
      measurement: {
        id: 1,
        simTime: T0 + 100,
        data: {
          kind: 'radioLock',
          body: 'earth',
          rangeMeters: 1.084e11,
          direction: { x: -0.4, y: 0.88, z: 0.22 },
          quality: 1,
          tSent: T0,
          tReceived: T0 + 100,
        },
      },
    });

    const hero = h.root.querySelector('.data-hero-value')!;
    expect(hero.textContent).toMatch(/km/);
    const statusBadge = h.root.querySelector('.data-status-badge')!;
    expect(statusBadge.textContent).toMatch(/LEVEL 1 LOCK/);
  });

  it('scheduled burn add/cancel flow', () => {
    h.emit({
      type: 'scheduledBurnAdded',
      burn: { id: 7, startTime: T0 + 1000, direction: { x: 1, y: 0, z: 0 }, throttle: 0.5, duration: 60 },
    });
    expect(h.root.textContent).toMatch(/#7/);
    const cancelBtn = h.root.querySelector('.data-burn-cancel') as HTMLButtonElement;
    cancelBtn.click();
    expect(h.sent).toContainEqual({ type: 'cancelBurn', id: 7 });

    h.emit({ type: 'scheduledBurnCancelled', id: 7 });
    expect(h.root.textContent).toMatch(/No scheduled burns/);
  });

  it('live burn display from burnStarted/burnEnded', () => {
    h.emit({ type: 'burnStarted', startTime: T0, endTime: T0 + 30, throttle: 1, scheduledId: null });
    expect(h.root.textContent).toMatch(/BURNING/);
    h.emit({ type: 'burnEnded', endTime: T0 + 30, deltaVSpent: 15 });
    expect(h.root.querySelector('.data-burn-card')).toBeNull();
  });

  it('ship data never shows position/velocity strings, shows self-knowledge fields', () => {
    h.emit({
      type: 'state',
      simTime: T0 + 500,
      missionElapsed: 500,
      warp: 1,
      ship: makeShipState({ burning: true, deltaVSpent: 123.456 }),
      bodies: { sun: { x: 0, y: 0, z: 0 }, earth: { x: AU, y: 0, z: 0 }, moon: { x: 0, y: 0, z: 0 }, mars: { x: 0, y: 0, z: 0 }, venus: { x: 0, y: 0, z: 0 }, jupiter: { x: 0, y: 0, z: 0 } },
    });
    expect(h.root.textContent).toMatch(/12,000 kg/);
    expect(h.root.textContent).toMatch(/BURNING/);
    expect(h.root.textContent).toMatch(/0\.123 km\/s/); // 123.456 m/s -> 0.123 km/s
  });

  it('truth-leak test: formatted true ship position never appears in the DOM', () => {
    const truePosition = { x: 123_456_789, y: -987_654_321, z: 42_000_000 };
    h.emit({
      type: 'state',
      simTime: T0,
      missionElapsed: 0,
      warp: 0,
      ship: makeShipState({ position: truePosition }),
      bodies: { sun: { x: 0, y: 0, z: 0 }, earth: { x: AU, y: 0, z: 0 }, moon: { x: 0, y: 0, z: 0 }, mars: { x: 0, y: 0, z: 0 }, venus: { x: 0, y: 0, z: 0 }, jupiter: { x: 0, y: 0, z: 0 } },
    });
    // Format the true position the way fmtVec would, and assert it's absent.
    const asFormatted = `(${truePosition.x.toFixed(3)}, ${truePosition.y.toFixed(3)}, ${truePosition.z.toFixed(3)})`;
    expect(h.root.innerHTML).not.toContain(asFormatted);
    // Also check the raw numbers don't leak via any km-scaled formatting.
    expect(h.root.innerHTML).not.toContain('123456.789');
    expect(h.root.innerHTML).not.toContain((truePosition.x / 1000).toFixed(1));
  });

  it('inserted-state closest approach on a synthetic near-planar ephemeris finds a sane minimum', () => {
    // Ship starts co-located with Earth's near-future position with a small
    // relative velocity offset -> closest approach should be small and well
    // inside the 7-day horizon, not at the horizon edge.
    const inputs = h.root.querySelectorAll('.data-state-form input');
    const earth0 = { x: EARTH_ORBIT_R / 1000, y: 0, z: 0 };
    (inputs[0] as HTMLInputElement).value = String(earth0.x + 50000); // 50,000 km offset in x
    (inputs[1] as HTMLInputElement).value = '0';
    (inputs[2] as HTMLInputElement).value = '0';
    (inputs[3] as HTMLInputElement).value = '0';
    (inputs[4] as HTMLInputElement).value = '29'; // ~Earth's orbital speed, km/s
    (inputs[5] as HTMLInputElement).value = '0';
    for (const i of inputs) i.dispatchEvent(new Event('input'));
    const epochInput = h.root.querySelector('.data-state-form-row input[type="datetime-local"]') as HTMLInputElement;
    epochInput.value = toLocalDatetimeInputValue(T0);

    const sevenDayBtn = [...h.root.querySelectorAll('.data-horizon-btn')].find((b) => b.textContent === '7d')! as HTMLButtonElement;
    sevenDayBtn.click();

    const analyzeBtn = [...h.root.querySelectorAll('button')].find((b) => b.textContent === 'Analyze inserted state')!;
    analyzeBtn.click();

    return new Promise<void>((resolve) => {
      const check = (): void => {
        const box = h.root.querySelector('.data-closest-approach')!;
        if (box.textContent?.includes('Propagating')) {
          setTimeout(check, 5);
          return;
        }
        expect(box.textContent).toMatch(/CLOSEST APPROACH/);
        expect(box.textContent).toMatch(/km/);
        resolve();
      };
      check();
    });
  });

  it('orbital elements display switches reference frames (solar vs earth)', () => {
    const inputs = h.root.querySelectorAll('.data-state-form input');
    (inputs[0] as HTMLInputElement).value = String((EARTH_ORBIT_R + 4e8) / 1000); // beyond Earth, still solar-orbiting
    (inputs[1] as HTMLInputElement).value = '0';
    (inputs[2] as HTMLInputElement).value = '0';
    (inputs[3] as HTMLInputElement).value = '0';
    const vCirc = Math.sqrt(MU_SUN / (EARTH_ORBIT_R + 4e8)) / 1000;
    (inputs[4] as HTMLInputElement).value = String(vCirc);
    (inputs[5] as HTMLInputElement).value = '0';
    for (const i of inputs) i.dispatchEvent(new Event('input'));
    const epochInput = h.root.querySelector('.data-state-form-row input[type="datetime-local"]') as HTMLInputElement;
    epochInput.value = toLocalDatetimeInputValue(T0);

    const analyzeBtn = [...h.root.querySelectorAll('button')].find((b) => b.textContent === 'Analyze inserted state')!;
    analyzeBtn.click();

    const solarGrid = h.root.querySelector('.data-elements-grid')!.textContent;
    expect(solarGrid).toMatch(/Periapsis/);

    const earthBtn = [...h.root.querySelectorAll('.data-toggle-btn')].find((b) => b.textContent === 'EARTH')! as HTMLButtonElement;
    earthBtn.click();
    const earthGrid = h.root.querySelector('.data-elements-grid')!.textContent;
    expect(earthGrid).toMatch(/Perigee/);
    expect(earthGrid).not.toBe(solarGrid);
  });

  it('always shows the ESTIMATE-DERIVED label on inserted-state analysis', () => {
    expect(h.root.textContent).toMatch(/ESTIMATE-DERIVED/);
  });

  it('candidate select loads a saved candidate into the form', () => {
    h.candidates.save({
      id: 'c1',
      name: 'Fix #1',
      epoch: T0,
      position: { x: 1e11, y: 2e10, z: 0 },
      velocity: { x: 1000, y: 29000, z: 0 },
      createdAt: T0,
    });
    const select = h.root.querySelector('.data-state-form-row select') as HTMLSelectElement;
    select.value = 'c1';
    select.dispatchEvent(new Event('change'));
    const inputs = h.root.querySelectorAll('.data-state-form input');
    expect((inputs[0] as HTMLInputElement).value).toBe(String(1e11 / 1000));
  });

  it('destroy() unsubscribes the sim listener and candidate store', () => {
    h.handle.destroy();
    expect(h.root.innerHTML).toBe('');
    // Should not throw even though listeners were removed.
    expect(() => h.emit({ type: 'ready', seedId: 'x', epoch: T0 })).not.toThrow();
  });
});
