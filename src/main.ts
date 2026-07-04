// Bootstrap (browser glue, lowest coverage tier): loads data, creates the two
// workers, wires up the three DOM screens, starts the render loop. No game
// logic here — see mvp0_spec.md §3 for the module boundaries this wires
// together.
import { mountTelescopeScreen } from './ui/telescope';
import { mountSequenceScreen } from './ui/sequence';
import { mountDataScreen } from './ui/data';
import { loadEphemeris, loadStarCatalog } from './net/loadEphemeris';
import { positionAt, velocityAt } from './core/ephemerisInterp';
import { add, mul, normalize, cross, vec3 } from './core/vector3';
import type { SimCommand, SimEvent, StateEvent } from './sim/messages';
import type { ScenarioSeed } from './sim/types';
import type { RenderFrameState, TelescopeInstruments } from './render/types';
import type { SandboxWorkerResponse } from './sandbox/messages';
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
  if (sequenceRoot) mountSequenceScreen(sequenceRoot);
  if (dataRoot) mountDataScreen(dataRoot);

  const fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  const [ephemeris, starCatalog] = await Promise.all([
    loadEphemeris(fetchImpl),
    loadStarCatalog(fetchImpl),
  ]);

  const simWorker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
  const post = (command: SimCommand): void => simWorker.postMessage(command);

  let latestState: StateEvent | null = null;
  let pendingSeparation: ((result: { radians: number; id: string }) => void) | null = null;
  const firstState = new Promise<StateEvent>((resolve) => {
    const onMessage = (event: MessageEvent<SimEvent>): void => {
      const e = event.data;
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
    };
    simWorker.addEventListener('message', onMessage);
  });

  post({ type: 'init', ephemeris, seed: devSeed(ephemeris) });
  await firstState;

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

  // Sandbox worker still speaks the scaffold ping protocol; the script-sandbox
  // phase (#8) replaces this wiring.
  const sandboxWorker = new Worker(new URL('./sandbox/worker.ts', import.meta.url), {
    type: 'module',
  });
  sandboxWorker.addEventListener('message', (event: MessageEvent<SandboxWorkerResponse>) => {
    console.log('[sandbox worker]', event.data.type);
  });
  sandboxWorker.postMessage({ type: 'ping' });
}

void main();
