// Script execution model for the sandbox worker (mvp0_spec.md §8.1; ADR-0002).
//
// A player script is compiled as the body of an *async* function whose
// parameters are the injected game-API names, so players write `await
// wait(600)` and `await ship.burn(...)` naturally against ordinary locals. The
// contract (§8.1): instrument/ship/wait calls return Promises and scripts should
// await them; script-visible sim time only advances during `await wait(s)`.
//
// The parameter list also re-binds the §8.3 forbidden names to `undefined` as a
// second layer over neutralize.ts — inside the function body `ship` is the
// injected object with no truePosition/etc., and bare `debug`/`solveTransfer`/
// `autopilot` resolve to the shadowing params rather than any ambient global.
import type { GameApi } from './api';

// Names shadowed to `undefined` in the script scope on top of the injected API
// (§8.3). `ship`/`debug` etc.: the injected `ship` has only the allowed methods;
// `debug`, `solveTransfer`, `autopilot` are shadowed so they resolve to
// undefined instead of any ambient value.
export const SHADOWED_NAMES: readonly string[] = ['debug', 'solveTransfer', 'autopilot'];

// The async function constructor (not exposed to the script). Obtained via the
// prototype of an async function so we don't reference a global by name.
const AsyncFunction = Object.getPrototypeOf(async function () {
  /* marker */
}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

export interface CompiledScript {
  readonly run: () => Promise<unknown>;
}

// Parse a 1-based source line from an Error stack, if the runtime attached one
// that references the compiled function. Best-effort: returns null when no
// usable frame is found. The compiled body starts at line 1 of the anonymous
// function, so we report the raw line from the top frame.
export function extractLine(err: unknown): number | null {
  if (!(err instanceof Error) || typeof err.stack !== 'string') {
    return null;
  }
  // Match "<anonymous>:LINE:COL" or ":LINE:COL)" in the first frame that
  // mentions an anonymous/eval source (the AsyncFunction body).
  const m = err.stack.match(/<anonymous>:(\d+):\d+/) ?? err.stack.match(/eval.*?:(\d+):\d+/);
  if (!m) {
    return null;
  }
  const raw = Number(m[1]);
  // AsyncFunction bodies are offset by the synthetic function header line; the
  // player's line 1 shows as stack line 2 in V8. Subtract when it looks offset.
  return Number.isFinite(raw) ? Math.max(1, raw - 1) : null;
}

// Compile `source` into a runnable async function bound to `api`. Throws
// synchronously on a syntax error (caller reports it as a script error).
export function compileScript(source: string, api: GameApi): CompiledScript {
  const apiNames = Object.keys(api);
  const paramNames = [...apiNames, ...SHADOWED_NAMES];
  const fn = new AsyncFunction(...paramNames, source);
  const apiValues = apiNames.map((n) => api[n]);
  const shadowValues = SHADOWED_NAMES.map(() => undefined);
  return {
    run: () => fn(...apiValues, ...shadowValues),
  };
}
