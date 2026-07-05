// Global-scope neutralization for the player-script sandbox (mvp0_spec.md §8.1:
// "clean global scope — only the game API injected, no DOM/network/
// importScripts"). ADR-0002 documents the approach.
//
// A Web Worker's global still exposes network + storage + nested-worker
// constructors (fetch, XMLHttpRequest, WebSocket, importScripts, indexedDB,
// caches, Worker, ...). Player scripts run in this global, so we delete/shadow
// the dangerous names before any script runs. Two layers:
//   1. delete them off the worker global (`self`) so a script that reads a bare
//      identifier or `self.fetch` finds nothing;
//   2. additionally pass them as `undefined`-bound parameters into the script
//      function (see runner.ts) so even a re-materialized global can't leak in.
//
// Kept pure/injectable: `neutralizeGlobals(g)` takes the global object so it is
// testable against a plain stand-in without real worker globals.

// Names removed from the sandbox global. Network, storage, nested execution,
// and messaging surfaces (§8.1). `crypto.subtle` is harmless and left alone;
// Math/JSON/Promise/Date/console stay so scripts have a usable language.
export const FORBIDDEN_GLOBALS: readonly string[] = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'MessageChannel',
  'MessagePort',
  'Notification',
  'ServiceWorker',
  'navigator',
  'location',
  'postMessage', // the bridge captures its own reference before this runs
  'addEventListener',
  'removeEventListener',
  'close',
  'importScripts',
];

// Delete the forbidden names off the given global object. Uses delete first;
// for non-configurable properties (some hosts), falls back to shadowing with
// `undefined` via defineProperty. Silently ignores names that don't exist.
export function neutralizeGlobals(g: Record<string, unknown>): void {
  for (const name of FORBIDDEN_GLOBALS) {
    if (!(name in g)) {
      continue;
    }
    // ES modules run in strict mode, so `delete` on a non-configurable property
    // throws rather than returning false — isolate it so a throw here doesn't
    // skip the assignment/defineProperty fallbacks below.
    try {
      delete g[name];
    } catch {
      /* non-configurable: fall through to shadowing */
    }
    if (!(name in g)) {
      continue; // deleted cleanly
    }
    // Still present. Try a plain assignment (works if writable), then
    // defineProperty. A non-configurable + non-writable data property can't be
    // changed at all; the parameter-shadowing layer in runner.ts covers that.
    try {
      g[name] = undefined;
    } catch {
      /* non-writable: try defineProperty */
    }
    if (g[name] !== undefined) {
      try {
        Object.defineProperty(g, name, { value: undefined, configurable: false, writable: false });
      } catch {
        /* truly locked; best-effort only */
      }
    }
  }
}
