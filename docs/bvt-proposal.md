# Programmable Solar-System Navigation Simulator

## Working Title

**DeepNav Classic**

Alternative names:

* EmergencyNav XP
* AstroShell Recovery
* Deep Space Return
* Home Vector
* NAV-OS 2003

---

# 1. Core Concept

The player wakes up in a spacecraft somewhere in the Solar System.

The ship has returned from a distant galaxy through an experimental wormhole or higher-dimensional transition. The jump succeeded only partially. The ship emerged somewhere in the Solar System, but the main navigation computer was destroyed.

The spacecraft has no useful record of its current position, velocity, or previous trajectory. Since the ship did not arrive through ordinary flight, dead reckoning is useless.

The only working computer is an old emergency backup system. It boots into a retro early-2000s-style operating system and exposes the ship’s instruments and engines through a primitive scripting interface.

The player has access to:

* exact onboard time from an atomic clock synchronized with Earth;
* all human scientific and astronomical knowledge;
* a real star catalog;
* planetary ephemeris data based on real Solar System positions;
* Earth’s radio beacon;
* basic ship instruments;
* a fictional high-thrust engine with limited acceleration;
* a programmable navigation interface.

The player does **not** initially know:

* current position;
* current velocity;
* current heliocentric orbit;
* current location on any map;
* the correct burn plan to return to Earth.

The objective is to reconstruct enough of the ship’s state to return home.

The MVP win condition is to enter a temporary captured Earth orbit. Landing or atmospheric descent is not implemented in MVP; entering the atmosphere destroys the ship.

---

# 2. Genre and Experience

This is not primarily a manual flight game.

It is a **programmable spacecraft-navigation simulation**.

The core fantasy is:

> “I have real instruments, real astronomical knowledge, a broken main computer, and a primitive backup system. Can I write enough navigation code to get home?”

The game should feel like a mix of:

* Kerbal Space Program, but without ship building;
* a celestial navigation puzzle;
* a programming game;
* a realistic orbital mechanics simulator;
* a retro computer interface.

The main challenge is not fuel conservation. The main challenge is:

* observation;
* inference;
* coordinate systems;
* vector math;
* orbital mechanics;
* scripting;
* course correction;
* Earth capture.

---

# 3. MVP Summary

## MVP Definition

A browser-based, true-scale, no-map, programmable spacecraft-navigation simulator where the player wakes in a curated unknown heliocentric orbit and must use stars, Earth radio ranging, ephemerides, vector math, and a forward-only fictional engine to enter temporary Earth orbit.

## MVP Start

The MVP starts from curated unknown heliocentric scenarios.

The player starts:

* somewhere on a heliocentric orbit;
* not in Earth orbit;
* not in Mars orbit;
* not near a known body by default;
* with no displayed position or velocity;
* with no player map.

The scenario is unknown to the player, but known internally to the simulation.

## MVP End

The player succeeds when the spacecraft becomes permanently captured by Earth and enters earth orbit

A valid MVP success state is:

* spacecraft is inside Earth’s sphere of influence;
* spacecraft has negative specific orbital energy relative to Earth;
* spacecraft is not currently inside Earth’s atmosphere.

A highly elliptical captured orbit is acceptable.

The player does **not** need to circularize orbit, land, dock, or descend to Earth.

---

# 4. Platform and Tech Stack

Use:

* Babylon.js
* TypeScript
* Vite
* HTML/CSS UI overlay
* localStorage where useful
* local JSON ephemeris data
* no mandatory backend for MVP
* no live network dependency during gameplay
* no audio required for MVP

The project must run with:

```bash
npm install
npm run dev
```

And build with:

```bash
npm run build
```

---

# 5. Narrative Premise

The spacecraft was returning to Earth from a distant galaxy using an experimental wormhole drive.

During the transition, the ship’s main computer failed. The ship emerged somewhere in the Solar System, but the navigation state was lost.

The spacecraft has no previous trajectory record, because the ship did not travel into the current position through normal space.

The only working system is an emergency backup computer. It is outdated but reliable. It boots into a retro early-2000s-style interface and provides low-level access to the ship’s instruments and engine.

The backup computer does not contain an autopilot capable of solving the return trajectory.

The player must use the ship’s instruments and write navigation programs to return to Earth.

Important style note:

Do **not** use real Windows XP logos, sounds, wallpaper, Microsoft names, or copyrighted visual assets. The interface should be fictional, but inspired by early-2000s operating systems.

---

# 6. Core Design Principles

## 6.1 True Scale Only

The simulation must use true physical scale.

No fake compressed distances in the main simulation.

No physically enlarged planets in the main scene.

Allowed visibility aids:

* labels;
* reticles;
* screen-space markers;
* telescope/instrument panels;
* numerical readouts;
* star identification overlays;
* radio signal panels;
* debug-only maps.

Not allowed in normal gameplay:

* enlarged planet meshes;
* compressed Solar System distances;
* magic minimap showing the spacecraft;
* automatic full trajectory display;
* fake target markers that reveal Earth before identification.

## 6.2 No Player Map

The normal player interface must not include an omniscient map.

The player should not see:

* spacecraft position on a Solar System map;
* current orbit;
* true trajectory line;
* exact distance to every planet;
* exact velocity vector in global coordinates before deriving it.

A developer/debug map is allowed and strongly recommended, but it must be separate from normal gameplay.

## 6.3 Instrument-Limited Knowledge

The game engine knows the true state.

The player and player program do not.

The scripting API must not expose:

```ts
getTruePosition()
getTrueVelocity()
getTrueOrbit()
getDistanceToAnyBody()
solveTransferToEarth()
autoNavigateHome()
```

The scripting API may expose instrument readings:

```ts
time.now()
radio.lockEarth()
radio.earthRange()
sensors.sunDirection()
sensors.starAttitude()
ephemeris.bodyState("earth", time)
ship.burn(...)
ship.point(...)
wait(...)
```

## 6.4 Low-Level Primitives, No Easy Solver

The player should get enough primitives to solve the problem, but not a one-button transfer planner.

Do not provide in MVP:

```ts
solveTransfer("earth")
goToEarth()
calculatePerfectBurn()
autoCaptureEarthOrbit()
```

The goal is to make the problem hard but solvable.

---

# 7. Physics Model

## 7.1 Units

Use SI units internally.

* distance: meters
* time: seconds
* mass: kilograms
* velocity: meters per second
* acceleration: meters per second squared
* force: newtons
* angles: radians internally

Rendering may use a scale factor, but the simulation state must remain physically meaningful.

Example:

```ts
const METERS_PER_RENDER_UNIT = 1_000_000;
```

Physics calculations must happen in real units. Convert only for rendering.

## 7.2 Coordinate Frame

Use one consistent inertial frame for simulation.

Preferred MVP frame:

* heliocentric or solar-system-barycentric;
* ecliptic-aligned;
* all ephemeris data converted into the same frame;
* all body and spacecraft states stored in that frame.

The player may only access inertial coordinates after using star-attitude alignment or equivalent instrumentation.

## 7.3 Planetary Motion

Use precomputed ephemeris data for real Solar System body positions.

Recommended data source:

* JPL Horizons, used offline during data generation.

Do not depend on live JPL Horizons API calls during gameplay.

Recommended flow:

```txt
JPL Horizons
→ offline generation script
→ local JSON ephemeris files
→ in-game interpolation
```

## 7.4 Spacecraft Dynamics

The spacecraft is propagated by the game engine.

JPL Horizons provides planetary states. It does not simulate the player spacecraft.

The spacecraft should be treated as a massless test particle affected by gravity and thrust.

Use a restricted N-body model for MVP:

```txt
spacecraft acceleration =
  gravity from Sun
+ gravity from Earth
+ gravity from Moon
+ engine acceleration
```

Optional visual bodies may not affect gravity in MVP.

## 7.5 Gravity

For each gravitational body:

```txt
a = μ * (r_body - r_ship) / |r_body - r_ship|^3
```

Where:

* `μ` is the gravitational parameter of the body;
* `r_body` is the body position;
* `r_ship` is the spacecraft position.

MVP gravitational bodies:

* Sun
* Earth
* Moon

Optional later gravitational bodies:

* Mars
* Venus
* Jupiter

## 7.6 Integrator

MVP recommendation:

* fixed-step RK4 integrator;
* deterministic simulation;
* smaller timestep near Earth/Moon;
* larger timestep during distant coasting if needed;
* never use one huge timestep for high time acceleration.

Time acceleration must run physics substeps rather than skipping dynamics.

## 7.7 Rendering Precision

Do not send raw astronomical coordinates directly into Babylon meshes.

Use spacecraft-centered rendering:

```ts
renderPosition = (bodyPhysicsPosition - spacecraftPhysicsPosition) / METERS_PER_RENDER_UNIT;
```

Physics state remains absolute and double-precision.

Rendering state is relative to the spacecraft/camera.

This avoids Babylon/WebGL precision problems at Solar System distances.

---

# 8. Spacecraft Model

## 8.1 Engine

The spacecraft has a fictional high-thrust engine.

MVP engine rules:

* unlimited fuel or energy;
* fixed maximum acceleration;
* no mass change;
* no chemical rocket equation in MVP;
* no instant velocity changes;
* forward-only main thrust;
* finite burn duration;
* ship must rotate before burning in a new direction.

Suggested acceleration by difficulty:

```txt
easy:   0.10 m/s²
medium: 0.03 m/s²
hard:   0.01 m/s²
```

## 8.2 Thrust Direction

Main engine thrust is forward-only.

The ship must point its nose before thrusting.

Allowed:

```ts
ship.point(direction)
ship.burn(throttle, durationSeconds)
```

Not allowed:

```ts
ship.burnArbitraryVector(direction, throttle, duration)
```

gyroscopes may rotate the ship, but should not provide major translational thrust in MVP.

## 8.3 Orientation

The spacecraft should have:

* orientation quaternion;
* angular velocity;
* maximum rotation rate;
* attitude stabilization;
* ability to point toward a specified vector;
* ability to stop rotation.

The player can command orientation, but not teleport orientation instantly unless explicitly allowed in tutorial/debug mode.

---

# 9. Earth Radio System

Earth transmits a timestamped radio beacon.

The ship has an atomic clock synchronized with Earth, so it can measure signal delay.

## 9.1 Distance Measurement

If Earth sends timestamp `t_sent`, and ship receives it at `t_received`:

```txt
signal_delay = t_received - t_sent
range = c × signal_delay
```

This gives distance to Earth.


The signal gives distance only.

No direct Earth direction is given.

The player must use repeated range measurements, Sun direction, stars, and ephemeris data.

## 9.3 Doppler

Doppler/range-rate measurement is postponed to v2.

In MVP, the player can estimate radial range rate using repeated range measurements:

```ts
let r1 = radio.earthRange();
wait(600);
let r2 = radio.earthRange();

let rangeRate = (r2 - r1) / 600;
```

---

# 10. Stars and Celestial Navigation

## 10.1 Real Stars

Use a real star catalog.

For MVP, use a filtered bright-star catalog rather than a huge full catalog.

Recommended:

* a few thousand visible stars;
* right ascension;
* declination;
* apparent magnitude;
* optional color index.

Proper motion can be ignored in MVP or precomputed to the epoch.

Do not use a full Gaia-scale dataset in the browser for MVP.

## 10.2 Star Attitude

The player can use the star field to establish ship orientation.

Possible primitive:

```ts
let attitude = sensors.starAttitude();
```

This should allow conversion between ship-local directions and an inertial celestial frame.

## 10.3 Sun Direction

The Sun should be visible according to true geometry.

The player may query:

```ts
let sunDir = sensors.sunDirection();
```

This returns Sun direction in ship-local or known inertial frame depending on instrument state.

The Sun should not automatically reveal the spacecraft position.

---

# 11. Ephemeris Database

The ship has an onboard ephemeris database because humanity has astronomical knowledge and exact time.

This is allowed and fair.

The player may query known body positions at known times:

```ts
let earth = ephemeris.bodyState("earth", time.now());
let moon = ephemeris.bodyState("moon", time.now());
let mars = ephemeris.bodyState("mars", time.now());
```

But the player may not query the spacecraft’s true state.

## 11.1 MVP Bodies

* Sun
* Earth
* Moon
* Mars

# 12. Scripting System

## 12.1 Language Style

Use function-style scripting.

The language should look familiar to users who know basic JavaScript or Python-like pseudocode, but it does not need to be full JavaScript.

Example:

```ts
let signal = radio.lockEarth();
log(signal.rangeMeters);

ship.point(signal.direction);
ship.burn(0.4, 120);

wait(3600);

let r1 = radio.earthRange();
wait(600);
let r2 = radio.earthRange();

let rangeRate = (r2 - r1) / 600;
log(rangeRate);
```

## 12.2 MVP Language Features

MVP scripts should support:

* variables;
* numbers;
* booleans;
* vectors;
* function calls;
* `if / else`;
* loops;
* basic arithmetic;
* vector math;
* logging;
* waiting;
* instrument reads;
* ship commands.

Required control structures:

```ts
if condition {
  ...
} else {
  ...
}

while condition {
  ...
}
```

or equivalent syntax.

## 12.3 Required Script Primitives

### Time

```ts
time.now()
wait(seconds)
```

### Logging

```ts
log(value)
logVector(vector)
```

### Radio

```ts
radio.lockEarth()
radio.earthRange()
radio.earthDirection() // available depending on difficulty
radio.signalQuality()
```

### Sensors

```ts
sensors.sunDirection()
sensors.starAttitude()
sensors.shipOrientation()
```

### Ephemeris

```ts
ephemeris.bodyState(bodyId, time)
ephemeris.position(bodyId, time)
ephemeris.velocity(bodyId, time)
```

### Vector Math

```ts
vec(x, y, z)
add(a, b)
sub(a, b)
mul(v, scalar)
dot(a, b)
cross(a, b)
norm(v)
normalize(v)
angleBetween(a, b)
```

### Ship Control

```ts
ship.point(direction)
ship.stopRotation()
ship.burn(throttle, durationSeconds)
ship.status()
```

## 12.4 Forbidden Player API

Do not expose:

```ts
ship.truePosition()
ship.trueVelocity()
ship.currentOrbit()
ship.distanceTo("earth")
ship.solveTransfer("earth")
ship.autopilot("earth")
debug.map()
```

These may exist internally or in developer mode, but not in normal player scripts.

---

# 13. User Interface


## 13.2 MVP Screens

Required MVP screens:

* boot screen;
* desktop/recovery shell;
* script editor;
* program console/log;
* radio signal panel;
* sensor panel;
* ephemeris query panel;
* ship status panel;
* help/manual screen;
* failure/success screen.
* telescope/star view;


Optional MVP screens:

* scenario selector;
* debug map;
* debug inspector.

## 13.3 No Normal Map

Normal player UI must not include a map showing the ship’s true position.

A debug-only map is allowed.

## 13.4 Console Output

The console should show:

* script logs;
* errors;
* current command;
* instrument readings;
* warnings;
* burn start/end events;
* radio lock events;
* capture/failure messages.

---

# 14. Scenarios

## 14.1 Curated Seeds

MVP should use curated scenario seeds, not fully random generation.

Recommended MVP scenario count:

* 3 curated seeds.

Example categories:

```txt
Seed 1 — Easy
- relatively near Earth orbit
- forgiving velocity
- Earth return possible with simple correction

Seed 2 — Medium
- farther from Earth
- needs multiple measurements and correction burns

Seed 3 — Hard
- awkward geometry
- requires better timing and capture planning
```

Each seed should be deterministic.

## 14.2 Scenario Data

```ts
type ScenarioSeed = {
  id: string;
  title: string;
  epochUnixSeconds: number;
  spacecraftPositionMeters: Vector3;
  spacecraftVelocityMetersPerSecond: Vector3;
  spacecraftOrientation: Quaternion;
  difficulty: "easy" | "medium" | "hard";
  descriptionForPlayer: string;
  notesForDeveloper?: string;
};
```

Player-facing description should not reveal true position or velocity.

---

# 15. Success and Failure

## 15.1 Success

Success occurs when the ship is captured by Earth.

Approximate MVP success test:

```txt
inside Earth SOI
AND specific orbital energy relative to Earth < 0
AND altitude > atmosphere limit
```

Specific orbital energy relative to Earth:

```txt
energy = v_rel² / 2 - μ_earth / r_rel
```

If:

```txt
energy < 0
```

the spacecraft is bound to Earth.

MVP does not require circular orbit.

## 15.2 Atmosphere Failure

If altitude above Earth falls below the atmospheric destruction threshold, the ship burns up.

Recommended threshold:

```txt
altitude < 120 km
```

## 15.3 Other Failure States

Possible failure states:

* collision with Earth;
* atmospheric burn-up;
* collision with Moon;
* collision with Sun;
* script runtime error during critical maneuver;
* lost far from Earth with no practical return, if scenario rules allow this later.

## 15.4 Retry Loop

After failure:

* show failure reason;
* allow restart from same seed;
* allow restart from another seed;
* preserve script text so the player can edit and retry.

Preserving the script is important.

---

# 16. Debug Mode

Developer debug tools are strongly recommended.

Debug mode may show information forbidden in normal gameplay.

Debug tools:

* true spacecraft position;
* true spacecraft velocity;
* true heliocentric orbit estimate;
* true Earth-relative energy;
* solar-system debug map;
* body positions;
* trajectory trace;
* gravity acceleration vector;
* thrust vector;
* teleport to scenario;
* force Earth approach;
* reset to seed;
* time controls;
* integrator diagnostics.

Debug mode should be clearly separated from normal gameplay.

---

# 17. Project Structure

Recommended structure:

```txt
src/
  main.ts

  game/
    Game.ts
    SimulationClock.ts
    ScaleManager.ts
    SceneManager.ts
    RenderManager.ts

  physics/
    DynamicsEngine.ts
    RestrictedNBodyEngine.ts
    IntegratorRK4.ts
    GravitySystem.ts
    OrbitAnalysis.ts
    EarthCaptureCheck.ts

  spacecraft/
    Spacecraft.ts
    SpacecraftController.ts
    AttitudeController.ts
    EngineModel.ts

  ephemeris/
    EphemerisProvider.ts
    InterpolatedJsonEphemerisProvider.ts
    EphemerisTypes.ts
    data/
      ephemeris-inner-solar-system.json

  stars/
    StarCatalog.ts
    StarRenderer.ts
    StarAttitudeSystem.ts
    data/
      bright-stars.json

  instruments/
    RadioSystem.ts
    SunSensor.ts
    StarSensor.ts
    SensorTypes.ts

  scripting/
    ScriptParser.ts
    ScriptInterpreter.ts
    ScriptRuntime.ts
    ScriptStdLib.ts
    ScriptErrors.ts
    DemoPrograms.ts

  scenarios/
    ScenarioSeed.ts
    ScenarioManager.ts
    seeds.ts

  ui/
    UIManager.ts
    DesktopShell.ts
    ScriptEditor.ts
    ProgramConsole.ts
    RadioPanel.ts
    SensorPanel.ts
    ShipStatusPanel.ts
    HelpManual.ts
    SuccessFailurePanel.ts
    styles.css

  debug/
    DebugPanel.ts
    DebugMap.ts
    VectorOverlay.ts

  math/
    vector.ts
    quaternion.ts
    units.ts
    orbital.ts
    constants.ts

scripts/
  generateEphemeris.ts
  generateStarCatalog.ts
  validateScenarios.ts
```

---

# 18. Data Generation

## 18.1 Ephemeris Data

Use a build-time/offline script to generate local ephemeris JSON.

Input source:

* JPL Horizons or another authoritative ephemeris source.

Output:

```ts
type EphemerisSample = {
  timeUnixSeconds: number;
  positionMeters: Vector3;
  velocityMetersPerSecond: Vector3;
};

type BodyEphemeris = {
  bodyId: string;
  samples: EphemerisSample[];
};

type EphemerisDataFile = {
  source: string;
  generatedAt: string;
  frame: string;
  center: string;
  timeScale: string;
  startUnixSeconds: number;
  endUnixSeconds: number;
  stepSeconds: number;
  bodies: BodyEphemeris[];
};
```

## 18.2 Interpolation

Use interpolation between ephemeris samples.

Minimum acceptable:

* linear interpolation for early prototype.

Preferred:

* cubic Hermite interpolation using position and velocity.

Moon data should use smaller timestep than planets if needed.

## 18.3 Star Catalog

Generate a reduced browser-friendly star dataset.

Include:

```ts
type Star = {
  id: string;
  raRad: number;
  decRad: number;
  magnitude: number;
  colorIndex?: number;
  name?: string;
};
```

---

# 19. Time Controls

The game needs time acceleration, but it must not break physics.

Required controls:

* pause;
* 1x;
* 10x;
* 100x;
* 1,000x;
* 10,000x.

Rules:

* physics must run in substeps;
* high time acceleration must not use one huge timestep;
* scripted burns during high acceleration need careful handling;
* active control may be limited at high time warp.

Recommended:

```txt
1x–100x:
- active control allowed

1,000x+:
- coast preferred
- scripted long burns allowed only if integrator handles them safely
```

---

# 20. MVP Acceptance Criteria

The MVP is complete when:

* project runs with Vite;
* simulation uses SI units internally;
* rendering uses spacecraft-centered floating origin;
* real star field is visible;
* Sun, Earth, Moon are simulated as gravitational bodies;
* Mars, Venus, Jupiter may appear as visual/ephemeris references;
* planetary positions come from local ephemeris JSON;
* spacecraft starts in curated unknown heliocentric scenario;
* player is not shown true position or velocity;
* no normal player map exists;
* Earth radio system provides Level 1 lock: range + direction + signal quality;
* Doppler is not required;
* scripting language supports variables, conditionals, loops, vector math, logging, waits, sensor reads, and ship commands;
* ship has forward-only high-thrust engine with limited acceleration;
* spacecraft moves under gravity and thrust;
* player can perform course corrections through scripts;
* Earth capture condition works;
* atmospheric destruction works;
* failure allows retry while preserving script;
* debug mode exists for development;
* README explains assumptions, controls, scripting API, physics model, limitations, and future improvements.

---

# 21. Explicitly Out of Scope for MVP

Do not implement before MVP is stable:

* landing;
* atmospheric entry simulation;
* docking;
* space stations;
* full chemical fuel model;
* rocket equation;
* ship building;
* multiplayer;
* combat;
* mobile controls;
* VR/WebXR;
* full Solar System gravity;
* full n-body planetary simulation;
* live JPL API dependency during gameplay;
* SPICE kernel runtime integration;
* real Doppler radio measurement;
* automatic transfer solver;
* player-visible omniscient map;
* high-resolution NASA texture pack;
* real Windows XP assets.

---

# 22. Future Improvements

Possible v2/v3 features:

* Doppler/range-rate radio measurement;
* harder Earth signal modes;
* randomized start generation;
* scenario difficulty generator;
* Mars/Venus/Jupiter gravity;
* more planets;
* optical planet identification;
* telescope observations;
* apparent magnitude simulation;
* realistic signal strength model;
* onboard help/tutorial missions;
* SPICE-based ephemeris generation;
* WebAssembly physics module;
* optional Lambert solver as hidden validation tool;
* mobile/tablet interface;
* richer retro OS UI;
* story events and computer failure messages;
* more realistic engine modes;
* finite energy or reactor heat limits;
* save/load of long navigation attempts.

---

# 23. Key Design Summary

The central design rule:

> The simulation may know the truth, but the player must earn knowledge through instruments and computation.

The game should not give the player a map, an autopilot, or a magic transfer planner.

The player has:

* time;
* stars;
* Sun;
* Earth signal;
* ephemeris;
* math;
* engine;
* code.

That is enough.

The game is won by using those tools correctly.
