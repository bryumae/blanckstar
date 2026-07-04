// Integration test for mountDebugOverlay's DOM wiring and injected
// subscribe/send seam (mirrors the sim worker's injected-emit test style,
// tests/unit/simulation.test.ts, but for a UI mount function).
import { describe, expect, it, vi } from 'vitest';
import { mountDebugOverlay } from '../../src/ui/debug/index';
import type { SimCommand, SimEvent, StateEvent } from '../../src/sim/messages';

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
    debug: { lastDt: 60, substepsLastTick: 2, totalSteps: 42 },
    ...overrides,
  };
}

function makeHarness() {
  const listeners: ((e: SimEvent) => void)[] = [];
  const sent: SimCommand[] = [];
  const deps = {
    subscribe: (cb: (e: SimEvent) => void) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    send: (cmd: SimCommand) => {
      sent.push(cmd);
    },
  };
  return {
    deps,
    sent,
    emit: (e: SimEvent) => listeners.forEach((cb) => cb(e)),
    listenerCount: () => listeners.length,
  };
}

describe('mountDebugOverlay (§10)', () => {
  it('renders a visible DEBUG watermark and panel', () => {
    const root = document.createElement('div');
    const { deps } = makeHarness();
    mountDebugOverlay(root, deps);
    const watermark = root.querySelector('.debug-watermark');
    expect(watermark).not.toBeNull();
    expect(watermark!.textContent).toBe('DEBUG');
    expect(root.querySelector('.debug-overlay')).not.toBeNull();
    expect(root.querySelector('.debug-badge')?.textContent).toContain('DEBUG');
  });

  it('updates true-state rows from a state event', () => {
    const root = document.createElement('div');
    const { deps, emit } = makeHarness();
    mountDebugOverlay(root, deps);
    emit(makeStateEvent());
    const rows = Array.from(root.querySelectorAll('.debug-row'));
    const dtRow = rows.find((r) => r.querySelector('.label')?.textContent === 'dt tier');
    expect(dtRow?.querySelector('.value')?.textContent).toBe('60.0 s');
    const warpRow = rows.find((r) => r.querySelector('.label')?.textContent === 'Warp');
    expect(warpRow?.querySelector('.value')?.textContent).toBe('1×');
  });

  it('shows PAUSED when warp is 0', () => {
    const root = document.createElement('div');
    const { deps, emit } = makeHarness();
    mountDebugOverlay(root, deps);
    emit(makeStateEvent({ warp: 0 }));
    const rows = Array.from(root.querySelectorAll('.debug-row'));
    const warpRow = rows.find((r) => r.querySelector('.label')?.textContent === 'Warp');
    expect(warpRow?.querySelector('.value')?.textContent).toBe('PAUSED');
  });

  it('issues exactly one ephemerisQuery per state event to fetch Earth velocity', () => {
    const root = document.createElement('div');
    const { deps, emit, sent } = makeHarness();
    mountDebugOverlay(root, deps);
    emit(makeStateEvent());
    const queries = sent.filter((c) => c.type === 'ephemerisQuery');
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ body: 'earth', t: 1_756_684_800 });
  });

  it('populates the Earth-relative panel once the ephemerisResult for Earth velocity arrives', () => {
    const root = document.createElement('div');
    const { deps, emit } = makeHarness();
    mountDebugOverlay(root, deps);
    emit(makeStateEvent());
    emit({ type: 'ephemerisResult', requestId: -1, position: { x: 1.5e11, y: 0, z: 0 }, velocity: { x: 0, y: 29785, z: 0 } });
    const rows = Array.from(root.querySelectorAll('.debug-row'));
    const energyRow = rows.find((r) => r.querySelector('.label')?.textContent?.includes('Specific energy'));
    expect(energyRow?.querySelector('.value')?.textContent).toMatch(/J\/kg/);
  });

  it('does not busy-loop ephemeris queries when a result arrives while paused (#8)', () => {
    const root = document.createElement('div');
    const { deps, emit, sent } = makeHarness();
    mountDebugOverlay(root, deps);
    emit(makeStateEvent({ warp: 0 })); // one query for this frame
    // The result handler must refresh the panel WITHOUT re-rendering (which
    // would re-issue a query for the same simTime, ad infinitum while paused).
    emit({ type: 'ephemerisResult', requestId: -1, position: { x: 1.5e11, y: 0, z: 0 }, velocity: { x: 0, y: 29785, z: 0 } });
    expect(sent.filter((c) => c.type === 'ephemerisQuery')).toHaveLength(1);
    // Re-delivering the same-simTime state also must not re-query.
    emit(makeStateEvent({ warp: 0 }));
    expect(sent.filter((c) => c.type === 'ephemerisQuery')).toHaveLength(1);
  });

  it('sends a debugTeleport command with km->m converted values on submit', () => {
    const root = document.createElement('div');
    const { deps, sent } = makeHarness();
    mountDebugOverlay(root, deps);
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('.debug-teleport-form input'));
    expect(inputs).toHaveLength(6);
    const [posX, posY, posZ, velX, velY, velZ] = inputs;
    posX!.value = '1000';
    posY!.value = '2000';
    posZ!.value = '3000';
    velX!.value = '1';
    velY!.value = '2';
    velZ!.value = '3';
    const btn = root.querySelector<HTMLButtonElement>('.debug-teleport-submit')!;
    btn.click();
    const teleports = sent.filter((c) => c.type === 'debugTeleport');
    expect(teleports).toHaveLength(1);
    expect(teleports[0]).toMatchObject({
      type: 'debugTeleport',
      position: { x: 1_000_000, y: 2_000_000, z: 3_000_000 },
      velocity: { x: 1000, y: 2000, z: 3000 },
    });
  });

  it('treats a non-numeric teleport field as 0', () => {
    const root = document.createElement('div');
    const { deps, sent } = makeHarness();
    mountDebugOverlay(root, deps);
    const btn = root.querySelector<HTMLButtonElement>('.debug-teleport-submit')!;
    btn.click(); // all fields blank
    const teleport = sent.find((c) => c.type === 'debugTeleport');
    expect(teleport).toMatchObject({ position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
  });

  it('destroy() unsubscribes and removes the overlay from the DOM', () => {
    const root = document.createElement('div');
    const { deps, listenerCount } = makeHarness();
    const handle = mountDebugOverlay(root, deps);
    expect(listenerCount()).toBe(1);
    handle.destroy();
    expect(listenerCount()).toBe(0);
    expect(root.querySelector('.debug-overlay')).toBeNull();
    expect(root.querySelector('.debug-watermark')).toBeNull();
  });

  it('map zoom preset buttons switch the active view without throwing', () => {
    const root = document.createElement('div');
    const { deps, emit } = makeHarness();
    mountDebugOverlay(root, deps);
    emit(makeStateEvent());
    const [innerBtn, earthBtn, scaleBtn] = Array.from(root.querySelectorAll<HTMLButtonElement>('.debug-map-controls button'));
    expect(() => earthBtn!.click()).not.toThrow();
    expect(() => scaleBtn!.click()).not.toThrow();
    expect(() => innerBtn!.click()).not.toThrow();
  });

  it('map wheel zoom does not throw', () => {
    const root = document.createElement('div');
    const { deps, emit } = makeHarness();
    mountDebugOverlay(root, deps);
    emit(makeStateEvent());
    const canvas = root.querySelector('canvas')!;
    const wheelEvent = new Event('wheel', { cancelable: true }) as WheelEvent;
    Object.defineProperty(wheelEvent, 'deltaY', { value: 10 });
    expect(() => canvas.dispatchEvent(wheelEvent)).not.toThrow();
  });
});

// Silence unused-import lint concerns for vi if not used elsewhere in this file.
void vi;
