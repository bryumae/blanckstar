// Bootstrap (browser glue, lowest coverage tier): loads data, creates the two
// workers, wires up the three DOM screens, starts the render loop. No game
// logic here — see mvp0_spec.md §3 for the module boundaries this wires
// together.
import { mountTelescopeScreen } from './ui/telescope';
import { mountSequenceScreen } from './ui/sequence';
import type { ConsoleSink } from './ui/sequence';
import { mountDataScreen } from './ui/data';
import { SandboxBridge } from './sandbox/bridge';
import { isDebugEnabled } from './ui/debug/gate';
import { loadEphemeris, loadStarCatalog } from './net/loadEphemeris';
import { positionAt, velocityAt } from './core/ephemerisInterp';
import { add, mul, normalize, cross, vec3 } from './core/vector3';
import type { SimCommand, SimEvent, StateEvent } from './sim/messages';
import type { ScenarioSeed } from './sim/types';
import type { RenderFrameState, TelescopeInstruments } from './render/types';
import './ui/styles.css';

// TODO(mvp0 #12): temporary dev seed until curated seeds land. Derived from the
// ephemeris at runtime: a heliocentric orbit trailing Earth by ~4.5e9 m with a
// ~1 km/s velocity offset (outside Earth's SOI, not trivially at Earth).
function devSeed(ephemeris: Awaited<ReturnType<typeof loadEphemeris>>): ScenarioSeed {
  const epoch = Date.UTC(2026, 8, 1) / 1000; // 2026-09-01T00:00:00Z
  const earthPos = positionAt(ephemeris, 'earth', epoch);
  const earthVel = velocityAt(ephemeris, 'earth', epoch);
  const prograde = normalize(earthVel);
  const outward = normalize(cross(prograde, vec3(0, 0, 1)));
  return {
    id: 'dev-close-call',
    title: 'Close call (dev placeholder)',
    epoch,
    position: add(add(earthPos, mul(prograde, -4.5e9)), mul(outward, 1.5e9)),
    velocity: add(earthVel, mul(prograde, 8e2)),
    playerDescription:
      'Emergency backup computer online. Main computer destroyed. Orbit unknown.',
  };
}

async function main(): Promise<void> {
  const telescopeRoot = document.querySelector<HTMLElement>('#screen-telescope');
  const sequenceRoot = document.querySelector<HTMLElement>('#screen-sequence');
  const dataRoot = document.querySelector<HTMLElement>('#screen-data');
  if (dataRoot) mountDataScreen(dataRoot);

  const fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  const [ephemeris, starCatalog] = await Promise.all([
    loadEphemeris(fetchImpl),
    loadStarCatalog(fetchImpl),
  ]);
  const seed = devSeed(ephemeris);

  // ---- sim worker + event fan-out ----
  const simWorker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
  const post = (command: SimCommand): void => simWorker.postMessage(command);
  const simListeners = new Set<(event: SimEvent) => void>();
  const addSimListener = (cb: (event: SimEvent) => void): void => void simListeners.add(cb);
  const removeSimListener = (cb: (event: SimEvent) => void): void => void simListeners.delete(cb);
  simWorker.addEventListener('message', (event: MessageEvent<SimEvent>) => {
    for (const listener of [...simListeners]) listener(event.data);
  });

  let latestState: StateEvent | null = null;
  let pendingSeparation: ((result: { radians: number; id: string }) => void) | null = null;
  const firstState = new Promise<StateEvent>((resolve) => {
    addSimListener((e) => {
      if (e.type === 'state') {
        if (!latestState) resolve(e);
        latestState = e;
      } else if (
        e.type === 'measurementAdded' &&
        e.measurement.data.kind === 'angularSeparation' &&
        pendingSeparation
      ) {
        pendingSeparation({ radians: e.measurement.data.radians, id: String(e.measurement.id) });
        pendingSeparation = null;
      } else if (e.type === 'error') {
        console.error('[sim]', e);
      }
    });
  });

  post({ type: 'init', ephemeris, seed });
  await firstState;

  // ---- telescope screen ----
  const instruments: TelescopeInstruments = {
    measureAngularSeparation(bodyA, bodyB) {
      return new Promise((resolve) => {
        pendingSeparation = resolve;
        post({ type: 'angularSeparation', bodyA, bodyB });
      });
    },
  };
  const getFrameState = (): RenderFrameState => {
    const s = latestState as StateEvent;
    return { time: s.simTime, shipPosition: s.ship.position, shipForward: s.ship.forward };
  };
  if (telescopeRoot) {
    const handle = mountTelescopeScreen(telescopeRoot, {
      ephemeris,
      starCatalog,
      instruments,
      getFrameState,
    });
    const loop = (): void => {
      handle.renderFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---- sandbox bridge + sequence screen ----
  let sink: ConsoleSink | null = null;
  const bridge = new SandboxBridge({
    createSandboxWorker: () =>
      new Worker(new URL('./sandbox/worker.ts', import.meta.url), { type: 'module' }),
    postToSim: post,
    addSimListener,
    removeSimListener,
    ephemeris,
    maxAcceleration: seed.maxAcceleration,
    onLog: (text) => sink?.appendLine('log', text),
    onScriptError: (message, line) => sink?.setError(message, line),
    onDone: () => sink?.appendLine('ok', 'script finished'),
    onRunningChange: (running) => sink?.setRunning(running),
    onUnresponsive: (unresponsive) => sink?.setUnresponsive(unresponsive),
  });
  // Burn/lock events echo into the console output pane (§7.9).
  addSimListener((e) => {
    if (e.type === 'burnStarted') sink?.appendLine('event', 'burn started');
    else if (e.type === 'burnEnded') sink?.appendLine('event', 'burn ended');
    else if (e.type === 'measurementAdded')
      sink?.appendLine('event', `measurement logged: ${e.measurement.data.kind}`);
  });
  if (sequenceRoot) {
    mountSequenceScreen(sequenceRoot, {
      storage: localStorage,
      console: bridge,
      bindConsole: (s) => {
        sink = s;
      },
    });
  }

  // ---- debug overlay (dev builds + ?debug=1 only; dynamic import so it
  // code-splits out of normal builds — see spec §10) ----
  if (isDebugEnabled(window.location.search, import.meta.env.DEV)) {
    const { mountDebugOverlay } = await import('./ui/debug/index');
    mountDebugOverlay(document.body, {
      subscribe: (cb) => {
        addSimListener(cb);
        return () => removeSimListener(cb);
      },
      send: post,
    });
  }
}

void main();
