// Bootstrap (browser glue, lowest coverage tier): creates the two workers,
// wires up the three DOM screens, starts the render loop. No game logic here —
// see mvp0_spec.md §3 for the module boundaries this wires together.
import { createScene } from './render/scene';
import { mountTelescopeScreen } from './ui/telescope';
import { mountSequenceScreen } from './ui/sequence';
import { mountDataScreen } from './ui/data';
import type { SimWorkerResponse } from './sim/messages';
import type { SandboxWorkerResponse } from './sandbox/messages';

function main(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  if (canvas) {
    createScene(canvas);
  }

  const telescopeRoot = document.querySelector<HTMLElement>('#screen-telescope');
  const sequenceRoot = document.querySelector<HTMLElement>('#screen-sequence');
  const dataRoot = document.querySelector<HTMLElement>('#screen-data');
  if (telescopeRoot) mountTelescopeScreen(telescopeRoot);
  if (sequenceRoot) mountSequenceScreen(sequenceRoot);
  if (dataRoot) mountDataScreen(dataRoot);

  const simWorker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
  simWorker.addEventListener('message', (event: MessageEvent<SimWorkerResponse>) => {
    console.log('[sim worker]', event.data.type);
  });
  simWorker.postMessage({ type: 'ping' });

  const sandboxWorker = new Worker(new URL('./sandbox/worker.ts', import.meta.url), { type: 'module' });
  sandboxWorker.addEventListener('message', (event: MessageEvent<SandboxWorkerResponse>) => {
    console.log('[sandbox worker]', event.data.type);
  });
  sandboxWorker.postMessage({ type: 'ping' });
}

main();
