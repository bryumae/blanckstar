# MVP0 / Phase 0 Specification — Space Navigation Simulator

Status: **agreed spec**, synthesized from `bryum_proposal.md` and `bvt-proposal.md` after discussion on 2026-07-03. Where the proposals conflicted, the resolution recorded here is final for MVP0. This document does not modify the original proposals.

---

## 1. Game Definition

A browser-based, true-scale, no-map spacecraft navigation simulator. The player wakes aboard a ship in an unknown heliocentric orbit (wormhole return, main computer destroyed — narrative per bvt-proposal §5). The only working system is an emergency backup computer with a modern mission interface organized into three primary screens: **Telescope**, **Sequence & Calculation**, and **Data**. One part of the Sequence & Calculation screen is a **programmable script console**.

The player must determine position and velocity from measurements, plan burns, and achieve **temporary Earth capture**.

Core loop (both proposals agree):

```
Observe → Measure → Calculate → Estimate state → Plan burn → Execute burn → Re-measure → Correct
```

Central design rule: **the simulation knows the truth; the player must earn knowledge through instruments and computation.** No map, no autopilot, no transfer solver, no correctness oracle.

### Resolved: interaction model

MVP0 is a **hybrid**: manual instruments (bryum) *plus* full scripting (bvt) as one instrument among them. The GUI screens and the script API read the same underlying instrument models — a radio lock taken from the Data screen and one taken by `radio.lockEarth()` are the same measurement type, and both land in the measurement log.

---

## 2. Win / Lose Conditions

### 2.1 Win — Earth capture

Success when all three hold simultaneously:

```
|r_ship − r_earth| < R_SOI_earth        (≈ 0.929 × 10⁹ m)
AND  v_rel²/2 − μ_earth/|r_rel| < 0     (negative Earth-relative specific energy)
AND  altitude above Earth surface > 120 km
```

A highly elliptical capture orbit is acceptable. No circularization, landing, or docking. The condition is checked every integrator step; on success, a result overlay shows summary stats (elapsed mission time, Δv spent, final Earth-relative orbit parameters — revealing truth is fine once the game is over).

### 2.2 Lose — atmospheric destruction

If altitude above Earth's surface drops below **120 km**, the ship burns up. Collision with the Moon (below lunar surface radius) or the Sun (below 2 solar radii) also destroys the ship.

### 2.3 Retry

After failure: show failure reason, allow restart from the same seed or another seed. **Script text, notes, and saved candidate estimates persist across retries** (localStorage). Measurement log resets with the simulation.

---

## 3. Tech Stack

```
TypeScript + Vite
Three.js                 — rendering only (starfield, outside/telescope view)
HTML/CSS                 — all application screens and data modules (DOM, not canvas)
Web Worker #1            — simulation (physics, clock, instruments)
Web Worker #2            — player script sandbox
localStorage             — scripts, notes, candidates, settings
Local JSON               — ephemeris + star catalog (generated offline)
No backend. No network dependency during gameplay. No audio.
```

Runs with `npm install && npm run dev`; builds with `npm run build`.

### Resolved: renderer

**Three.js** (bryum's pick). Rendering needs in MVP0 are modest; Three.js is lighter and better documented for this scope.

---

## 4. Physical Model

### 4.1 Units and frame

**SI internally** (bvt): meters, seconds, kilograms, m/s, m/s², newtons, radians.
**UI displays**: km, km/s, degrees, human dates/times in UTC. All screens/modules label units explicitly.

One inertial frame for everything: **heliocentric ecliptic J2000**. Sun at origin `(0,0,0)`, x/y plane = ecliptic, z perpendicular. All ephemeris data converted to this frame at generation time. All player-facing coordinates are in this frame.

(Resolves bryum §3.4 vs bvt §7.1: bvt's SI-internal wins; bryum's km appear only in display formatting.)

### 4.2 Bodies

| Body    | Gravitates | Visible | In ephemeris DB |
|---------|-----------|---------|-----------------|
| Sun     | yes       | yes     | yes (origin)    |
| Earth   | yes       | yes     | yes             |
| Moon    | yes       | yes     | yes             |
| Mars    | no        | yes     | yes             |
| Venus   | no        | yes     | yes             |
| Jupiter | no        | yes     | yes             |

**Resolved** (bryum's 4-body gravity vs bvt's 3-body): gravity = **Sun + Earth + Moon only**. Mars, Venus, Jupiter are visible ephemeris-reference bodies — usable for telescope sightings and position fixing, exerting no force. This keeps the player's trajectory-prediction mental model minimal and matches an Earth-return mission profile.

### 4.3 Gravity

Ship is a massless test particle:

```
a_body    = μ_body × (r_body − r_ship) / |r_body − r_ship|³
a_gravity = a_sun + a_earth + a_moon
```

μ values: standard IAU constants (hardcoded in `constants.ts`). No other forces: no drag above 120 km, no SRP, no randomness. Ship state changes only from gravity and commanded burns.

### 4.4 Integrator

Fixed-step **RK4**, deterministic. One integrator implementation shared by live simulation, time warp, skip-to-time, and the trajectory predictor (bryum §15 — this guarantees the predictor is *exact* when fed the true state).

**Resolved** (bryum open question #5) — timestep is tiered by distance to the nearest gravitating body:

```
d > 10⁹ m   (heliocentric cruise)   dt = 60 s
10⁷–10⁹ m   (Earth/Moon approach)   dt = 10 s
d < 10⁷ m   (close orbit)           dt = 1 s
```

Time warp runs physics substeps at these dt values — never one large step. Burn start/end times are snapped into the step sequence so a burn boundary always falls on a step boundary (split the step at the boundary).

### 4.5 Ephemeris

**Resolved** (bryum open questions #3, #4): offline generation from **JPL Horizons** → local JSON, per bvt §18.1 schema (position + velocity samples). Coverage: **present-day epoch, ~2 years** from scenario start. Sample intervals: **1 day for planets, 1 hour for the Moon**. Interpolation: **cubic Hermite** using position+velocity (linear acceptable only as a bring-up stub).

Generation script: `scripts/generateEphemeris.ts`, run at build time, never at runtime.

### 4.6 Rendering precision

Spacecraft-centered floating origin (bvt §7.7): render positions are `(body_pos − ship_pos) × scale`, physics state stays absolute double-precision. Never feed raw heliocentric meters into Three.js transforms.

---

## 5. Spacecraft

### 5.1 State

```
position  : Vector3 (m, heliocentric ecliptic)
velocity  : Vector3 (m/s)
attitude  : unit forward vector (see 5.3)
mass      : 12,000 kg constant, irrelevant to dynamics (accel is specified directly)
```

Position and velocity are hidden from the player and exposed only in debug mode. Mass is ship self-knowledge: a hardcoded **12,000 kg** display value used only to present ship specs and equivalent thrust in the Data screen.

### 5.2 Engine

Fictional high-thrust drive:

- **max acceleration = 0.5 m/s²** (resolved between bryum's 2 and bvt's 0.01–0.1; per-scenario override allowed)
- throttle ∈ [0, 1]; `a_engine = throttle × 0.5 m/s²`
- equivalent max thrust is displayed as `12,000 kg × maxAcceleration` (6,000 N at the default 0.5 m/s²); physics still uses acceleration directly
- unlimited fuel, constant mass, no rocket equation (both proposals agree for MVP)
- finite burns only — no impulsive Δv
- **forward-only thrust**: the engine pushes along the ship's current forward vector

Δv bookkeeping: `Δv = throttle × 0.5 × duration` — tracked and shown in the ship data module (cumulative Δv spent is allowed knowledge; it's the ship's own accelerometer).

### 5.3 Attitude — point-then-burn

**Resolved** (bryum's yaw/pitch/roll config vs bvt's point-and-burn): **point-then-burn**.

- `ship.point(direction)` — direction is a unit vector **in the heliocentric ecliptic inertial frame** (the star tracker gives the ship absolute attitude knowledge, so commanding inertial directions is fair).
- In MVP0 reorientation is **instantaneous** (rotation rates, attitude dynamics, and quaternion state deferred to a later phase; the internal representation is just the forward vector).
- `ship.burn(throttle, durationSeconds)` — thrust along current forward vector for the given duration.

Burns may also be **scheduled**: `ship.scheduleBurn(startTime, direction, throttle, duration)` — executes during warp/skip without the script running. Scheduled burns appear in, and can be cancelled from, the ship data module. This preserves bryum's declarative burn-plan workflow on top of the point/burn primitives.

No arbitrary-vector thrust without pointing; no RCS translation.

---

## 6. Time System

**Resolved: both** mechanisms, over one simulation clock.

- **Warp**: pause / 1× / 10× / 100× / 1,000× / 10,000×. Physics always substeps per §4.4.
- **Skip-to-time**: "advance N hours/days" command (GUI button + `wait(seconds)` in scripts). Runs the same substepped propagation; scheduled burns inside the interval execute correctly.
- Skip/warp **auto-interrupts** on: scheduled burn start, SOI entry, win condition, failure condition, script `wait()` completion.
- Clock is exact — no drift, no timekeeping error. Displayed as UTC datetime plus mission-elapsed time.
- All date/time inputs, logs, exports, and displayed timestamps use UTC. Player scripts use Unix seconds from the same UTC-based simulation clock.
- Epoch: a real present-day date (fixed per scenario seed, e.g. `2026-09-01T00:00:00Z`), so the sky matches reality.

While a player script is running, sim time only advances through the script's `wait()` calls or scheduled activity — the script and the clock never race.

---

## 7. User Interface and Instruments

The UI is a modern mission-operations application. The normal game interface has exactly three primary screens; modules and tabs inside those screens are allowed when they keep the workflow clear. Do not use copied OS assets, logos, sounds, or interface chrome.

Primary screens:

1. **Telescope** — outside view and telescope workflow: starfield, bodies, zoom, identification, and angular separation measurements.
2. **Sequence & Calculation** — sequence coding plus calculation space. It may use tabs for scripts, console output, calculator, candidate estimates, candidate-search tables, and trajectory prediction.
3. **Data** — all remaining operational data: radio locks, Earth beacon status/light-time details, ephemeris queries, measurement log, ship information, scheduled burns, active script status, time controls, and entered-state analysis.

The Data screen is also where the player analyzes any **inserted state**: a player-entered or selected candidate position+velocity+epoch. From that inserted state only, the game displays closest approach to Earth over a selected prediction horizon, an extension point for later closest-approach readouts to other planets, and orbital information. These readouts must be clearly labeled as estimate-derived and must never use the hidden true ship state.

Inserted-state orbital information:

- If the inserted state is treated as a solar orbit, orbital elements are computed relative to the Sun and inclination is measured against the solar ecliptic plane.
- If the inserted state is treated as an Earth orbit, orbital elements are computed relative to Earth and inclination is measured against the Earth ecliptic plane.
- Periapsis and apoapsis are displayed as distances from the center of the orbit, not as altitude above a surface. Earth-orbit labels may also show perigee/apogee as the Earth-centered periapsis/apoapsis distances.

### 7.1 Outside view + telescope

One Three.js viewport with two modes:

**Outside view** — the sky from the ship's true receive-time position: real bright-star catalog + Sun/Earth/Moon/Mars/Venus/Jupiter at light-time-corrected apparent directions. For each visible solar-system body, solve for the emission time `t_emit` such that light from `body_pos(t_emit)` reaches `ship_pos(t_now)` at `t_now`; render the body where it was when the light was emitted, not where it is at `t_now`. Angular sizes (`2·atan(R/d)`) and brightness (stars: catalogue magnitude; planets: simplified `reflected × phase / d²`; Sun: `1/d²`) use the light-time-corrected distance/phase. Bodies far away render as points but keep model-based brightness. Free look (drag), no position readout.

**Telescope mode** — zoom (FOV control), reticle, and:

- **click-to-identify**: clicking a star or body shows its name; identified bodies can be labelled. No auto-find, no search-to-target (bryum §7.5).
- **angular separation measurement**: select two identified bodies → measured `θ = arccos(u_A·u_B)`, exact, auto-logged to the measurement log.
- The telescope does **not** provide absolute bearing / az-el / sky-grid coordinates (bryum §7.6). Absolute directions come only from the star tracker sensor (§7.3) and radio-lock direction (§7.2).

Stars are fixed on the sky (no parallax from ship motion). Catalog: filtered real bright-star set (~5,000 stars: RA, dec, magnitude, name where known), generated offline by `scripts/generateStarCatalog.ts`.

### 7.2 Radio data — Earth beacon

**Resolved: Level 1** (bvt §9.2) is the MVP0 behavior. On lock, the player gets:

```
range          = c × (t_received − t_sent)      exact, meters
direction      = unit vector to Earth-at-transmit-time, inertial frame
signal quality = cosmetic constant in MVP0
```

Light-time is honest: range and direction correspond to **Earth's position at transmission time** (bryum §8). `c = 299,792,458 m/s`. No noise, no clock error. Each lock is a discrete measurement event, auto-logged. Range-only hard mode (Level 3) is a post-MVP0 difficulty flag — the instrument model must keep direction separable so it can be switched off later.

The script API exposes radio measurements only through discrete locks. There are no separate range or direction convenience accessors; scripts should use the return value from `radio.lockEarth()` or read prior locks from `log.measurements()`.

### 7.3 Sensors

- `sensors.sunDirection()` — unit vector to the Sun, inertial frame, exact.
- `sensors.starAttitude()` — ship attitude relative to the inertial frame (this is what justifies inertial-frame `ship.point()`).

### 7.4 Ephemeris data

Query any body's position (and velocity) at any time within data coverage; displayed as heliocentric ecliptic Cartesian km. Never shows ship state (bryum §9). Same data as `ephemeris.*` script API.

### 7.5 Measurement log

Auto-recording, timestamped, append-only log of every measurement taken this run: radio locks (range, direction), angular separations, sun-direction reads. Reviewable in a table; exportable as text; readable from scripts via `log.measurements()`. Player may attach notes to entries.

### 7.6 Calculation workspace

Per bryum §13, tools not answers:

- scalar/vector calculator (dot, cross, norm, normalize, angleBetween, trig, arccos)
- **candidate estimate manager**: save/name/compare position+velocity estimates; unlimited count (resolves bryum open question #6); persisted in localStorage
- **candidate-search tables** (bryum §13 workflow): enter coordinate ranges + step + which logged measurements to compare → table of mismatch values per candidate. Evaluates constraint residuals only; never reveals truth, never labels a candidate correct.
- free-text notes area with import/export as plain text (resolves bryum open question #7: **yes**)
- **No** generic numerical root-finder in MVP0 (resolves bryum open question #2: candidate tables + scripting cover it; the player can write their own solver in the console)

Forbidden everywhere (both proposals): hidden-position solver, route-to-Earth solver, optimal-burn solver, correctness checker against truth.

### 7.7 Trajectory predictor

Sequence & Calculation module and script API over the same engine. Inputs: **player-entered** position + velocity estimate (typically a saved candidate), optional burn list, prediction duration. Output: **tables only** — time series of predicted coordinates, distances to Earth/Moon/Mars, Earth-relative speed. Uses the exact same RK4 + gravity model + ephemeris as the simulation. No map, no plots (bryum §14: tables only in MVP0). It simulates consequences of the entered state; it never validates the state. The Data screen's inserted-state analysis may summarize this prediction output as closest approach and orbital elements.

### 7.8 Ship data

Shows only self-knowledge: hardcoded 12,000 kg mass, max acceleration, equivalent max thrust, current attitude (forward vector, inertial frame — the star tracker knows it), engine state, cumulative Δv spent, scheduled burns (with cancel), mission clock, active script status. **Never position or velocity.**

### 7.9 Sequence coding console

Editor + run/stop + console output (logs, errors, burn events, lock events). Multiple named scripts, persisted. See §8.

---

## 8. Scripting System

### 8.1 Engine — sandboxed real JavaScript

**Resolved** (bvt's custom mini-language vs alternatives): player scripts are **real JavaScript executed in a dedicated Web Worker** with a clean global scope — only the game API injected, no DOM/network/importScripts. This provides variables, loops, conditionals, functions, and arrays with zero parser work.

- `wait(seconds)` and all instrument calls are **async under the hood**; scripts are run through a light transform (or written with `await`) so `wait` suspends the script while sim time advances. Exact mechanism is an implementation detail; the contract is: script-visible time only moves during `wait()`.
- Runaway protection: stop button always works (worker termination); per-tick CPU budget.
- Script errors surface in the console with line numbers; a runtime error stops the script but not the simulation.

### 8.2 API surface

```ts
// time
time.now(): number                      // sim time, Unix seconds on the UTC-based sim clock
wait(seconds): Promise<void>

// logging
log(...values)                          // to console
log.measurements(): Measurement[]       // read the measurement log

// radio
radio.lockEarth(): { rangeMeters, direction: Vec3, quality, tSent, tReceived }

// sensors
sensors.sunDirection(): Vec3
sensors.starAttitude(): Attitude
telescope.angularSeparation(bodyA, bodyB): number   // radians; bodies must be identified & visible

// ephemeris
ephemeris.position(bodyId, t): Vec3      // "sun"|"earth"|"moon"|"mars"|"venus"|"jupiter"
ephemeris.velocity(bodyId, t): Vec3

// vector math
vec(x,y,z), add, sub, mul, dot, cross, norm, normalize, angleBetween

// ship
ship.point(direction: Vec3): Promise<void>          // inertial frame; instant in MVP0
ship.burn(throttle, durationSeconds): Promise<void> // resolves when burn ends
ship.scheduleBurn(startTime, direction, throttle, duration): BurnHandle
ship.cancelBurn(handle)
ship.status(): { forward, deltaVSpent, burning, scheduledBurns, massKg: 12000, maxAcceleration, maxThrustNewtons }

// prediction
predict(state: {position, velocity, epoch}, burns: Burn[], duration, stepOut): Sample[]

// constants
C, MU_SUN, MU_EARTH, MU_MOON, R_EARTH, R_MOON, R_SOI_EARTH, AU, SHIP_MASS_KG
```

### 8.3 Forbidden API (never exposed to player scripts)

```ts
ship.truePosition() / trueVelocity() / currentOrbit()
ship.distanceTo(body)
solveTransfer(...) / autopilot(...) / any route or burn solver
debug.*
```

These exist only behind the debug flag.

---

## 9. Scenarios

**Resolved: curated deterministic seeds**, not random generation (bryum's random start deferred).

MVP0 ships **2 seeds**:

```
Seed 1 — "Close call" (easy)
  Heliocentric orbit near 1 AU, modest phase offset from Earth,
  velocity within ~1–2 km/s of Earth's. Reachable with 1–2 burns
  after a couple of position fixes.

Seed 2 — "Long way home" (medium)
  0.8–1.3 AU orbit, larger phase offset, some inclination.
  Requires multiple fix/predict/correct cycles and a capture burn.
```

Seed data per bvt §14.2 (`id, title, epoch, position, velocity, difficulty, playerDescription`). Player description never reveals state. Each seed is validated winnable by a developer reference solution kept in `scripts/validateScenarios.ts` (runs the seed through the real engine with a scripted solution and asserts capture).

Start state constraints (bvt §3): heliocentric, not inside any body's SOI, not trivially at Earth.

---

## 10. Debug Mode

Dev-only (build flag / query param, visibly watermarked "DEBUG"): true state readout, solar-system map with trajectory trace, Earth-relative energy, gravity/thrust vectors, teleport, integrator diagnostics. Strictly absent from normal builds' UI. Strongly recommended to build **early** — it is the test harness for everything else.

---

## 11. Explicitly Out of Scope for MVP0

Aggregated from both proposals, plus decisions above:

- landing, atmospheric entry modeling, docking, stations
- fuel mass loss / rocket equation, finite rotation rate & attitude dynamics
- measurement noise, clock drift, receiver uncertainty (all measurements exact)
- Doppler / range-rate measurement (estimate via repeated ranging instead)
- range-only radio hard mode (Level 2/3) — design for it, don't build it
- Mars/Venus/Jupiter gravity; other bodies; asteroids
- random scenario generation
- generic root-finder in calc workspace; Lambert solver (even hidden)
- map view, navball, trajectory graphs/plots (tables only)
- manual star identification (click always identifies)
- custom scripting language (real JS sandbox instead)
- animations from to_do.md (hibernation, crash, wormhole cutscenes)
- save/load of mid-run sim state (scripts/notes/candidates persist; sim restarts from seed)
- multiplayer, audio, mobile, VR, backend

---

## 12. Acceptance Criteria

MVP0 is done when:

1. `npm run dev` serves the game; `npm run build` produces a static bundle.
2. Simulation: SI units, heliocentric ecliptic J2000 frame, Sun+Earth+Moon point-mass gravity, tiered fixed-step RK4, deterministic (same seed + same inputs → bit-identical trajectory).
3. Ephemeris JSON (Horizons-derived, 2-year span, Hermite interpolation) drives all six bodies; star catalog renders ~5k real stars.
4. Ship starts at either curated seed with true state hidden; no normal screen/module, log, or script API leaks position/velocity.
5. Outside view + telescope: light-time-corrected apparent directions/sizes/brightness for solar-system bodies, click-to-identify, angular separation measurement, auto-logging.
6. Radio Level-1 lock returns exact light-time range + direction (Earth at transmit time), auto-logged.
7. Three-screen UI is implemented: Telescope, Sequence & Calculation, and Data. Ephemeris data, measurement log (export), calc workspace (vector calc, unlimited candidates, candidate-search tables, text notes import/export), radio/Earth beacon data, ship data (hardcoded 12,000 kg mass, max thrust/acceleration, engine state), and time controls are functional in their assigned screens.
8. Trajectory predictor (Sequence & Calculation module + `predict()`) propagates player-entered states with burns through the same engine; outputs tables. Data screen summarizes inserted-state closest approach and orbital elements without using truth, including center-distance periapsis/apoapsis and the correct solar/Earth reference plane for inclination.
9. Script console runs sandboxed JS with the full §8.2 API; stop always works; `wait()` advances sim time; scripts persist. Radio scripting exposes `radio.lockEarth()` only for new radio measurements.
10. Point-then-burn works live and scheduled; burns execute correctly through warp and skip; Δv accounting on the ship data module.
11. Time warp (pause–10,000×, substepped) and skip-to-time work; auto-interrupt on burns/SOI/win/lose. All displayed/user-entered/exported dates and times are UTC.
12. Earth capture triggers result overlay; <120 km altitude (and Moon/Sun collision) triggers failure; retry preserves scripts/notes/candidates.
13. Both seeds pass automated winnability validation.
14. Debug mode shows truth and map, absent from normal UI.
15. README documents assumptions, physics model, scripting API, and limitations.

---

## 13. Suggested Build Order

1. **Core math + physics**: vectors, constants, RK4, gravity, clock, ephemeris loader + interpolation. Headless, unit-tested (e.g. propagate Earth-orbit test cases, energy conservation checks).
2. **Data generation**: Horizons ephemeris script, star catalog script.
3. **Debug map + true-state view** (test harness for everything after).
4. **Ship model**: point/burn/scheduleBurn, warp/skip, win/lose detection.
5. **Script sandbox**: worker, API bridge, wait semantics, sequence console UI.
6. **Data screen modules**: radio/Earth beacon data → ephemeris data → measurement log → ship data → time controls → inserted-state analysis.
7. **Rendering**: outside view, starfield, bodies, telescope zoom/identify/separation.
8. **Sequence & Calculation screen**: calculation workspace + trajectory predictor.
9. **Scenario seeds + validation script; modern UI polish; success/failure overlays; README.**

Steps 1–5 constitute a playable-by-script game (debug map as eyes); 6–8 make it playable as designed.

---

## 14. Deliberately Deferred Decisions

- Exact modern visual design: layout density, typography, color, and interaction polish.
- Script `wait()` implementation detail (transform vs. async-await convention).
- Whether MVP1 adds range-only radio mode, measurement noise, finite rotation, Doppler, or Mars gravity first — revisit after MVP0 playtesting.
