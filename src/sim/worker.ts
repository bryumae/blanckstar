// Worker #1 entry point (mvp0_spec.md §3): simulation clock, tiered-timestep
// RK4 driver, and instrument models. Currently only wired for a console-visible
// ping/pong roundtrip to prove the Worker boundary works — no sim logic yet.
import type { SimWorkerMessage, SimWorkerResponse } from './messages';

self.addEventListener('message', (event: MessageEvent<SimWorkerMessage>) => {
  if (event.data.type === 'ping') {
    const response: SimWorkerResponse = { type: 'pong' };
    self.postMessage(response);
  }
});
