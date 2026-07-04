// Worker #2 entry point (mvp0_spec.md §8): sandboxed player-script execution
// with a clean global scope (no DOM/network/importScripts). Currently only
// wired for a console-visible ping/pong roundtrip — no script bootstrap, API
// injection, or forbidden-API enforcement yet.
import type { SandboxWorkerMessage, SandboxWorkerResponse } from './messages';

self.addEventListener('message', (event: MessageEvent<SandboxWorkerMessage>) => {
  if (event.data.type === 'ping') {
    const response: SandboxWorkerResponse = { type: 'pong' };
    self.postMessage(response);
  }
});
