// Central sandbox-API metadata registry (issue #30). The single source of
// truth for the Script Console's read-only API reference drawers, and later
// for #32 autocomplete and README generation. Pure data + pure filter/sort
// functions — no DOM — living next to api.ts because the registry documents
// exactly the surface buildGameApi() assembles (tested by set-equality in
// tests/unit/sandboxApiDocs.test.ts).
//
// The forbidden surface (mvp0_spec.md §8.3: ship.truePosition/trueVelocity/
// currentOrbit/distanceTo, solveTransfer, autopilot, debug.*) never appears
// here, mirroring api.ts never assembling it.
import {
  C,
  MU_SUN,
  MU_EARTH,
  MU_MOON,
  R_EARTH,
  R_MOON,
  R_SOI_EARTH,
  AU,
  SHIP_MASS_KG,
} from '../core/constants';

export type SandboxApiDocBase = {
  name: string;
  description: string;
  source: 'builtin' | 'player'; // 'player' unused until #31; renderers support it now
};

export type SandboxVariableDoc = SandboxApiDocBase & {
  kind: 'variable';
  // Rendered value, e.g. "299792458". Numbers are the norm and carry no type
  // prefix; a future non-number variable spells its type out here.
  value: string;
  modified?: number;
};

export type SandboxFunctionDoc = SandboxApiDocBase & {
  kind: 'function';
  args: string; // machine-friendly; #32 feeds autocomplete from it
  async: boolean;
};

export type SandboxApiDoc = SandboxVariableDoc | SandboxFunctionDoc;

// The forbidden surface (spec §8.3) — never assembled by api.ts and never
// documented here. Exported so the registry, drawer, and e2e tests assert
// absence against one list instead of three hand-copies.
export const FORBIDDEN_API_NAMES = [
  'ship.truePosition',
  'ship.trueVelocity',
  'ship.currentOrbit',
  'ship.distanceTo',
  'solveTransfer',
  'autopilot',
  'debug',
] as const;

const SYNC = 'Synchronous — no await.';

function constant(name: string, value: number, description: string): SandboxVariableDoc {
  return { kind: 'variable', name, description, source: 'builtin', value: String(value) };
}

function asyncFn(name: string, args: string, description: string): SandboxFunctionDoc {
  return { kind: 'function', name, args, description, source: 'builtin', async: true };
}

function syncFn(name: string, args: string, description: string): SandboxFunctionDoc {
  return { kind: 'function', name, args, description, source: 'builtin', async: false };
}

export const SANDBOX_API_DOCS: readonly SandboxApiDoc[] = [
  // ---- time ----
  asyncFn('time.now', '', 'Async. Use await time.now(). Current sim time as Unix seconds (UTC clock).'),
  asyncFn(
    'wait',
    'seconds',
    'Async. Use await wait(seconds). Suspends the script while sim time advances.',
  ),

  // ---- logging ----
  syncFn('log', '...values', `${SYNC} Prints values to the console output pane.`),
  asyncFn(
    'log.measurements',
    '',
    'Async. Use await log.measurements(). Returns the full measurement log for this run.',
  ),
  {
    kind: 'variable',
    name: 'vars',
    description:
      'Synchronous — no await. Persistent player workspace for this game run; assign vars.name = value, read vars.name, or delete vars.name.',
    source: 'builtin',
    value: '{...}',
  },

  // ---- radio / sensors / telescope ----
  asyncFn(
    'radio.lockEarth',
    '',
    'Async. Use await radio.lockEarth(). Locks the Earth beacon; returns { rangeMeters, direction, quality, tSent, tReceived } — direction toward Earth at transmit time (light-time honest).',
  ),
  asyncFn(
    'sensors.sunDirection',
    '',
    'Async. Use await sensors.sunDirection(). Unit vector toward the Sun, inertial frame.',
  ),
  asyncFn(
    'sensors.starAttitude',
    '',
    'Async. Use await sensors.starAttitude(). Ship attitude from the star tracker: { forward }.',
  ),
  asyncFn(
    'telescope.angularSeparation',
    'bodyA, bodyB',
    'Async. Use await telescope.angularSeparation(a, b). Angular separation between two bodies, radians.',
  ),

  // ---- ephemeris ----
  asyncFn(
    'ephemeris.position',
    'body, t',
    'Async. Use await ephemeris.position(body, t). Body position at sim time t, meters (sun/earth/moon/mars/venus/jupiter).',
  ),
  asyncFn(
    'ephemeris.velocity',
    'body, t',
    'Async. Use await ephemeris.velocity(body, t). Body velocity at sim time t, m/s.',
  ),

  // ---- vector math (local, pure) ----
  syncFn('vec', 'x, y, z', `${SYNC} Builds a 3-vector { x, y, z }.`),
  syncFn('add', 'a, b', `${SYNC} Vector sum a + b.`),
  syncFn('sub', 'a, b', `${SYNC} Vector difference a - b.`),
  syncFn('mul', 'a, s', `${SYNC} Vector a scaled by s.`),
  syncFn('dot', 'a, b', `${SYNC} Dot product of a and b.`),
  syncFn('cross', 'a, b', `${SYNC} Cross product of a and b.`),
  syncFn('norm', 'a', `${SYNC} Euclidean length of a.`),
  syncFn('normalize', 'a', `${SYNC} Unit vector in the direction of a.`),
  syncFn('angleBetween', 'a, b', `${SYNC} Angle between a and b, radians.`),

  // ---- ship ----
  asyncFn(
    'ship.point',
    'direction',
    'Async. Use await ship.point(direction). Instantly re-orients the ship along direction, inertial frame.',
  ),
  asyncFn(
    'ship.burn',
    'throttle, seconds',
    'Async. Use await ship.burn(throttle, seconds). Burns along the current forward; throttle in [0,1].',
  ),
  asyncFn(
    'ship.scheduleBurn',
    'startTime, direction, throttle, duration',
    'Async. Use await ship.scheduleBurn(startTime, direction, throttle, duration). Schedules a future burn; resolves to a cancel handle.',
  ),
  asyncFn(
    'ship.cancelBurn',
    'handle',
    'Async. Use await ship.cancelBurn(handle). Cancels a scheduled burn by its handle.',
  ),
  asyncFn(
    'ship.status',
    '',
    'Async. Use await ship.status(). Self-knowledge only: { forward, deltaVSpent, burning, scheduledBurns, massKg, maxAcceleration, maxThrustNewtons }.',
  ),

  // ---- prediction (local, pure — same engine as the sim) ----
  syncFn(
    'predict',
    'state, burns, duration, stepOut',
    `${SYNC} Propagates a player-entered { position, velocity, epoch } state with optional burns; returns trajectory samples. Same engine as the sim; never validates truth.`,
  ),

  // ---- constants ----
  constant('C', C, 'Speed of light, m/s.'),
  constant('MU_SUN', MU_SUN, 'Sun gravitational parameter, m^3/s^2.'),
  constant('MU_EARTH', MU_EARTH, 'Earth gravitational parameter, m^3/s^2.'),
  constant('MU_MOON', MU_MOON, 'Moon gravitational parameter, m^3/s^2.'),
  constant('R_EARTH', R_EARTH, 'Earth mean radius, meters.'),
  constant('R_MOON', R_MOON, 'Moon mean radius, meters.'),
  constant('R_SOI_EARTH', R_SOI_EARTH, 'Earth sphere-of-influence radius, meters.'),
  constant('AU', AU, 'Astronomical unit, meters.'),
  constant('SHIP_MASS_KG', SHIP_MASS_KG, 'Ship wet mass, kg.'),
];

export const SANDBOX_RESERVED_VAR_NAMES: ReadonlySet<string> = new Set([
  ...SANDBOX_API_DOCS.map((doc) => doc.name),
  ...SANDBOX_API_DOCS.map((doc) => doc.name.split('.')[0]!),
  'vars',
]);

export type SandboxApiSortKey = 'name' | 'description' | 'modified';
export type SandboxApiSortDirection = 'asc' | 'desc';

// Case-insensitive substring filter over name + description. Empty (or
// whitespace-only) query is the identity.
export function filterDocs<T extends SandboxApiDoc>(docs: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...docs];
  return docs.filter(
    (d) => d.name.toLowerCase().includes(q) || d.description.toLowerCase().includes(q),
  );
}

// Stable, case-insensitive sort on the given key. Never mutates the input;
// equal keys keep registry order.
export function sortDocs<T extends SandboxApiDoc>(
  docs: readonly T[],
  key: SandboxApiSortKey,
  direction: SandboxApiSortDirection,
): T[] {
  const sign = direction === 'desc' ? -1 : 1;
  return [...docs].sort((a, b) => {
    if (key === 'modified') {
      return sign * ((a.kind === 'variable' ? (a.modified ?? 0) : 0) - (b.kind === 'variable' ? (b.modified ?? 0) : 0));
    }
    return sign * a[key].toLowerCase().localeCompare(b[key].toLowerCase());
  });
}
