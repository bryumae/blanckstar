// Bootstrap (browser glue, lowest coverage tier): loads data, creates the two
// workers, mounts the app shell, wires up the three DOM screens, starts the
// render loop. No game logic here — see mvp0_spec.md §3 for the module
// boundaries this wires together.
import { mountShell } from './ui/shell';
import type { ScreenId } from './ui/shell';
import { mountTelescopeScreen } from './ui/telescope';
import { mountSequenceScreen } from './ui/sequence';
import type { ConsoleSink } from './ui/sequence';
import { mountDataScreen } from './ui/data';
import { mountEphemerisScreen } from './ui/ephemeris';
import { mountMeasurementLogScreen } from './ui/measurementLog';
import { createCandidateStore } from './ui/candidateStore';
import { createMeasurementMirror } from './ui/data/measurementMirror';
import { SandboxBridge } from './sandbox/bridge';
import { SANDBOX_RESERVED_VAR_NAMES } from './sandbox/apiDocs';
import { isDebugEnabled } from './ui/debug/gate';
import { loadEphemeris, loadStarCatalog } from './net/loadEphemeris';
import { createCurrentRun, ensureCurrentRun, readCurrentRun } from './net/currentRun';
import { SandboxVarsStore } from './net/sandboxVars';
import { SEEDS } from './sim/seeds';
import type { SimCommand, SimEvent, StateEvent } from './sim/messages';
import type { ScenarioSeed } from './sim/types';
import type { RenderFrameState, TelescopeInstruments } from './render/types';

const LAST_SEED_KEY = 'blanckstar.lastSeedId';

async function main(): Promise<void> {
  const appRoot = document.querySelector<HTMLElement>('#app-root');
  if (!appRoot) throw new Error('missing #app-root');

  const fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  const [ephemeris, starCatalog] = await Promise.all([
    loadEphemeris(fetchImpl),
    loadStarCatalog(fetchImpl),
  ]);

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
  addSimListener((e) => {
    if (e.type === 'state') {
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

  // ---- shared UI stores ----
  const candidates = createCandidateStore(localStorage);
  const sandboxVars = new SandboxVarsStore(localStorage, { reservedNames: SANDBOX_RESERVED_VAR_NAMES });
  const initialRun = readCurrentRun(localStorage);
  if (initialRun) sandboxVars.setNamespace(initialRun.gameId);
  const measurements = createMeasurementMirror();
  let simEpoch = 0;
  let currentSeedId: string | null = initialRun?.scenarioId ?? null;
  let bridge: SandboxBridge | null = null;
  const createGameId = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `game-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const setRunNamespace = (seedId: string, reuseExisting: boolean): void => {
    const run = reuseExisting
      ? ensureCurrentRun(localStorage, seedId, createGameId)
      : createCurrentRun(localStorage, seedId, createGameId);
    currentSeedId = seedId;
    sandboxVars.setNamespace(run.gameId);
  };
  const sendFromUi = (command: SimCommand): void => {
    if (command.type === 'reset' && currentSeedId) {
      bridge?.stop();
      setRunNamespace(currentSeedId, false);
    }
    post(command);
  };
  addSimListener((e) => {
    if (e.type === 'measurementAdded') measurements.add(e.measurement);
    else if (e.type === 'ready') {
      measurements.clear();
      simEpoch = e.epoch;
    }
  });

  // ---- app shell ----
  let currentMaxAcceleration: number | undefined;
  let telescopeRenderingEnabled = true;
  const shell = mountShell(appRoot, {
    seeds: SEEDS,
    getLastSeedId: () => localStorage.getItem(LAST_SEED_KEY),
    setLastSeedId: (id) => localStorage.setItem(LAST_SEED_KEY, id),
    send: sendFromUi,
    addSimListener,
    removeSimListener,
    onInit: (seed: ScenarioSeed) => {
      setRunNamespace(seed.id, true);
      currentMaxAcceleration = seed.maxAcceleration;
      post({ type: 'init', ephemeris, seed });
    },
    onScreenVisibility: (id: ScreenId, visible: boolean) => {
      if (id === 'telescope') telescopeRenderingEnabled = visible;
    },
  });

  // ---- telescope screen ----
  const instruments: TelescopeInstruments = {
    measureAngularSeparation(bodyA, bodyB) {
      return new Promise((resolve) => {
        pendingSeparation = resolve;
        post({ type: 'angularSeparation', bodyA, bodyB });
      });
    },
  };
  // Before a scenario is chosen (or immediately at mount, before the sim's
  // first state frame arrives) there is no live ship state yet — the
  // telescope mounts eagerly now that screens are always-mounted shell
  // content, so this must degrade gracefully rather than assume a state.
  const getFrameState = (): RenderFrameState => {
    if (!latestState) return { time: 0, shipPosition: { x: 0, y: 0, z: 0 }, shipForward: { x: 1, y: 0, z: 0 } };
    return { time: latestState.simTime, shipPosition: latestState.ship.position, shipForward: latestState.ship.forward };
  };
  const telescopeHandle = mountTelescopeScreen(shell.screenRoot('telescope'), {
    ephemeris,
    starCatalog,
    instruments,
    getFrameState,
  });
  addSimListener((e) => {
    if (e.type === 'ready') telescopeHandle.reset();
  });
  const loop = (): void => {
    if (telescopeRenderingEnabled && latestState) telescopeHandle.renderFrame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // ---- data screen ----
  mountDataScreen(shell.screenRoot('data'), {
    ephemeris,
    send: post,
    addSimListener,
    removeSimListener,
    candidates,
  });

  // ---- ephemeris screen ----
  mountEphemerisScreen(shell.screenRoot('ephemeris'), {
    ephemeris,
    addSimListener,
    removeSimListener,
  });

  // ---- measurement log screen ----
  mountMeasurementLogScreen(shell.screenRoot('measurementLog'), {
    mirror: measurements,
    send: post,
    simEpoch: () => simEpoch,
  });

  // ---- sandbox bridge + sequence screen ----
  let sink: ConsoleSink | null = null;
  bridge = new SandboxBridge({
    createSandboxWorker: () =>
      new Worker(new URL('./sandbox/worker.ts', import.meta.url), { type: 'module' }),
    postToSim: post,
    addSimListener,
    removeSimListener,
    ephemeris,
    sandboxVars,
    get maxAcceleration() {
      return currentMaxAcceleration;
    },
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
  mountSequenceScreen(shell.screenRoot('sequence'), {
    storage: localStorage,
    console: bridge,
    sandboxVars,
    bindConsole: (s) => {
      sink = s;
    },
  });

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
    // The debug overlay reads its rows off the state stream, but the sim
    // starts paused and won't emit a frame until the player picks a
    // scenario. Nudge a warp-0 (no-op) command once a seed is chosen so the
    // overlay isn't left showing dashes forever if the player never touches
    // warp themselves.
    addSimListener((e) => {
      if (e.type === 'ready') post({ type: 'setWarp', factor: 0 });
    });
  }
}

void main();
