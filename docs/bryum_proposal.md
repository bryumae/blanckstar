# Space Navigation Simulator — MVP Game Design Specification

## 1. Core Concept

The player is aboard a spacecraft in deep space. The main gameplay is manual navigation through a true-scale Solar System model.

The player does not receive a direct position or velocity readout. The player must determine the ship’s state using measurements, calculations, and trajectory prediction.

Core loop:

```text
Observe → Measure → Calculate → Estimate state → Plan burn → Execute burn → Re-measure → Correct
```

The MVP has one mode.

There are no victory conditions, failure conditions, score screens, or end conditions in the MVP.

---

## 2. Platform and Technical Stack

The MVP is a browser game.

Implementation stack:

```text
TypeScript
Three.js
HTML/CSS instrument UI
Web Worker for simulation and trajectory prediction
Custom astrodynamics/navigation code
Precomputed ephemeris data
```

Three.js handles rendering only:

```text
- outside view
- telescope view
- star field
- apparent celestial body positions
- brightness and apparent size rendering
- simple instrument graphics
```

The following systems are custom-built:

```text
- orbital mechanics
- ship motion
- gravity model
- Earth signal model
- telescope measurement model
- trajectory prediction
- burn execution
- navigation calculations
```

No external game physics engine is used for orbital mechanics.

---

## 3. Physical Model

## 3.1 True-Scale Solar System

The Solar System model uses true distances and physically meaningful units.

Simulation units:

```text
distance: kilometres
time: seconds
mass: kilograms
thrust: newtons
acceleration: m/s² in UI; converted internally as needed
velocity: km/s
```

The displayed apparent positions of celestial bodies as seen from the spacecraft must be correct according to the game’s physical model.

For every rendered body:

```text
relative_vector = body_position - ship_position
distance = |relative_vector|
direction = relative_vector / distance
apparent_angular_radius = atan(body_radius / distance)
```

The outside view is an angular view from the spacecraft, not a decorative background.

---

## 3.2 Celestial Bodies

The MVP includes exactly four celestial bodies:

```text
- Sun
- Earth
- Moon
- Mars
```

Mars is fully included in the MVP.

Only these four bodies exist in the MVP simulation.

Only these four bodies have gravitational effects.

No Jupiter, Venus, asteroids, or other planets are included in the MVP.

---

## 3.3 Gravity

The ship is affected only by gravity from the Sun, Earth, Moon, and Mars.

For each body:

```text
a_body = μ_body × (R_body - S) / |R_body - S|³
```

Total gravitational acceleration:

```text
a_gravity = a_Sun + a_Earth + a_Moon + a_Mars
```

The ship’s velocity changes continuously during coasting because of gravity.

There is no hidden drift, no random force, and no uncommanded acceleration.

The ship state changes only because of:

```text
- gravity from the selected celestial bodies
- player-commanded burns
```

---

## 3.4 Coordinates

The player-facing coordinates are raw 3D Cartesian coordinates.

Coordinate frame:

```text
origin: Sun
Sun position: (0, 0, 0)
frame: heliocentric ecliptic J2000-style frame
x/y plane: ecliptic plane
z axis: perpendicular to ecliptic plane
units: kilometres
```

Displayed coordinate example:

```text
x = +84,230,000 km
y = -121,550,000 km
z = +3,410,000 km
```

The Sun is always displayed at:

```text
Sun = (0, 0, 0)
```

Imported ephemeris data is converted into the player-facing heliocentric frame before display.

---

## 4. Initial Conditions

At the start of the MVP scenario:

```text
- the ship is in a random orbit around the Sun
- the initial position is unknown to the player
- the initial velocity is unknown to the player
- the player does not know where they are
```

The generated starting orbit must be physically valid inside the game model.

The starting state is hidden from the player.

---

## 5. Time System

The game has a normal clock.

The MVP does not include continuous time-speed controls.

There is no time-warp slider and no adjustable simulation speed.

The player may skip forward by selecting a future time interval. During the skip, the simulation propagates the ship state under gravity and any scheduled burns.

Example:

```text
skip {
  duration: 12 h
}
```

During skipped time:

```text
- celestial bodies continue moving
- the ship continues moving
- gravity affects the ship
- scheduled burns execute if their time occurs during the skip
```

The clock is exact.

There is no clock drift.

There is no random timekeeping error.

---

## 6. Engine and Burn Model

## 6.1 Engine Type

The ship has a slightly sci-fi fusion drive.

Resolved engine behaviour:

```text
- high-thrust finite burns
- much more available delta-v than chemical spacecraft
- mass loss ignored in MVP
- thrust does not occur instantly
- burns require start time, duration, throttle, yaw, pitch, and roll
```

Fuel mass loss is ignored in the MVP.

Ship mass is constant in the MVP.

Ship mass:

```text
ship_mass = 12,000 kg
```

---

## 6.2 Maximum Acceleration and Thrust

The MVP uses:

```text
max_acceleration = 2 m/s²
ship_mass = 12,000 kg
max_thrust = 24,000 N
```

Formula:

```text
max_thrust = ship_mass × max_acceleration
```

---

## 6.3 Burn Configuration Interface

Burns are specified through a textual configuration interface.

Example:

```text
burn {
  start_time: 2042-06-18 16:30:00
  duration: 48 s
  throttle: 0.75

  orientation {
    yaw: 130 deg
    pitch: -12 deg
    roll: 0 deg
  }
}
```

The burn configuration includes:

```text
- burn start time
- burn duration
- throttle
- yaw
- pitch
- roll
```

The game executes burns exactly as written.

There is no automatic correction of an incorrect burn plan.

---

## 6.4 Ship Attitude / Orientation

Ship attitude means the ship’s orientation in space.

It determines:

```text
- where the nose points
- where the engine points
- what direction thrust is applied
```

In the MVP, the player enters orientation using:

```text
yaw
pitch
roll
```

Internally, the game converts yaw/pitch/roll into an engine thrust direction vector.

---

## 6.5 Burn Acceleration

With mass loss ignored:

```text
a_engine = throttle × max_thrust / ship_mass
```

Since:

```text
max_thrust = 24,000 N
ship_mass = 12,000 kg
```

Then:

```text
a_engine = throttle × 2 m/s²
```

Delta-v approximation:

```text
Δv = a_engine × burn_duration
```

Example:

```text
throttle = 0.75
duration = 48 s

a_engine = 0.75 × 2 = 1.5 m/s²
Δv = 1.5 × 48 = 72 m/s
```

---

## 7. Visual and Instrument Model

## 7.1 No Cockpit Layout in MVP

The MVP does not include a detailed cockpit layout.

The MVP UI is an instrument interface.

It includes:

```text
- outside view / telescope view
- Earth signal panel
- ephemeris table
- measurement log
- calculation workspace
- trajectory predictor
- burn configuration editor
```

No decorative cockpit layout is implemented.

No navball is implemented.

---

## 7.2 No Map

The MVP does not include a map.

The trajectory predictor does not display a visual orbital map.

The trajectory predictor outputs tables only:

```text
- coordinate tables
- distance tables
- time tables
- relative velocity tables
```

No map view is implemented.

---

## 7.3 Outside View

The outside view shows the sky from the spacecraft’s current simulated position.

It includes:

```text
- stars
- Sun
- Earth
- Moon
- Mars
```

The apparent position of every celestial body must be correct according to the model.

Stars and planets vary in brightness.

Objects are not rendered as identical dots.

For each visible body, rendering accounts for:

```text
- direction from ship
- distance from ship
- apparent angular size
- brightness
```

Planets may appear as points when far away, but their brightness and apparent size are still model-based.

---

## 7.4 Stars

Stars are fixed on the sky in the MVP.

The ship’s movement within the Solar System does not visibly change the star field.

The star field uses a real star catalogue or a simplified catalogue derived from real star data.

The MVP star model includes:

```text
- star position on the sky
- star brightness/magnitude
- click-to-identify star name
```

The player does not manually identify stars.

When the player clicks a star, the interface displays the star’s name if known.

---

## 7.5 Celestial Body Identification

The game does not provide automatic search-to-target functionality.

The player cannot press a button to automatically find Earth, Moon, Mars, or the Sun.

When the player clicks on a visible celestial body, the game displays its name.

After clicking, the body can be labelled.

Earth, Moon, and Mars can be labelled after identification.

---

## 7.6 Telescope

The telescope is a measurement instrument.

The telescope provides:

```text
- zoom
- field of view
- reticle
- click-to-identify visible stars and celestial bodies
- angular separation measurement between visible bodies
```

The telescope does not provide absolute bearing.

The telescope does not provide azimuth/elevation.

The telescope does not provide inertial sky-grid coordinates.

The telescope does not automatically find celestial bodies.

The telescope can measure angular separation between visible bodies, including:

```text
Sun ↔ Earth
Earth ↔ Moon
Earth ↔ Mars
Moon ↔ Mars
Sun ↔ Mars
Sun ↔ Moon
```

---

## 8. Earth Signal

Earth sends an exact time signal.

The signal contains precise Earth transmission time.

The ship compares:

```text
Earth transmission time
ship reception time
```

The player calculates light-time delay:

```text
Δt = t_receive_ship - t_transmit_earth
```

Then:

```text
range_to_Earth = c × Δt
```

Where:

```text
c = 299,792.458 km/s
```

The Earth signal is exact.

There is no noise.

There is no clock error.

There is no receiver uncertainty.

The signal gives distance corresponding to the light path from Earth at transmission time to the ship at reception time.

The relevant Earth position for this measurement is Earth’s position at the signal transmission time.

---

## 9. Ephemeris Display

The ephemeris display provides raw coordinates of the MVP bodies at selected times.

It includes:

```text
- Sun coordinates
- Earth coordinates
- Moon coordinates
- Mars coordinates
```

Coordinates are shown as raw 3D Cartesian coordinates.

Example:

```text
EPHEMERIS

Time: 2042-06-18 14:03:20

Sun:
x = 0 km
y = 0 km
z = 0 km

Earth:
x = +84,230,000 km
y = +123,440,000 km
z = +0 km

Moon:
x = +84,005,000 km
y = +123,751,000 km
z = +12,000 km

Mars:
x = -192,800,000 km
y = +112,400,000 km
z = +4,900,000 km
```

The ephemeris does not show the ship’s hidden true position.

The ephemeris does not show the ship’s hidden true velocity.

---

## 10. Measurement Model

## 10.1 No Random Measurement Error

Measurements are exact in the MVP.

There is:

```text
- no random instrument noise
- no clock drift
- no telescope measurement error
- no random burn error
```

Wrong results come only from:

```text
- player calculation mistakes
- player misunderstanding
- insufficient observations
- wrong burn configuration
- wrong state estimate
```

---

## 10.2 Angular Separation

The telescope measures angular separation between two visible bodies.

Given two bodies A and B, as seen from the ship:

```text
u_A = (A - S) / |A - S|
u_B = (B - S) / |B - S|
```

Measured angular separation:

```text
θ_AB = arccos(u_A · u_B)
```

Where:

```text
u_A · u_B = u_Ax u_Bx + u_Ay u_By + u_Az u_Bz
```

The player receives:

```text
θ_AB
```

The player does not receive:

```text
u_A
u_B
absolute bearing to A
absolute bearing to B
```

---

## 10.3 Earth Range

The Earth signal provides Earth range through light-time.

The player calculates:

```text
d_Earth = c × Δt
```

This gives one scalar constraint on the ship’s position:

```text
|S - E| = d_Earth
```

Where:

```text
S = unknown ship position
E = Earth position at signal transmission time
```

Expanded:

```text
(S_x - E_x)² + (S_y - E_y)² + (S_z - E_z)² = d_Earth²
```

---

## 11. Manual Position Calculation

Because the telescope provides only angular separations, the direct position formula is not available.

The player cannot use:

```text
S = E - d × u
```

because the telescope does not provide the absolute direction vector `u`.

Instead, position must be found by solving constraints.

Unknown:

```text
S = (x, y, z)
```

Known:

```text
Earth position E(t)
Moon position M(t)
Mars position R(t)
Sun position O(t) = (0, 0, 0)
Earth range d_E
observed angular separations
```

Core range equation:

```text
|S - E| = d_E
```

Angular equations:

```text
cos θ_AB = ((A - S) · (B - S)) / (|A - S| |B - S|)
```

Example equations:

```text
cos θ_SE = ((Sun - S) · (Earth - S)) / (|Sun - S| |Earth - S|)

cos θ_EM = ((Earth - S) · (Moon - S)) / (|Earth - S| |Moon - S|)

cos θ_ER = ((Earth - S) · (Mars - S)) / (|Earth - S| |Mars - S|)
```

Minimum useful measurement set:

```text
- Earth range
- Earth-Sun angular separation
- Earth-Moon angular separation
- Earth-Mars angular separation
```

Additional angular separations:

```text
- Sun-Moon
- Sun-Mars
- Moon-Mars
```

The game does not verify whether the player’s calculated position is correct.

The player can enter any calculated position into the trajectory predictor.

---

## 12. Velocity Calculation

Initial velocity is unknown.

The player estimates velocity from multiple manually calculated positions.

A position calculated from one set of observations is called a position fix.

A second fix is another independently calculated position at a later time.

Given:

```text
S1 = first calculated position
S2 = second calculated position
t1 = time of first fix
t2 = time of second fix
```

Approximate velocity:

```text
v ≈ (S2 - S1) / (t2 - t1)
```

Component form:

```text
v_x ≈ (S2_x - S1_x) / Δt
v_y ≈ (S2_y - S1_y) / Δt
v_z ≈ (S2_z - S1_z) / Δt
```

Where:

```text
Δt = t2 - t1
```

Because gravity changes velocity during coast, this is an approximation.

More accurate velocity estimation requires propagating candidate states through the gravity model and matching later observations.

---

## 13. Calculation Workspace

The MVP includes a calculation workspace.

All intended navigation calculations must be possible inside the game.

The calculation workspace provides tools, not final answers.

It includes:

```text
- scalar calculator
- vector calculator
- trigonometric functions
- dot product
- vector magnitude
- arccos
- coordinate entry fields
- measurement log
- equation workspace
- table workspace
- candidate estimate manager
```

The player can save multiple candidate position/velocity estimates and compare their predicted consequences.

The calculation workspace may allow candidate-search tables.

Candidate-search table workflow:

```text
1. Player enters coordinate ranges.
2. Player enters step size.
3. Player chooses which measured constraints to compare.
4. Workspace evaluates candidate coordinates.
5. Workspace outputs a table of mismatch values.
```

Example output:

```text
Candidate S                  Earth range error    Angle error total
(+80M, -110M, +5M) km         320,000 km           4.2°
(+82M, -115M, +4M) km          41,000 km           0.8°
(+83M, -116M, +4.2M) km         3,000 km           0.05°
```

The workspace does not reveal the hidden true ship position.

The workspace does not label a candidate as correct or incorrect.

The workspace does not provide an automatic optimal trajectory solver.

It must not include:

```text
- automatic hidden-position solver
- automatic current-state solver
- automatic route-to-Earth solver
- automatic optimal burn solver
- hidden-truth correctness checker
```

---

## 14. Trajectory Prediction

The trajectory predictor simulates future motion using the state entered by the player.

Inputs:

```text
- selected player-entered position estimate
- selected player-entered velocity estimate
- burn configuration
- selected prediction duration
```

Outputs are tables only:

```text
- predicted future ship coordinates over time
- distance to Earth over time
- distance to Moon over time
- distance to Mars over time
- relative velocity to Earth over time
```

The predictor does not say whether the entered state is correct.

The predictor does not warn that the player’s calculations are inconsistent.

The predictor only simulates the consequences of the player-entered state.

There is no visual map.

There are no non-map graphs in the MVP.

---

## 15. Numerical Integration

The simulation advances the ship state through time under gravity and thrust.

Continuous equations:

```text
dS/dt = v
dv/dt = a_gravity + a_engine
```

The MVP uses:

```text
RK4
```

RK4 means fourth-order Runge–Kutta.

Purpose:

```text
Given current position and velocity,
estimate position and velocity after a small time step.
```

The same RK4 integrator is used for:

```text
- live simulation
- time skipping
- trajectory prediction
- scheduled burn propagation
```

---

## 16. Burn Execution

The player writes a burn configuration.

The game executes it exactly.

During a burn:

```text
a_total = a_gravity + a_engine
```

Engine acceleration direction comes from yaw/pitch/roll orientation.

If the ship orientation angles define a forward vector `f`:

```text
a_engine = f × throttle × max_thrust / ship_mass
```

With mass loss ignored:

```text
ship_mass = 12,000 kg
```

Approximate burn delta-v:

```text
Δv = throttle × max_thrust / ship_mass × burn_duration
```

Using MVP values:

```text
Δv = throttle × 2 m/s² × burn_duration
```

---

## 17. Required Calculations

### 17.1 Body Ephemeris Calculation

For each time t, the game needs:

```text
Sun position O(t) = (0, 0, 0)
Earth position E(t)
Moon position M(t)
Mars position R(t)
```

The MVP uses precomputed ephemeris tables.

The game interpolates between table entries:

```text
body_position = interpolate(ephemeris_table, t)
```

---

### 17.2 Ship Gravity Calculation

For each body:

```text
r_body = R_body - S
d_body = |r_body|
a_body = μ_body × r_body / d_body³
```

Total:

```text
a_gravity = a_Sun + a_Earth + a_Moon + a_Mars
```

---

### 17.3 Ship Motion Integration

At every simulation step:

```text
state = (S, v)

dS/dt = v
dv/dt = a_gravity + a_engine

state_next = RK4(state_current, derivative_function, Δt)
```

---

### 17.4 Time Skip Propagation

When the player skips time:

```text
target_time = current_time + skip_duration
```

The simulation repeatedly integrates the ship state until target time.

If a scheduled burn occurs inside the skipped interval, the integrator includes engine acceleration during the burn window.

---

### 17.5 Earth Signal Light-Time

Given:

```text
t_transmit
t_receive
c
```

Calculate:

```text
Δt = t_receive - t_transmit
d_E = c × Δt
```

This gives:

```text
|S_receive - E_transmit| = d_E
```

---

### 17.6 Apparent Direction of a Body

For rendering, for each body A:

```text
relative_vector = A - S
distance = |relative_vector|
direction = relative_vector / distance
```

This direction determines where the body appears in the outside view.

---

### 17.7 Apparent Angular Radius

For each spherical body:

```text
angular_radius = atan(body_radius / distance)
```

Angular diameter:

```text
angular_diameter = 2 × angular_radius
```

---

### 17.8 Apparent Brightness

Stars use catalogue magnitude.

Planets use a simplified brightness model based on distance and illumination.

MVP planet brightness calculation varies with:

```text
- distance from ship
- distance from Sun
- phase angle
```

Simplified structure:

```text
brightness ∝ reflected_light × phase_function / distance_to_ship²
```

The Sun brightness depends on distance from ship:

```text
brightness_Sun ∝ 1 / distance_to_Sun²
```

Exact photometric realism is not required for MVP, but bodies must not all appear with the same brightness.

---

### 17.9 Angular Separation

For two visible bodies A and B:

```text
u_A = (A - S) / |A - S|
u_B = (B - S) / |B - S|
θ_AB = arccos(u_A · u_B)
```

This is the telescope’s core measurement.

---

### 17.10 Position Constraint from Earth Range

Earth range gives:

```text
|S - E| = d_E
```

Expanded:

```text
(S_x - E_x)² + (S_y - E_y)² + (S_z - E_z)² = d_E²
```

---

### 17.11 Position Constraint from Angular Separation

For bodies A and B:

```text
cos θ_AB = ((A - S) · (B - S)) / (|A - S| |B - S|)
```

This equation is used by the player to solve for S.

---

### 17.12 Manual Position Solving

The player combines:

```text
Earth range equation
+ angular separation equations
```

The unknown is:

```text
S = (x, y, z)
```

The player may solve by:

```text
- algebraic manipulation
- numerical trial-and-error
- table search
- in-game scalar/vector calculator
- in-game equation workspace
- candidate-search tables
```

The game itself does not reveal the true ship position.

---

### 17.13 Velocity Estimate from Position Fixes

Given two position fixes:

```text
v ≈ (S2 - S1) / (t2 - t1)
```

Given more than two fixes, the player may fit velocity manually.

The MVP does not automatically fit velocity.

---

### 17.14 Burn Direction from Orientation

Player-entered yaw/pitch/roll are converted into a forward vector:

```text
f = orientation_to_forward_vector(yaw, pitch, roll)
```

Engine acceleration:

```text
a_engine = f × throttle × max_thrust / ship_mass
```

---

### 17.15 Delta-v Approximation

Because mass loss is ignored:

```text
Δv = throttle × max_thrust / ship_mass × burn_duration
```

For MVP values:

```text
Δv = throttle × 2 m/s² × burn_duration
```

---

### 17.16 Trajectory Prediction

Given player-entered state:

```text
S_entered
v_entered
```

And burn configuration:

```text
burn_start
burn_duration
throttle
yaw
pitch
roll
```

The predictor integrates forward:

```text
state(t + Δt) = RK4(state(t), Δt)
```

It records:

```text
S(t)
v(t)
distance_to_Earth(t)
distance_to_Moon(t)
distance_to_Mars(t)
```

---

### 17.17 Relative Velocity

For Earth:

```text
v_rel_Earth = v_ship - v_Earth
relative_speed_Earth = |v_rel_Earth|
```

Same calculation may be done for Moon and Mars.

---

## 18. Removed from MVP

The following are not part of the MVP:

```text
- detailed cockpit layout
- victory conditions
- failure conditions
- end condition
- automatic current-position solver
- automatic route planner
- automatic optimal burn solver
- automatic celestial body finder
- adjustable time speed
- random measurement errors
- clock drift
- fuel mass loss
- Jupiter
- Venus
- other planets
- asteroids
- manual star identification requirement
- map view
- navball
- trajectory graphs
```

---

## 19. Implementation Plan

## Phase 1 — Simulation Core

Build:

```text
- 3D vector math
- time system
- ephemeris table loader
- interpolation
- ship state representation
- Sun/Earth/Moon/Mars gravity model
- RK4 integrator
- time skip propagation
```

Output:

```text
- body coordinates
- hidden true ship coordinates
- hidden true ship velocity
- propagated ship state after skip
```

---

## Phase 2 — Measurement Core

Build:

```text
- Earth light-time signal
- angular separation calculator
- apparent body direction calculator
- apparent size calculator
- brightness model
```

Output:

```text
- exact Earth signal timestamps
- player-calculable Earth range
- telescope angular separation readings
- correct apparent sky positions
```

---

## Phase 3 — Visual Interface

Build:

```text
- outside view
- star field with brightness variation
- Sun/Earth/Moon/Mars rendering
- apparent position rendering
- telescope zoom
- click-to-identify stars and bodies
- labels after click
```

No automatic search-to-body function is implemented.

---

## Phase 4 — Instrument UI

Build:

```text
- Earth signal panel
- ephemeris panel with raw 3D coordinates
- measurement log
- calculation workspace
- burn configuration editor
```

No cockpit layout is implemented.

No map is implemented.

No navball is implemented.

---

## Phase 5 — Manual Navigation Workflow

Build support for:

```text
- recording Earth signal observations
- recording angular separations
- saving multiple candidate position estimates
- saving multiple candidate velocity estimates
- comparing candidate predictions in tables
- entering burn configs
- skipping time
- taking later position fixes
```

No correctness checking is implemented.

---

## Phase 6 — Trajectory Predictor

Build:

```text
- propagation from selected player-entered state
- burn execution inside prediction
- distances to Earth/Moon/Mars over time
- relative velocity output
- coordinate output table over time
```

The predictor does not solve the route.

The predictor does not identify correct or incorrect player calculations.

The predictor does not display a map.

The predictor outputs tables only.

---

## 20. Remaining Unresolved Questions

1. What exact syntax should the burn configuration interface use?

2. Should the in-game equation workspace include only candidate-search tables, or also a generic numerical root-finder?

3. What time span should the precomputed ephemeris cover?

4. What interval should the ephemeris table use before interpolation: hourly, daily, or another interval?

5. What RK4 timestep should be used for live simulation, time skipping, and prediction?

6. Should multiple candidate estimates be limited in number, or can the player save unlimited candidates?

7. Should the calculation workspace support importing/exporting calculation notes as text?
