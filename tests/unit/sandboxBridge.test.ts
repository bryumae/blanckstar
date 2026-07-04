// Main-thread bridge correlation (src/sandbox/bridge.ts, mvp0_spec.md §8; ADR-0002).
// Driven with fake sim + fake sandbox-worker endpoints — no real Worker.
import { describe, it, expect, vi } from 'vitest';
import { SandboxBridge, type WorkerLike, type WatchdogDeps } from '../../src/sandbox/bridge';
import type { SandboxCommand, SandboxOut, CallOut } from '../../src/sandbox/protocol';
import type { SimCommand, SimEvent } from '../../src/sim/messages';
import type { Measurement } from '../../src/sim/types';
import { loadRealEphemeris } from './simHelpers';

const eph = loadRealEphemeris();

// A fake sandbox worker: records outgoing commands, lets the test push `SandboxOut`.
class FakeSandboxWorker implements WorkerLike {
  readonly sent: SandboxCommand[] = [];
  terminated = 0;
  private listeners: ((e: MessageEvent<SandboxOut>) => void)[] = [];
  postMessage(msg: SandboxCommand): void {
    this.sent.push(msg);
  }
  addEventListener(_t: 'message', cb: (e: MessageEvent<SandboxOut>) => void): void {
    this.listeners.push(cb);
  }
  removeEventListener(_t: 'message', cb: (e: MessageEvent<SandboxOut>) => void): void {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }
  terminate(): void {
    this.terminated += 1;
  }
  // Test helper: deliver a message from the worker to the bridge.
  emit(msg: SandboxOut): void {
    for (const l of this.listeners) l({ data: msg } as MessageEvent<SandboxOut>);
  }
  replies(): Extract<SandboxCommand, { type: 'reply' }>[] {
    return this.sent.filter((m): m is Extract<SandboxCommand, { type: 'reply' }> => m.type === 'reply');
  }
}

// A fake sim: records SimCommands, lets the test emit SimEvents to the bridge.
class FakeSim {
  readonly commands: SimCommand[] = [];
  private listener: ((e: SimEvent) => void) | null = null;
  post = (cmd: SimCommand): void => {
    this.commands.push(cmd);
  };
  add = (cb: (e: SimEvent) => void): void => {
    this.listener = cb;
  };
  remove = (): void => {
    this.listener = null;
  };
  emit(e: SimEvent): void {
    this.listener?.(e);
  }
  hasListener(): boolean {
    return this.listener !== null;
  }
}

interface Harness {
  bridge: SandboxBridge;
  workers: FakeSandboxWorker[];
  currentWorker: () => FakeSandboxWorker;
  sim: FakeSim;
  logs: string[];
  errors: { message: string; line: number | null }[];
  runningLog: boolean[];
  unresponsiveLog: boolean[];
}

function makeHarness(watchdog?: WatchdogDeps): Harness {
  const workers: FakeSandboxWorker[] = [];
  const sim = new FakeSim();
  const logs: string[] = [];
  const errors: { message: string; line: number | null }[] = [];
  const runningLog: boolean[] = [];
  const unresponsiveLog: boolean[] = [];
  const bridge = new SandboxBridge({
    createSandboxWorker: () => {
      const w = new FakeSandboxWorker();
      workers.push(w);
      return w;
    },
    postToSim: sim.post,
    addSimListener: sim.add,
    removeSimListener: sim.remove,
    ephemeris: eph,
    onLog: (t) => logs.push(t),
    onScriptError: (message, line) => errors.push({ message, line }),
    onRunningChange: (r) => runningLog.push(r),
    onUnresponsive: (u) => unresponsiveLog.push(u),
    watchdog,
  });
  return {
    bridge,
    workers,
    currentWorker: () => workers[workers.length - 1]!,
    sim,
    logs,
    errors,
    runningLog,
    unresponsiveLog,
  };
}

function mkWatchdog(clock: { t: number }) {
  const ticks: (() => void)[] = [];
  return {
    watchdog: {
      setInterval: (cb: () => void) => {
        ticks.push(cb);
        return ticks.length - 1;
      },
      clearInterval: () => {},
      pingIntervalMs: 100,
      unresponsiveAfterMs: 500,
      now: () => clock.t,
    },
    fire: () => ticks.forEach((t) => t()),
  };
}

// Drain microtasks so promise chains inside the bridge settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeMeasurement(id: number, data: Measurement['data'], simTime = 1000): Measurement {
  return { id, simTime, data };
}

describe('SandboxBridge lifecycle', () => {
  it('creates a worker and subscribes to the sim on construction', () => {
    const h = makeHarness();
    expect(h.workers.length).toBe(1);
    expect(h.sim.hasListener()).toBe(true);
  });

  it('run posts a run command with the ephemeris and flips running true', () => {
    const h = makeHarness();
    h.bridge.run('log(1)');
    const run = h.currentWorker().sent.find((m) => m.type === 'run');
    expect(run).toMatchObject({ type: 'run', source: 'log(1)' });
    expect((run as { ephemeris: unknown }).ephemeris).toBe(eph);
    expect(h.bridge.isRunning()).toBe(true);
    expect(h.runningLog).toContain(true);
  });

  it('stop terminates the worker and spawns a fresh usable one', () => {
    const h = makeHarness();
    h.bridge.run('while(true){}');
    const first = h.currentWorker();
    h.bridge.stop();
    expect(first.terminated).toBe(1);
    expect(h.workers.length).toBe(2);
    // Fresh worker can run again.
    h.bridge.run('log(2)');
    expect(h.currentWorker()).not.toBe(first);
    expect(h.currentWorker().sent.some((m) => m.type === 'run')).toBe(true);
    expect(h.bridge.isRunning()).toBe(true);
  });

  it('done and scriptError flip running false; error surfaces with line', () => {
    const h = makeHarness();
    h.bridge.run('x');
    h.currentWorker().emit({ type: 'done' });
    expect(h.bridge.isRunning()).toBe(false);

    h.bridge.run('y');
    h.currentWorker().emit({ type: 'scriptError', message: 'boom', line: 7 });
    expect(h.bridge.isRunning()).toBe(false);
    expect(h.errors).toContainEqual({ message: 'boom', line: 7 });
  });

  it('forwards log lines to onLog', () => {
    const h = makeHarness();
    h.bridge.run('x');
    h.currentWorker().emit({ type: 'log', text: 'hello' });
    expect(h.logs).toContain('hello');
  });

  it('dispose unsubscribes from the sim and terminates the worker', () => {
    const h = makeHarness();
    const w = h.currentWorker();
    h.bridge.dispose();
    expect(h.sim.hasListener()).toBe(false);
    expect(w.terminated).toBe(1);
  });
});

describe('SandboxBridge correlation', () => {
  function call(w: FakeSandboxWorker, callId: number, method: CallOut['method'], args: unknown[] = []): void {
    w.emit({ type: 'call', callId, method, args });
  }

  it('timeNow / measurements / status reply synchronously from mirrors', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    h.sim.emit({
      type: 'state', simTime: 5000, missionElapsed: 0, warp: 0,
      ship: { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, forward: { x: 1, y: 0, z: 0 }, deltaVSpent: 3, burning: false },
      bodies: {} as never,
    });
    call(w, 1, 'timeNow');
    call(w, 2, 'status');
    call(w, 3, 'measurements');
    await flush();
    const replies = w.replies();
    expect(replies.find((r) => r.callId === 1)!.value).toBe(5000);
    expect((replies.find((r) => r.callId === 2)!.value as { deltaVSpent: number }).deltaVSpent).toBe(3);
    expect((replies.find((r) => r.callId === 2)!.value as { maxThrustNewtons: number }).maxThrustNewtons).toBe(6000);
    expect(replies.find((r) => r.callId === 3)!.value).toEqual([]);
  });

  it('radioLockEarth posts the sim command and resolves on the matching measurement', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 10, 'radioLockEarth');
    expect(h.sim.commands.some((c) => c.type === 'radioLockEarth')).toBe(true);
    h.sim.emit({
      type: 'measurementAdded',
      measurement: makeMeasurement(1, {
        kind: 'radioLock', body: 'earth', rangeMeters: 42, direction: { x: 1, y: 0, z: 0 }, quality: 1, tSent: 1, tReceived: 2,
      }),
    });
    await flush();
    const reply = w.replies().find((r) => r.callId === 10)!;
    expect(reply.ok).toBe(true);
    expect((reply.value as { rangeMeters: number }).rangeMeters).toBe(42);
  });

  it('correlates interleaved measurement kinds FIFO', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 20, 'radioLockEarth');
    call(w, 21, 'sunDirection');
    call(w, 22, 'radioLockEarth');
    // sunDirection resolves first even though it was issued second.
    h.sim.emit({ type: 'measurementAdded', measurement: makeMeasurement(1, { kind: 'sunDirection', direction: { x: 0, y: 1, z: 0 } }) });
    h.sim.emit({ type: 'measurementAdded', measurement: makeMeasurement(2, { kind: 'radioLock', body: 'earth', rangeMeters: 100, direction: { x: 1, y: 0, z: 0 }, quality: 1, tSent: 1, tReceived: 2 }) });
    h.sim.emit({ type: 'measurementAdded', measurement: makeMeasurement(3, { kind: 'radioLock', body: 'earth', rangeMeters: 200, direction: { x: 1, y: 0, z: 0 }, quality: 1, tSent: 1, tReceived: 2 }) });
    await flush();
    const byId = (id: number) => w.replies().find((r) => r.callId === id)!.value;
    expect(byId(21)).toEqual({ x: 0, y: 1, z: 0 }); // sunDirection returns the vector
    expect((byId(20) as { rangeMeters: number }).rangeMeters).toBe(100); // first radio -> first lock
    expect((byId(22) as { rangeMeters: number }).rangeMeters).toBe(200);
  });

  it('angularSeparation returns radians', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 30, 'angularSeparation', ['earth', 'mars']);
    expect(h.sim.commands).toContainEqual({ type: 'angularSeparation', bodyA: 'earth', bodyB: 'mars' });
    h.sim.emit({ type: 'measurementAdded', measurement: makeMeasurement(1, { kind: 'angularSeparation', bodyA: 'earth', bodyB: 'mars', radians: 0.5 }) });
    await flush();
    expect(w.replies().find((r) => r.callId === 30)!.value).toBe(0.5);
  });

  it('ephemeris queries correlate by requestId', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 40, 'ephemerisPosition', ['mars', 123]);
    call(w, 41, 'ephemerisVelocity', ['venus', 456]);
    const queries = h.sim.commands.filter((c) => c.type === 'ephemerisQuery') as Extract<SimCommand, { type: 'ephemerisQuery' }>[];
    expect(queries.length).toBe(2);
    // Reply out of order.
    h.sim.emit({ type: 'ephemerisResult', requestId: queries[1]!.requestId, position: { x: 1, y: 2, z: 3 }, velocity: { x: 4, y: 5, z: 6 } });
    h.sim.emit({ type: 'ephemerisResult', requestId: queries[0]!.requestId, position: { x: 7, y: 8, z: 9 }, velocity: { x: 10, y: 11, z: 12 } });
    await flush();
    expect(w.replies().find((r) => r.callId === 40)!.value).toEqual({ x: 7, y: 8, z: 9 }); // position
    expect(w.replies().find((r) => r.callId === 41)!.value).toEqual({ x: 4, y: 5, z: 6 }); // velocity
  });

  it('point resolves on the next state', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 50, 'point', [{ x: 0, y: 1, z: 0 }]);
    expect(h.sim.commands).toContainEqual({ type: 'point', direction: { x: 0, y: 1, z: 0 } });
    h.sim.emit({
      type: 'state', simTime: 10, missionElapsed: 0, warp: 0,
      ship: { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 1, z: 0 }, deltaVSpent: 0, burning: false },
      bodies: {} as never,
    });
    await flush();
    expect(w.replies().find((r) => r.callId === 50)!.ok).toBe(true);
  });

  it('burn resolves on burnEnded', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 60, 'burn', [0.5, 600]);
    expect(h.sim.commands).toContainEqual({ type: 'burn', throttle: 0.5, duration: 600 });
    h.sim.emit({ type: 'burnEnded', endTime: 700, deltaVSpent: 150, scheduledId: null });
    await flush();
    expect(w.replies().find((r) => r.callId === 60)!.ok).toBe(true);
  });

  it('burn rejects on a sim error', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 61, 'burn', [2, 600]);
    h.sim.emit({ type: 'error', message: 'burn: throttle must be in [0,1]' });
    await flush();
    const reply = w.replies().find((r) => r.callId === 61)!;
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/throttle/);
  });

  it('scheduleBurn resolves the handle from scheduledBurnAdded; cancelBurn resolves', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 70, 'scheduleBurn', [2000, { x: 1, y: 0, z: 0 }, 0.3, 100]);
    h.sim.emit({ type: 'scheduledBurnAdded', burn: { id: 9, startTime: 2000, direction: { x: 1, y: 0, z: 0 }, throttle: 0.3, duration: 100 } });
    await flush();
    expect(w.replies().find((r) => r.callId === 70)!.value).toBe(9);
    // status now mirrors the scheduled burn.
    call(w, 71, 'status');
    await flush();
    expect((w.replies().find((r) => r.callId === 71)!.value as { scheduledBurns: unknown[] }).scheduledBurns.length).toBe(1);
    // cancel it.
    call(w, 72, 'cancelBurn', [9]);
    h.sim.emit({ type: 'scheduledBurnCancelled', id: 9 });
    await flush();
    expect(w.replies().find((r) => r.callId === 72)!.ok).toBe(true);
    call(w, 73, 'status');
    await flush();
    expect((w.replies().find((r) => r.callId === 73)!.value as { scheduledBurns: unknown[] }).scheduledBurns.length).toBe(0);
  });

  it('wait posts skipToTime and resolves when sim time reaches target', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    // Seed current time.
    h.sim.emit({ type: 'state', simTime: 1000, missionElapsed: 0, warp: 0, ship: { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, forward: { x: 1, y: 0, z: 0 }, deltaVSpent: 0, burning: false }, bodies: {} as never });
    call(w, 80, 'wait', [500]);
    expect(h.sim.commands).toContainEqual({ type: 'skipToTime', targetTime: 1500 });
    // Progress not yet at target: no reply.
    h.sim.emit({ type: 'skipProgress', simTime: 1200, fraction: 0.4 });
    await flush();
    expect(w.replies().find((r) => r.callId === 80)).toBeUndefined();
    // Reach target.
    h.sim.emit({ type: 'skipProgress', simTime: 1500, fraction: 1 });
    await flush();
    expect(w.replies().find((r) => r.callId === 80)!.ok).toBe(true);
  });

  it('wait resolves early on interrupt/win/lose (script sees time stopped)', async () => {
    for (const early of [
      { type: 'interrupted', reason: 'earth-soi-entry', simTime: 1100 } as SimEvent,
      { type: 'won', stats: { missionElapsed: 1, deltaVSpent: 1, orbit: {} as never } } as SimEvent,
      { type: 'lost', reason: 'earth-atmosphere', simTime: 1100 } as SimEvent,
    ]) {
      const h = makeHarness();
      h.bridge.run('x');
      const w = h.currentWorker();
      h.sim.emit({ type: 'state', simTime: 1000, missionElapsed: 0, warp: 0, ship: { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, forward: { x: 1, y: 0, z: 0 }, deltaVSpent: 0, burning: false }, bodies: {} as never });
      call(w, 90, 'wait', [5000]);
      h.sim.emit(early);
      await flush();
      expect(w.replies().find((r) => r.callId === 90)!.ok).toBe(true);
    }
  });

  it('a non-positive wait resolves immediately', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 95, 'wait', [0]);
    await flush();
    expect(w.replies().find((r) => r.callId === 95)!.ok).toBe(true);
    expect(h.sim.commands.some((c) => c.type === 'skipToTime')).toBe(false);
  });

  it('wait after the game is over resolves immediately without posting skipToTime', async () => {
    // Regression: a wait() issued once the sim is `over` used to post a
    // skipToTime the sim no-ops (emitting nothing), hanging the promise forever.
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    h.sim.emit({ type: 'won', stats: { missionElapsed: 1, deltaVSpent: 1, orbit: {} as never } });
    call(w, 96, 'wait', [500]);
    await flush();
    expect(w.replies().find((r) => r.callId === 96)!.ok).toBe(true);
    expect(h.sim.commands.some((c) => c.type === 'skipToTime')).toBe(false);
    // A fresh scenario (ready) re-enables waiting via skipToTime.
    h.sim.emit({ type: 'ready', seedId: 's', epoch: 1000 });
    h.sim.emit({ type: 'state', simTime: 1000, missionElapsed: 0, warp: 0, ship: { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, forward: { x: 1, y: 0, z: 0 }, deltaVSpent: 0, burning: false }, bodies: {} as never });
    call(w, 97, 'wait', [500]);
    expect(h.sim.commands).toContainEqual({ type: 'skipToTime', targetTime: 1500 });
  });

  it('a scheduled burn ending does not resolve a pending immediate burn() waiter', async () => {
    // Regression: burnEnded is correlated by scheduledId, not FIFO — a scheduled
    // burn completing must not prematurely resolve an awaited immediate burn().
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 110, 'burn', [0.5, 600]);
    // A previously-scheduled burn (id 3) fires and ends first.
    h.sim.emit({ type: 'burnEnded', endTime: 700, deltaVSpent: 40, scheduledId: 3 });
    await flush();
    expect(w.replies().find((r) => r.callId === 110)).toBeUndefined();
    // The immediate burn's own end (scheduledId null) resolves it.
    h.sim.emit({ type: 'burnEnded', endTime: 800, deltaVSpent: 90, scheduledId: null });
    await flush();
    expect(w.replies().find((r) => r.callId === 110)!.ok).toBe(true);
  });

  it('routes a tagged sim error to the matching waiter, not by fixed priority', async () => {
    // Regression: with a burn() and a scheduleBurn() both outstanding, a
    // scheduleBurn validation error must reject the scheduleBurn waiter, not the
    // burn waiter (the old fixed-priority guess rejected burns first).
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 120, 'burn', [0.5, 600]);
    call(w, 121, 'scheduleBurn', [10, { x: 1, y: 0, z: 0 }, 0.3, 100]);
    h.sim.emit({ type: 'error', message: 'scheduleBurn: startTime is in the past', command: 'scheduleBurn' });
    await flush();
    const burnReply = w.replies().find((r) => r.callId === 120);
    const schedReply = w.replies().find((r) => r.callId === 121)!;
    expect(burnReply).toBeUndefined(); // burn() still pending
    expect(schedReply.ok).toBe(false);
    expect(schedReply.error).toMatch(/past/);
  });

  it('does not reject a ship command on an unrelated (annotate) sim error', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    call(w, 130, 'burn', [0.5, 600]);
    h.sim.emit({ type: 'error', message: 'annotateMeasurement: no measurement 9', command: 'annotateMeasurement' });
    await flush();
    expect(w.replies().find((r) => r.callId === 130)).toBeUndefined(); // burn untouched
  });

  it('mirrors measurements across the whole run for log.measurements()', async () => {
    const h = makeHarness();
    h.bridge.run('x');
    const w = h.currentWorker();
    h.sim.emit({ type: 'measurementAdded', measurement: makeMeasurement(1, { kind: 'sunDirection', direction: { x: 0, y: 1, z: 0 } }) });
    call(w, 100, 'measurements');
    await flush();
    expect((w.replies().find((r) => r.callId === 100)!.value as unknown[]).length).toBe(1);
  });
});

describe('SandboxBridge watchdog (§8.1 runaway protection)', () => {
  it('marks unresponsive after the budget with no heartbeat, clears on heartbeat', () => {
    const clock = { t: 0 };
    const wd = mkWatchdog(clock);
    const h = makeHarness(wd.watchdog);
    h.bridge.run('while(true){}');
    // Tick before budget: still responsive.
    clock.t = 300;
    wd.fire();
    expect(h.unresponsiveLog).not.toContain(true);
    // Past the 500ms budget with no heartbeat.
    clock.t = 700;
    wd.fire();
    expect(h.unresponsiveLog).toContain(true);
    // A heartbeat clears it.
    h.currentWorker().emit({ type: 'heartbeat', nonce: 1 });
    expect(h.unresponsiveLog[h.unresponsiveLog.length - 1]).toBe(false);
  });

  it('pings the worker on each tick', () => {
    const clock = { t: 0 };
    const wd = mkWatchdog(clock);
    const h = makeHarness(wd.watchdog);
    h.bridge.run('x');
    wd.fire();
    expect(h.currentWorker().sent.some((m) => m.type === 'ping')).toBe(true);
  });
});
