// Integration test for mountShell's DOM wiring and injected send/listener seam
// (mirrors tests/unit/debugOverlay.test.ts's harness style for a UI mount
// function). Covers: scenario picker → onInit, screen switching visibility,
// header clock/warp/beacon/scenario updates, and win/lose overlays.
import { describe, expect, it } from 'vitest';
import { mountShell } from '../../src/ui/shell/index';
import type { SimCommand, SimEvent, StateEvent } from '../../src/sim/messages';
import type { ScenarioSeed } from '../../src/sim/types';

const SEEDS: readonly ScenarioSeed[] = [
  {
    id: 'seed-a',
    title: 'Seed A',
    epoch: 1_756_684_800,
    position: { x: 1e11, y: 0, z: 0 },
    velocity: { x: 0, y: 30000, z: 0 },
    playerDescription: 'Description A.',
  },
  {
    id: 'seed-b',
    title: 'Seed B',
    epoch: 1_756_684_800,
    position: { x: 1.2e11, y: 0, z: 0 },
    velocity: { x: 0, y: 28000, z: 0 },
    playerDescription: 'Description B.',
  },
];

function makeStateEvent(overrides: Partial<StateEvent> = {}): StateEvent {
  return {
    type: 'state',
    simTime: 1_756_684_800,
    missionElapsed: 3661,
    warp: 1,
    ship: {
      position: { x: 1e10, y: 2e10, z: 0 },
      velocity: { x: 1000, y: -500, z: 0 },
      forward: { x: 1, y: 0, z: 0 },
      deltaVSpent: 123.4,
      burning: false,
    },
    bodies: {
      sun: { x: 0, y: 0, z: 0 },
      earth: { x: 1.5e11, y: 0, z: 0 },
      moon: { x: 1.5e11 + 3.8e8, y: 0, z: 0 },
      mars: { x: 2.2e11, y: 0, z: 0 },
      venus: { x: 1.08e11, y: 0, z: 0 },
      jupiter: { x: 7.7e11, y: 0, z: 0 },
    },
    ...overrides,
  };
}

function makeHarness() {
  const listeners: ((e: SimEvent) => void)[] = [];
  const sent: SimCommand[] = [];
  const initCalls: ScenarioSeed[] = [];
  let lastSeedId: string | null = null;
  const deps = {
    seeds: SEEDS,
    getLastSeedId: () => lastSeedId,
    setLastSeedId: (id: string) => {
      lastSeedId = id;
    },
    send: (cmd: SimCommand) => {
      sent.push(cmd);
    },
    addSimListener: (cb: (e: SimEvent) => void) => {
      listeners.push(cb);
    },
    removeSimListener: (cb: (e: SimEvent) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    onInit: (seed: ScenarioSeed) => {
      initCalls.push(seed);
    },
  };
  return {
    deps,
    sent,
    initCalls,
    emit: (e: SimEvent) => listeners.forEach((cb) => cb(e)),
    listenerCount: () => listeners.length,
  };
}

describe('mountShell (§7 intro, §2)', () => {
  it('shows the scenario picker on mount with seed cards', () => {
    const root = document.createElement('div');
    const { deps } = makeHarness();
    mountShell(root, deps);
    const overlay = root.querySelector('.shell-overlay');
    expect(overlay).not.toBeNull();
    const cards = root.querySelectorAll('.shell-seed-card');
    expect(cards.length).toBe(2);
    expect(cards[0]!.textContent).toContain('Seed A');
    expect(cards[1]!.textContent).toContain('Seed B');
  });

  it('preselects the last-chosen seed id', () => {
    const root = document.createElement('div');
    const { deps } = makeHarness();
    deps.setLastSeedId('seed-b');
    mountShell(root, deps);
    const cards = Array.from(root.querySelectorAll('.shell-seed-card'));
    expect(cards[1]!.classList.contains('is-selected')).toBe(true);
    expect(cards[0]!.classList.contains('is-selected')).toBe(false);
  });

  it('starting a mission calls onInit, persists the seed id, and closes the overlay', () => {
    const root = document.createElement('div');
    const { deps, initCalls } = makeHarness();
    mountShell(root, deps);
    const startBtn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Start mission')!;
    startBtn.click();
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]!.id).toBe('seed-a');
    expect(deps.getLastSeedId()).toBe('seed-a');
    expect(root.querySelector('.shell-overlay')).toBeNull();
  });

  it('picking a different seed card then starting inits that seed', () => {
    const root = document.createElement('div');
    const { deps, initCalls } = makeHarness();
    mountShell(root, deps);
    const cards = Array.from(root.querySelectorAll('.shell-seed-card'));
    cards[1]!.dispatchEvent(new Event('click', { bubbles: true }));
    const startBtn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Start mission')!;
    startBtn.click();
    expect(initCalls[0]!.id).toBe('seed-b');
  });

  it('screen switching toggles is-active and calls onScreenVisibility', () => {
    const root = document.createElement('div');
    const { deps } = makeHarness();
    const visibility: [string, boolean][] = [];
    const handle = mountShell(root, {
      ...deps,
      onScreenVisibility: (id, visible) => visibility.push([id, visible]),
    });
    expect(handle.screenRoot('telescope').classList.contains('is-active')).toBe(true);
    expect(handle.screenRoot('data').classList.contains('is-active')).toBe(false);

    const dataNavBtn = Array.from(root.querySelectorAll('.shell-nav-btn')).find((b) =>
      b.textContent?.includes('Data'),
    )!;
    (dataNavBtn as HTMLButtonElement).click();

    expect(handle.screenRoot('telescope').classList.contains('is-active')).toBe(false);
    expect(handle.screenRoot('data').classList.contains('is-active')).toBe(true);
    expect(visibility).toContainEqual(['telescope', false]);
    expect(visibility).toContainEqual(['data', true]);
  });

  it('updates the UTC/MET clocks and warp highlight from state events', () => {
    const root = document.createElement('div');
    const { deps, emit } = makeHarness();
    mountShell(root, deps);
    emit(makeStateEvent({ warp: 100 }));
    expect(root.querySelector('.shell-clock-value')?.textContent).toContain('2025-09-01');
    expect(root.querySelector('.shell-clock-value.is-met')?.textContent).toContain('+0d 01:01:01');
    const activeWarp = root.querySelector('.shell-warp-btn.is-active');
    expect(activeWarp?.textContent).toBe('100×');
  });

  it('clicking a warp button sends setWarp', () => {
    const root = document.createElement('div');
    const { deps, sent } = makeHarness();
    mountShell(root, deps);
    const btn = Array.from(root.querySelectorAll('.shell-warp-btn')).find((b) => b.textContent === '10×')!;
    (btn as HTMLButtonElement).click();
    expect(sent).toContainEqual({ type: 'setWarp', factor: 10 });
  });

  it('locks the beacon indicator on a radioLock measurement and resets on ready', () => {
    const root = document.createElement('div');
    const { deps, emit } = makeHarness();
    mountShell(root, deps);
    emit({
      type: 'measurementAdded',
      measurement: {
        id: 1,
        simTime: 1_756_684_800,
        data: {
          kind: 'radioLock',
          body: 'earth',
          rangeMeters: 1e9,
          direction: { x: 1, y: 0, z: 0 },
          quality: 1,
          tSent: 1_756_684_700,
          tReceived: 1_756_684_800,
        },
      },
    });
    expect(root.querySelector('.shell-beacon-state')?.textContent).toBe('LOCKED');
    // The nav-rail System Vitals "Beacon" row must track the header (#10 — it
    // used to be created but never updated, stuck at its placeholder).
    const beaconVital = (): string | null | undefined =>
      [...root.querySelectorAll('.shell-vital-row')]
        .find((r) => r.querySelector('.shell-vital-key')?.textContent === 'Beacon')
        ?.querySelector('.shell-vital-value')?.textContent;
    expect(beaconVital()).toBe('LOCKED');
    emit({ type: 'ready', seedId: 'seed-a', epoch: 1_756_684_800 });
    expect(root.querySelector('.shell-beacon-state')?.textContent).toBe('NO LOCK');
    expect(beaconVital()).toBe('NO LOCK');
  });

  it('shows a win overlay with mission stats on a won event', () => {
    const root = document.createElement('div');
    const { deps, emit } = makeHarness();
    mountShell(root, deps);
    emit({
      type: 'won',
      stats: {
        missionElapsed: 90_000,
        deltaVSpent: 1234.5,
        orbit: {
          semiMajorAxis: 7e6,
          eccentricity: 0.1,
          inclination: 0.05,
          periapsis: 6.6e6,
          apoapsis: 7.4e6,
          specificEnergy: -1000,
          period: 5400,
        },
      },
    });
    const overlay = root.querySelector('.shell-overlay');
    expect(overlay?.textContent).toContain('TEMPORARY EARTH CAPTURE ACHIEVED');
    expect(overlay?.textContent).toContain('0.1000');
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === 'Retry same seed')).toBe(true);
  });

  it('shows a failure overlay with the reason on a lost event', () => {
    const root = document.createElement('div');
    const { deps, emit } = makeHarness();
    mountShell(root, deps);
    emit({ type: 'lost', reason: 'moon-collision', simTime: 1_756_684_800 });
    const overlay = root.querySelector('.shell-overlay');
    expect(overlay?.textContent).toContain('MISSION FAILED');
    expect(overlay?.textContent).toContain('Lunar surface impact');
  });

  it('retry same seed sends reset and closes the overlay', () => {
    const root = document.createElement('div');
    const { deps, sent, emit } = makeHarness();
    mountShell(root, deps);
    emit({ type: 'lost', reason: 'sun-collision', simTime: 1_756_684_800 });
    const retryBtn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Retry same seed')!;
    (retryBtn as HTMLButtonElement).click();
    expect(sent).toContainEqual({ type: 'reset' });
    expect(root.querySelector('.shell-overlay')).toBeNull();
  });

  it('choose another seed re-opens the scenario picker from a failure overlay', () => {
    const root = document.createElement('div');
    const { deps, emit } = makeHarness();
    mountShell(root, deps);
    emit({ type: 'lost', reason: 'earth-atmosphere', simTime: 1_756_684_800 });
    const otherBtn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Choose another seed')!;
    (otherBtn as HTMLButtonElement).click();
    expect(root.querySelectorAll('.shell-seed-card').length).toBe(2);
  });

  it('destroy removes listeners and clears the DOM', () => {
    const root = document.createElement('div');
    const { deps, listenerCount } = makeHarness();
    const handle = mountShell(root, deps);
    const warp = root.querySelector('.shell-warp')!;
    const warpCompact = root.querySelector('.shell-warp-compact') as HTMLButtonElement;
    expect(listenerCount()).toBe(1);
    warpCompact.click();
    expect(warp.classList.contains('is-open')).toBe(true);
    handle.destroy();
    window.dispatchEvent(new Event('click'));
    expect(listenerCount()).toBe(0);
    expect(warp.classList.contains('is-open')).toBe(true);
    expect(root.textContent).toBe('');
  });
});
