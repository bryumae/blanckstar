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
import { FORBIDDEN_GLOBALS } from './neutralize';

// Non-API names re-bound to `undefined` in the script scope (§8.3). Two groups:
//   - hint names the design deliberately withholds (`debug`/`solveTransfer`/
//     `autopilot`): shadowed so they resolve to undefined, not any ambient value;
//   - the §8.1 forbidden network/storage/messaging globals: this parameter layer
//     is the belt-and-braces backstop neutralize.ts's comment promises for the
//     case where deleting/redefining a non-configurable global fails on some
//     host. Previously this list omitted them, so that backstop did not exist.
// Deduped because FORBIDDEN_GLOBALS lists a couple of names twice and duplicate
// function parameters are a SyntaxError.
export const SHADOWED_NAMES: readonly string[] = [
  ...new Set<string>(['debug', 'solveTransfer', 'autopilot', ...FORBIDDEN_GLOBALS]),
];

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
// usable frame is found.
export function extractLine(err: unknown): number | null {
  if (!(err instanceof Error) || typeof err.stack !== 'string') {
    return null;
  }
  // Match the first frame that mentions an anonymous/eval/AsyncFunction source.
  const m =
    err.stack.match(/<anonymous>:(\d+):\d+/) ??
    err.stack.match(/AsyncFunction:(\d+):\d+/) ??
    err.stack.match(/eval.*?:(\d+):\d+/);
  if (!m) {
    return null;
  }
  const raw = Number(m[1]);
  // AsyncFunction bodies are offset by the synthetic function wrapper:
  // `async function anonymous(...params\n) {\n<player source>`.
  return Number.isFinite(raw) ? Math.max(1, raw - 2) : null;
}

// Compile `source` into a runnable async function bound to `api`. Throws
// synchronously on a syntax error (caller reports it as a script error).
export function compileScript(source: string, api: GameApi): CompiledScript {
  const apiNames = Object.keys(api);
  // An injected API name wins over a shadow of the same name; keeping both would
  // make a duplicate function parameter (a SyntaxError). None collide today.
  const shadowNames = SHADOWED_NAMES.filter((n) => !apiNames.includes(n));
  const paramNames = [...apiNames, ...shadowNames];
  const fn = new AsyncFunction(...paramNames, source);
  const apiValues = apiNames.map((n) => api[n]);
  const shadowValues = shadowNames.map(() => undefined);
  return {
    run: () => fn(...apiValues, ...shadowValues),
  };
}
