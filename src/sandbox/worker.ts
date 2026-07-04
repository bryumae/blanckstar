// Worker #2 entry point (mvp0_spec.md §8; ADR-0002): sandboxed player-script
// execution. Thin shell — it captures the worker's own postMessage/addEventListener
// in closures, neutralizes the dangerous globals, then runs each `run` command
// through the runner with a game API whose proxied calls round-trip to the bridge.
//
// Ordering matters: we grab `postMessage`/`addEventListener` references BEFORE
// neutralizeGlobals() deletes them, so the bridge channel survives even though a
// player script can no longer reach it.
import { neutralizeGlobals } from './neutralize';
import { buildGameApi, type CallBridge } from './api';
import { compileScript, extractLine } from './runner';
import type { SandboxCommand, SandboxOut, SandboxCallMethod } from './protocol';
import type { EphemerisData } from '../core/ephemerisTypes';

// Capture the bridge channel before neutralization removes it from `self`.
const workerSelf = self as unknown as {
  postMessage: (msg: SandboxOut) => void;
  addEventListener: (type: 'message', cb: (e: MessageEvent<SandboxCommand>) => void) => void;
};
const send = workerSelf.postMessage.bind(self);
const listen = workerSelf.addEventListener.bind(self);

neutralizeGlobals(self as unknown as Record<string, unknown>);

// Pending proxied calls awaiting a `reply` from the bridge, keyed by callId.
interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}
const pending = new Map<number, Pending>();
let nextCallId = 1;

// The CallBridge seam handed to the game API: post a `call`, park the promise.
const callBridge: CallBridge = (method: SandboxCallMethod, args: readonly unknown[]) =>
  new Promise<unknown>((resolve, reject) => {
    const callId = nextCallId++;
    pending.set(callId, { resolve, reject });
    send({ type: 'call', callId, method, args });
  });

// A run is in flight; used to reject orphaned calls if a new run starts.
function rejectAllPending(reason: string): void {
  for (const p of pending.values()) {
    p.reject(new Error(reason));
  }
  pending.clear();
}

async function runScript(source: string, ephemeris: EphemerisData): Promise<void> {
  const api = buildGameApi({
    callBridge,
    ephemeris,
    log: (text: string) => send({ type: 'log', text }),
  });

  let compiled;
  try {
    compiled = compileScript(source, api);
  } catch (err) {
    // Syntax error at compile time.
    send({
      type: 'scriptError',
      message: err instanceof Error ? err.message : String(err),
      line: extractLine(err),
    });
    return;
  }

  try {
    await compiled.run();
    send({ type: 'done' });
  } catch (err) {
    send({
      type: 'scriptError',
      message: err instanceof Error ? err.message : String(err),
      line: extractLine(err),
    });
  }
}

listen('message', (event: MessageEvent<SandboxCommand>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'ping':
      send({ type: 'heartbeat', nonce: msg.nonce });
      return;
    case 'reply': {
      const p = pending.get(msg.callId);
      if (!p) return;
      pending.delete(msg.callId);
      if (msg.ok) {
        p.resolve(msg.value);
      } else {
        p.reject(new Error(msg.error ?? 'bridge call failed'));
      }
      return;
    }
    case 'run':
      rejectAllPending('script restarted');
      void runScript(msg.source, msg.ephemeris);
      return;
  }
});
