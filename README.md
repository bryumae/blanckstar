# Blanckstar

A browser-based, true-scale, no-map spacecraft navigation simulator. Your ship
wakes in an unknown heliocentric orbit — the main computer is destroyed, and
the only working system is an emergency backup computer with a modern mission
interface. There is no map, no autopilot, and no correctness oracle: you
determine your position and velocity from instrument measurements, plan and
execute burns, and try to achieve a **temporary Earth capture** before the
ship runs out of orbit. Everything runs client-side in the browser — no
backend, no network dependency during gameplay, no audio.

Full design rationale lives in [`docs/mvp0_spec.md`](docs/mvp0_spec.md).

## Quickstart

```sh
npm install
npm run dev              # start the Vite dev server
npm run build             # type-check + production bundle
npm run preview           # preview the production build
npm test                  # vitest unit/integration suite (+coverage)
npm run test:e2e          # Playwright end-to-end suite (chromium/firefox/webkit)
npm run generate:ephemeris  # regenerate data/ephemeris.json from JPL Horizons
npm run generate:stars      # regenerate data/starCatalog.json
npm run validate:scenarios  # prove both seeds are winnable via a reference solution
```

`npm run dev` serves the game at `http://localhost:5173`. The ephemeris and
star catalog JSON in `data/` are generated offline and committed — the game
never fetches them from the network at runtime, only from the local static
build.

## Assumptions and physics model

- **Units**: SI internally (meters, seconds, kg, m/s, m/s², radians). All UI
  displays convert to km, km/s, degrees, and UTC human-readable timestamps.
- **Frame**: one inertial frame for everything — heliocentric ecliptic J2000,
  Sun at the origin, x/y plane the ecliptic.
- **Bodies**: Sun, Earth, and Moon gravitate (point masses, standard IAU μ
  constants); Mars, Venus, and Jupiter are visible, ephemeris-backed reference
  bodies with no gravitational effect on the ship.
- **Integrator**: fixed-step RK4, deterministic, tiered by distance to the
  nearest gravitating body (60 s cruise / 10 s Earth-Moon approach / 1 s close
  orbit). The same integrator drives live simulation, time warp, skip-to-time,
  and the trajectory predictor, so predictions from a correct state estimate
  are exact.
- **Ephemeris**: JPL Horizons-derived JSON, ~2 years of coverage from a
  present-day epoch, 1-day samples for planets and 1-hour samples for the
  Moon, cubic Hermite interpolation (position + velocity). Ephemeris
  generation treats TDB ≈ UTC — acceptable at the sub-second Horizons sample
  cadence used here, not a claim of general TDB/UTC equivalence.
- **Engine**: fictional high-thrust drive, forward-only thrust,
  point-then-burn — `ship.point(direction)` re-orients instantly (no attitude
  dynamics in MVP0), `ship.burn(throttle, duration)` thrusts along the current
  forward vector. Max acceleration is 0.5 m/s² by default (scenarios may
  override it); Δv is tracked as `throttle × maxAcceleration × duration` and
  shown cumulatively — this is the ship's own accelerometer, not derived
  truth. Mass (12,000 kg) is a fixed display value; physics uses acceleration
  directly, not thrust/mass.
- **Light-time honesty**: every apparent direction, size, and radio
  measurement in the game uses the true light-travel time. The telescope's
  outside view renders each body where it was when the light now reaching the
  ship was emitted; a radio lock's direction is Earth's position at
  transmission time, not now.
- **Truth hiding**: the ship's true position and velocity are never exposed to
  any normal-mode screen, log, or script API call. You only ever see what an
  instrument, radio lock, or your own inserted state analysis derives.

## Screens

The normal game interface has exactly three primary screens, switched from
the left nav rail; all three stay mounted so scripts and background
timers keep running while you look elsewhere.

- **Telescope** — an outside view (free-look starfield with light-time
  corrected Sun/Earth/Moon/Mars/Venus/Jupiter) and a telescope mode (zoom,
  click-to-identify, angular separation measurement between two identified
  bodies). No absolute bearing readout — only sensors and radio give you
  inertial-frame directions.
- **Sequence & Calculation** — the scripting console (editor, run/stop,
  console output) plus a scalar/vector calculator, a candidate state manager
  and candidate-search residual tables, and the trajectory predictor (runs
  the exact simulation engine over a player-entered state + optional burns,
  outputs tables only — no plots, no map).
- **Data** — everything else: radio/Earth beacon lock, ship self-knowledge
  (mass, max acceleration/thrust, attitude, Δv spent, engine state),
  scheduled burns (with cancel), ephemeris queries for any body at any time,
  time controls (warp + skip-to-time), the measurement log (exportable as
  text), and inserted-state analysis (closest approach and orbital elements
  computed from a player-entered candidate state — solar or Earth reference
  frame, clearly labeled estimate-derived, never using hidden truth).

Time warp (pause / 1× / 10× / 100× / 1,000× / 10,000×) is available both in
the header and on the Data screen; both control the same simulation clock.
The header also shows a live UTC/mission-elapsed clock, an Earth-beacon lock
indicator, and the active scenario badge.

## Debug mode

Passing `?debug=1` on a **dev build** (`npm run dev`, not the production
build) shows a watermarked debug overlay: true ship position/velocity,
Earth-relative energy/SOI/altitude, integrator diagnostics, a pannable/
zoomable solar-system map with trajectory trace, and a teleport tool. It is
gated on `import.meta.env.DEV` in addition to the query param, so it cannot be
reached in a production bundle regardless of URL.

## Scripting API

Player scripts are real JavaScript, run in a dedicated sandboxed Web Worker
with a clean global scope (no DOM, no network, no `importScripts`). Every
instrument/ship call and `wait()` is async — `await` them. Multiple named
scripts persist in `localStorage` and survive retries.

```js
// time
time.now()                       // -> Promise<number>, sim time (Unix seconds, UTC clock)
await wait(seconds)              // suspends the script while sim time advances

// logging
log(...values)                   // prints to the console pane
await log.measurements()         // -> Measurement[]; the full measurement log this run

// radio
const lock = await radio.lockEarth();
// -> { rangeMeters, direction: Vec3, quality, tSent, tReceived }
// direction is toward Earth's position AT TRANSMIT TIME (light-time honest)

// sensors + telescope
const sun = await sensors.sunDirection();      // -> Vec3, unit vector, inertial frame
const att = await sensors.starAttitude();      // -> { forward: Vec3 }
const theta = await telescope.angularSeparation('earth', 'mars'); // -> radians

// ephemeris (bodies: "sun"|"earth"|"moon"|"mars"|"venus"|"jupiter")
const p = await ephemeris.position('earth', time.now());  // -> Vec3, meters
const v = await ephemeris.velocity('earth', time.now());  // -> Vec3, m/s

// vector math (local, synchronous)
const a = vec(1, 0, 0);
add(a, b); sub(a, b); mul(a, 3); dot(a, b); cross(a, b);
norm(a); normalize(a); angleBetween(a, b);

// ship (point-then-burn, §5.3)
await ship.point(vec(0, 1, 0));           // instant re-orient, inertial frame
await ship.burn(1.0, 30);                 // throttle in [0,1], duration in seconds
const handle = ship.scheduleBurn(startTime, direction, throttle, duration);
await ship.cancelBurn(handle);
const status = await ship.status();
// -> { forward, deltaVSpent, burning, scheduledBurns, massKg, maxAcceleration, maxThrustNewtons }

// prediction — same engine as the live simulation, never validates truth
const samples = predict(
  { position, velocity, epoch },          // player-entered/candidate state
  [{ startTime, direction, throttle, duration }],  // burns, optional
  30 * 86400,                              // duration, seconds
  86400,                                   // stepOut, seconds between samples
);

// constants
C, MU_SUN, MU_EARTH, MU_MOON, R_EARTH, R_MOON, R_SOI_EARTH, AU, SHIP_MASS_KG
```

**Worked example** — take a radio lock and a sun-direction reading, then log
both:

```js
const lock = await radio.lockEarth();
log('range (km):', (lock.rangeMeters / 1000).toFixed(0));
log('earth dir:', lock.direction);

const sun = await sensors.sunDirection();
log('sun dir:', sun);
```

**Forbidden** (never exposed to scripts, regardless of debug mode):
`ship.truePosition()`, `ship.trueVelocity()`, `ship.currentOrbit()`,
`ship.distanceTo(body)`, any transfer/autopilot/route solver, `debug.*`. The
stop button always terminates the sandbox worker immediately; a runaway
script cannot hang the game.

## Win / lose conditions

**Win — temporary Earth capture.** All three hold simultaneously, checked
every integrator step:

```
|r_ship − r_earth| < R_SOI_EARTH        (≈ 0.929 × 10⁹ m)
v_rel²/2 − μ_earth/|r_rel| < 0            (bound, Earth-relative)
altitude above Earth's surface > 120 km
```

A highly elliptical capture orbit is acceptable — no circularization,
landing, or docking required. On success, a result overlay reveals the truth
now that the game is over: elapsed mission time, cumulative Δv spent, and the
final Earth-relative orbit (periapsis/apoapsis as center-distances,
eccentricity, inclination, period).

**Lose — destruction.** Altitude below 120 km burns the ship up; collision
with the Moon's surface or coming within 2 solar radii of the Sun also ends
the run. A failure overlay names the reason.

**Retry.** Both overlays offer retry-same-seed or choose-another-seed.
Scripts, notes, and saved candidate estimates persist across retries
(`localStorage`); the measurement log resets with the simulation.

## Scenarios

Two curated, deterministic seeds ship with MVP0 — no random generation. Both
start heliocentric, outside every body's sphere of influence, and not
trivially near Earth. Each is proven winnable by a developer reference
solution in `scripts/validateScenarios.ts`, which runs the seed through the
real simulation engine and asserts capture; this is wired into `npm test`.

- **Close call** (easy) — near 1 AU, a modest phase offset from Earth and a
  velocity within a couple of km/s of Earth's. Reachable with one or two
  burns after a couple of position fixes.
- **Long way home** (medium) — a 0.8–1.3 AU orbit with a larger phase offset
  and some inclination. Expect several fix/predict/correct cycles plus a
  capture burn.

## Limitations

- Angular separation measurement in the telescope UI is body-pairs only (no
  arbitrary sky-grid coordinates); absolute bearing comes only from the star
  tracker and radio-lock direction.
- `log.measurements()` inside a script reads the sandbox bridge's own mirror
  of the measurement log, which is page-lifetime (it does not clear on a sim
  reset/retry) — unlike the Data screen's measurement log table, which does
  clear on retry per §2.3. A script that calls `log.measurements()` right
  after a retry may still see entries from the previous run.
- Ephemeris generation treats TDB ≈ UTC (see Assumptions above).
- No measurement noise, clock error, or Doppler/range-rate instrument — every
  measurement is exact. No fuel mass loss, rocket equation, or finite
  rotation-rate attitude dynamics. No landing, docking, or station-keeping.
  No range-only radio hard mode (designed for, not built). No generic
  root-finder or Lambert solver in the calc workspace. No save/load of
  mid-run simulation state — only scripts/notes/candidates persist across a
  retry. No multiplayer, audio, mobile layout, or VR support.

See [`docs/mvp0_spec.md §11`](docs/mvp0_spec.md#11-explicitly-out-of-scope-for-mvp0)
for the complete out-of-scope list agreed for this milestone.
