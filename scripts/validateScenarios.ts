// Automated winnability validation for the curated scenario seeds (mvp0_spec.md
// §9, §12 AC13). For each seed this script computes a *developer reference
// solution* — a burn plan a competent player could fly — and runs it through the
// REAL simulation engine (src/sim/simulation.ts, driven directly via its
// injected `emit` seam, exactly like tests/unit/simulation.test.ts — no worker,
// no DOM), asserting that the `won` (Earth capture) event fires. It also checks
// the §9 / bvt §3 start-state constraints and re-runs seed 1's plan to prove
// end-to-end determinism (§12 AC2).
//
// The reference solver has TRUTH access (seed state + ephemeris) — that is fine
// on the dev side. What it must NOT do is use a Lambert solver, which §11 puts
// out of scope even hidden; instead it uses an iterative shooting method:
//
//   1. TARGETING burn at the epoch: coordinate-descent on an impulsive Δv so the
//      coasting trajectory's closest approach to Earth lands on a chosen
//      periapsis in the capture window (well inside the SOI, ~30,000 km altitude
//      so it clears the 120 km floor with wide margin).
//   2. CAPTURE burn near that periapsis: retrograde relative to Earth, sized to
//      drive the Earth-relative specific energy negative (bound) while staying
//      above the atmosphere.
//   3. Convert both impulses to finite burns (throttle 1, duration = |Δv| /
//      maxAccel — the physical relation the engine enforces, §5.2), then bisect
//      the capture-burn duration against the ACTUAL Simulation until `won` fires.
//
// Steps 1–2 use a fast local propagator built from the same src/core pieces the
// engine uses (rk4Step + gravityAcceleration), so the search is cheap; only the
// final plan is flown through the real Simulation class for the verdict.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { EphemerisData, BodyId } from '../src/core/ephemerisTypes';
import { positionAt, velocityAt } from '../src/core/ephemerisInterp';
import { rk4Step } from '../src/core/rk4';
import type { State } from '../src/core/rk4';
import { gravityAcceleration } from '../src/core/gravity';
import type { GravitatingBodies } from '../src/core/gravity';
import { orbitalElementsFromState } from '../src/core/orbitalElements';
import type { OrbitalElements } from '../src/core/orbitalElements';
import { add, sub, mul, norm, normalize } from '../src/core/vector3';
import type { Vector3 } from '../src/core/vector3';
import { MU_EARTH, MAX_ACCELERATION, R_EARTH, R_SOI_EARTH, AU } from '../src/core/constants';

import { Simulation } from '../src/sim/simulation';
import type { SimEvent } from '../src/sim/messages';
import type { ScenarioSeed } from '../src/sim/types';
import { SEEDS, SEED_EPOCH } from '../src/sim/seeds';

// ---- ephemeris loading (fs, no fetch — mirrors tests/unit/simHelpers.ts) ----

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function loadEphemeris(): EphemerisData {
  return JSON.parse(readFileSync(resolve(repoRoot, 'data/ephemeris.json'), 'utf8')) as EphemerisData;
}

// ---- fast local propagator (dev-side search only) ----
//
// Gravity is identical to the engine's (Sun+Earth+Moon point masses at the RK4
// stage time). The only difference from the engine is the timestep policy: for
// the SEARCH we take a coarser fixed cruise step and refine only when close to
// Earth, which is ~1000x faster than the engine's tiered walk yet accurate to
// the closest-approach distance we optimize on. The winning plan is always
// re-verified by the real Simulation, so this approximation never decides the
// pass/fail verdict — it only guides the search.

function bodiesAt(eph: EphemerisData, t: number): GravitatingBodies {
  return {
    sun: positionAt(eph, 'sun', t),
    earth: positionAt(eph, 'earth', t),
    moon: positionAt(eph, 'moon', t),
  };
}

function accelAt(eph: EphemerisData): (s: State, t: number) => Vector3 {
  return (s, t) => gravityAcceleration(s.position, bodiesAt(eph, t));
}

// Distance-tiered search step: 1200 s in deep cruise, tightening toward Earth.
function searchStep(dEarth: number): number {
  if (dEarth < 5e7) return 10;
  if (dEarth < 5e8) return 60;
  if (dEarth < 5e9) return 300;
  return 1200;
}

interface Impulse {
  readonly t: number; // unix seconds
  readonly dv: Vector3; // instantaneous velocity change (m/s), inertial frame
}

interface ApproachResult {
  readonly minDist: number; // min ship–Earth distance over the propagation (m)
  readonly minTime: number; // time of closest approach (unix s)
  readonly shipAt: State; // ship state at closest approach
  readonly earthAt: State; // Earth state at closest approach
}

// Coast from state0 at t0 for `span` seconds, applying impulses at their times,
// tracking the closest approach to Earth.
function propagate(
  eph: EphemerisData,
  state0: State,
  t0: number,
  span: number,
  impulses: readonly Impulse[],
): ApproachResult {
  const accel = accelAt(eph);
  const queue = [...impulses].sort((a, b) => a.t - b.t);
  const tEnd = t0 + span;
  let state = state0;
  let t = t0;
  let minDist = Infinity;
  let minTime = t0;
  let shipAt = state0;
  let earthAt: State = { position: bodiesAt(eph, t0).earth, velocity: velocityAt(eph, 'earth', t0) };

  while (t < tEnd) {
    while (queue.length > 0 && queue[0]!.t <= t + 1e-6) {
      const im = queue.shift()!;
      state = { position: state.position, velocity: add(state.velocity, im.dv) };
    }
    const earthP = positionAt(eph, 'earth', t);
    let h = searchStep(norm(sub(state.position, earthP)));
    const nextImp = queue.length > 0 ? queue[0]!.t : Infinity;
    if (t + h > nextImp) h = nextImp - t;
    if (t + h > tEnd) h = tEnd - t;
    if (h <= 0) break;
    state = rk4Step(state, t, h, accel);
    t += h;
    const eP = positionAt(eph, 'earth', t);
    const d = norm(sub(state.position, eP));
    if (d < minDist) {
      minDist = d;
      minTime = t;
      shipAt = state;
      earthAt = { position: eP, velocity: velocityAt(eph, 'earth', t) };
    }
  }
  return { minDist, minTime, shipAt, earthAt };
}

// ---- reference solver ----

// Coordinate-descent on a 3-vector to minimize `cost`. Deterministic (fixed
// start, fixed axis order, fixed step schedule) — no randomness.
function minimizeVec3(cost: (v: Vector3) => number, step0: number, minStep: number): Vector3 {
  let best: Vector3 = { x: 0, y: 0, z: 0 };
  let bestCost = cost(best);
  let step = step0;
  while (step >= minStep) {
    let improved = false;
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const s of [step, -step]) {
        const cand = { ...best, [axis]: best[axis] + s };
        const c = cost(cand);
        if (c < bestCost - 1) {
          bestCost = c;
          best = cand;
          improved = true;
        }
      }
    }
    if (!improved) step /= 2;
  }
  return best;
}

interface ReferencePlan {
  readonly targetingDv: Vector3; // impulsive targeting Δv at epoch
  readonly captureTime: number; // scheduled capture-burn start (unix s)
  readonly captureDir: Vector3; // capture-burn direction (unit, retrograde vs Earth)
  readonly captureDvGuess: number; // initial capture Δv magnitude estimate (m/s)
  readonly targetPeriapsis: number; // closest-approach radius the targeting aimed for (m)
  readonly approachDay: number; // days from epoch to closest approach
}

const TARGET_PERIAPSIS = R_EARTH + 30_000e3; // 30,000 km altitude: deep inside SOI, far above the 120 km floor.

// The natural (no-burn) closest approach to Earth: its time is the cheap arrival
// window for a targeting correction (correcting toward where the trajectory
// already trends costs far less Δv than forcing an early rushed intercept).
function naturalApproach(eph: EphemerisData, seed: ScenarioSeed, spanDays: number): ApproachResult {
  const s0: State = { position: seed.position, velocity: seed.velocity };
  return propagate(eph, s0, SEED_EPOCH, spanDays * 86400, []);
}

// Compute the impulsive reference plan for a seed by shooting: a targeting burn
// at the epoch that puts the periapsis of the arrival pass in the capture
// window, then a periapsis capture burn. `searchSpanDays` bounds how far ahead
// we look for the intercept.
function solve(eph: EphemerisData, seed: ScenarioSeed, searchSpanDays: number): ReferencePlan {
  const s0: State = { position: seed.position, velocity: seed.velocity };

  // 1. Sweep candidate arrival days and, for each, find the epoch targeting Δv
  //    that puts the ship at the TARGET_PERIAPSIS distance from Earth *at that
  //    arrival instant* (endpoint targeting — see propagateTo). Fixing the
  //    arrival time forbids the descent from bending into a cheap-looking early
  //    dip: the ship must be at the target distance exactly when we say. We keep
  //    the arrival day whose targeting Δv is smallest — the cheap correction. We
  //    seed the sweep around the natural closest approach and also scan later
  //    days for scenarios (like "long way home") whose cheap intercept is a
  //    partial extra orbit away.
  // 1. Both curated seeds are tuned so a small correction at the epoch brings a
  //    natural closest approach into the capture window. So: find the natural
  //    (no-burn) closest approach, cap the targeting propagation just past it
  //    (late re-encounters can't distract the search, and — crucially — an
  //    *early* rushed intercept can't win because the cap is short), and
  //    coordinate-descend the epoch Δv so that capped closest approach lands on
  //    TARGET_PERIAPSIS. The initial descent step is scaled down for longer
  //    horizons: a 1 m/s change many weeks out swings periapsis by megameters,
  //    so a horizon-appropriate step keeps the descent from overshooting.
  const natural = naturalApproach(eph, seed, searchSpanDays);
  const naturalDay = (natural.minTime - SEED_EPOCH) / 86400;
  const cap = Math.min(searchSpanDays, naturalDay + 12) * 86400;

  // Anchor the arrival to the natural closest approach. Capping the propagation
  // forbids *late* re-encounters, but not an early rushed intercept the greedy
  // descent could otherwise bend into (there are cheap-periapsis trajectories
  // that dip near Earth well before the natural pass). A penalty on how far the
  // achieved closest-approach *time* drifts from the natural one keeps the
  // search in the low-Δv basin where the trajectory already trends toward Earth.
  // Scale: 1 day of drift ≈ TARGET_PERIAPSIS of periapsis error — dominant
  // enough to pin the arrival, so the periapsis term only fine-tunes within the
  // natural pass. The step is scaled down for longer horizons (a 1 m/s change
  // weeks out swings periapsis by megameters), keeping the descent stable.
  const initialStep = Math.max(5, 500 * (46 / Math.max(naturalDay, 1)));
  const targetingDv = minimizeVec3((v) => {
    const a = propagate(eph, s0, SEED_EPOCH, cap, [{ t: SEED_EPOCH, dv: v }]);
    const miss = Math.abs(a.minDist - TARGET_PERIAPSIS);
    const driftDays = Math.abs(a.minTime - natural.minTime) / 86400;
    return miss + driftDays * TARGET_PERIAPSIS;
  }, initialStep, 0.25);
  const approach = propagate(eph, s0, SEED_EPOCH, cap, [{ t: SEED_EPOCH, dv: targetingDv }]);

  // 2. Capture burn: retrograde relative to Earth at the periapsis pass. Size it
  //    to null the excess over a firmly-bound (0.85x circular ⇒ e≈0.7) speed so
  //    the ship ends comfortably captured, not skimming the parabolic edge.
  //    Refined against the real engine later.
  const vRel = sub(approach.shipAt.velocity, approach.earthAt.velocity);
  const vRelMag = norm(vRel);
  const vCircular = Math.sqrt(MU_EARTH / approach.minDist);
  const captureDvGuess = Math.max(0, vRelMag - vCircular * 0.85);
  const captureDir = mul(normalize(vRel), -1); // retrograde

  return {
    targetingDv,
    captureTime: approach.minTime,
    captureDir,
    captureDvGuess,
    targetPeriapsis: approach.minDist,
    approachDay: (approach.minTime - SEED_EPOCH) / 86400,
  };
}

// ---- real-engine flight ----

// Collects the emitted event stream, like the EventCollector in the unit tests.
class Collector {
  readonly events: SimEvent[] = [];
  readonly emit = (e: SimEvent): void => {
    this.events.push(e);
  };
  ofType<T extends SimEvent['type']>(type: T): Extract<SimEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[];
  }
}

// A finite burn as the engine executes it: point at `direction`, thrust at full
// throttle for `duration` seconds (Δv = maxAccel * duration).
interface FiniteBurn {
  readonly startTime: number;
  readonly direction: Vector3;
  readonly duration: number;
}

function burnDuration(dvMagnitude: number, maxAccel: number): number {
  return dvMagnitude / maxAccel;
}

interface FlightResult {
  readonly won: boolean;
  readonly lost: string | null;
  readonly finalState: State | null; // ship state at the verdict (for determinism check)
  readonly missionElapsed: number | null;
  readonly deltaVSpent: number | null;
  readonly orbit: OrbitalElements | null;
}

// Fly a plan through the real Simulation. Burns are centered on their impulsive
// time so a finite burn's net Δv is applied around the same instant. Returns the
// verdict and — on a win — the final ship state for the determinism check.
function fly(
  eph: EphemerisData,
  seed: ScenarioSeed,
  burns: readonly FiniteBurn[],
  arrivalDay: number,
): FlightResult {
  const maxAccel = seed.maxAcceleration ?? MAX_ACCELERATION;
  const c = new Collector();
  const sim = new Simulation(c.emit);
  sim.init(eph, seed);

  for (const b of burns) {
    sim.scheduleBurn(b.startTime, b.direction, 1, b.duration);
  }

  // Skip forward in day-long chunks so scheduled-burn / SOI interrupts are
  // honored; on any interrupt we simply continue skipping past it.
  const targetTime = SEED_EPOCH + (arrivalDay + 30) * 86400;
  let guard = 0;
  while (sim.getSimTime() < targetTime && !sim.isOver() && guard++ < 100_000) {
    sim.skipToTime(Math.min(sim.getSimTime() + 6 * 3600, targetTime));
  }

  const won = c.ofType('won');
  const lost = c.ofType('lost');
  if (won.length > 0) {
    const w = won[won.length - 1]!;
    const finalState = lastShipState(c);
    return {
      won: true,
      lost: null,
      finalState,
      missionElapsed: w.stats.missionElapsed,
      deltaVSpent: w.stats.deltaVSpent,
      orbit: w.stats.orbit,
    };
  }
  return {
    won: false,
    lost: lost.length > 0 ? lost[lost.length - 1]!.reason : null,
    finalState: lastShipState(c),
    missionElapsed: null,
    deltaVSpent: null,
    orbit: null,
  };
}

function lastShipState(c: Collector): State | null {
  const states = c.ofType('state');
  if (states.length === 0) return null;
  const s = states[states.length - 1]!.ship;
  return { position: s.position, velocity: s.velocity };
}

// Build finite burns from the impulsive plan, centering each on its impulse time.
function planToBurns(plan: ReferencePlan, captureDv: number, maxAccel: number): FiniteBurn[] {
  const targetingDvMag = norm(plan.targetingDv);
  const targetingDur = burnDuration(targetingDvMag, maxAccel);
  const captureDur = burnDuration(captureDv, maxAccel);
  const burns: FiniteBurn[] = [];
  if (targetingDvMag > 0) {
    // Center the targeting burn on the epoch by starting at the epoch (the sim
    // clock starts here; startTime can't precede it). The half-duration offset
    // is tiny relative to the multi-week coast, so it does not disturb the aim.
    burns.push({
      startTime: SEED_EPOCH,
      direction: normalize(plan.targetingDv),
      duration: targetingDur,
    });
  }
  // Center the capture burn on the periapsis pass.
  burns.push({
    startTime: plan.captureTime - captureDur / 2,
    direction: plan.captureDir,
    duration: captureDur,
  });
  return burns;
}

// Bisect the capture-burn Δv against the real engine until `won` fires. Too
// little Δv stays unbound (miss); too much drops the ship into the atmosphere
// (lose). We search upward from the analytic guess, then bisect the winning
// bracket to a plan flown well clear of both failure modes.
interface VerifiedFlight {
  readonly result: FlightResult;
  readonly captureDv: number;
  readonly burns: FiniteBurn[];
}

function verify(eph: EphemerisData, seed: ScenarioSeed, plan: ReferencePlan): VerifiedFlight | null {
  const maxAccel = seed.maxAcceleration ?? MAX_ACCELERATION;
  const tryDv = (dv: number): FlightResult =>
    fly(eph, seed, planToBurns(plan, dv, maxAccel), plan.approachDay);

  // Sweep capture Δv across a band around the analytic guess (which itself aims
  // at a firmly-bound orbit). Too little Δv stays unbound (miss); too much drops
  // into the atmosphere (lose). Among all winning candidates, keep the one whose
  // orbit is most clearly captured — lowest eccentricity — rather than the first
  // barely-bound one, so the reference solution demonstrates a solid capture.
  const guess = plan.captureDvGuess;
  const factors = [0.6, 0.75, 0.85, 0.95, 1.0, 1.05, 1.15, 1.3, 1.5, 1.75, 2.0];
  let bestDv = -1;
  let bestResult: FlightResult | null = null;
  let bestEcc = Infinity;
  for (const f of factors) {
    const dv = guess * f;
    if (dv <= 0) continue;
    const r = tryDv(dv);
    if (r.won && r.orbit && r.orbit.eccentricity < bestEcc) {
      bestEcc = r.orbit.eccentricity;
      bestDv = dv;
      bestResult = r;
    }
  }
  if (!bestResult || bestDv < 0) {
    return null;
  }
  return { result: bestResult, captureDv: bestDv, burns: planToBurns(plan, bestDv, maxAccel) };
}

// ---- start-state constraint checks (§9, bvt §3) ----

interface ConstraintReport {
  readonly heliocentric: boolean; // outside every body SOI at the epoch
  readonly notTrivialEarth: boolean; // ≥ 5×R_SOI from Earth at the epoch
  readonly heliocentricRadiusAu: number;
  readonly earthDistSoi: number; // ship–Earth distance in units of R_SOI
}

function checkConstraints(eph: EphemerisData, seed: ScenarioSeed): ConstraintReport {
  const sunP = positionAt(eph, 'sun', seed.epoch);
  const earthP = positionAt(eph, 'earth', seed.epoch);
  const moonP = positionAt(eph, 'moon', seed.epoch);
  const dEarth = norm(sub(seed.position, earthP));
  const dMoon = norm(sub(seed.position, moonP));
  const rSun = norm(sub(seed.position, sunP));
  // Moon SOI ~ 6.6e7 m; use a generous margin. Earth SOI is R_SOI_EARTH.
  const outsideEarthSoi = dEarth > R_SOI_EARTH;
  const outsideMoonSoi = dMoon > 1e8;
  return {
    heliocentric: outsideEarthSoi && outsideMoonSoi,
    notTrivialEarth: dEarth > 5 * R_SOI_EARTH,
    heliocentricRadiusAu: rSun / AU,
    earthDistSoi: dEarth / R_SOI_EARTH,
  };
}

// ---- reporting ----

function fmtKm(m: number): string {
  return `${(m / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} km`;
}

function describeOrbit(o: OrbitalElements): string {
  const peri = fmtKm(o.periapsis - R_EARTH);
  const apo = o.apoapsis === Infinity ? '∞' : fmtKm(o.apoapsis - R_EARTH);
  const periodH = o.period === null ? '—' : `${(o.period / 3600).toFixed(1)} h`;
  return `e=${o.eccentricity.toFixed(3)}, i=${((o.inclination * 180) / Math.PI).toFixed(1)}°, peri alt ${peri}, apo alt ${apo}, period ${periodH}`;
}

function fmtDays(seconds: number): string {
  return `${(seconds / 86400).toFixed(1)} d`;
}

// ---- main ----

// Per-seed search horizon (days). Seed 1 intercepts naturally within ~2 months;
// seed 2 ("long way home") needs a longer arc to a cheap intercept.
const SEARCH_SPAN_DAYS: Record<string, number> = {
  'close-call': 120,
  'long-way-home': 220,
};

function main(): void {
  const eph = loadEphemeris();
  const t0 = Date.now();
  let allPassed = true;
  const lines: string[] = [];

  for (const seed of SEEDS) {
    lines.push('');
    lines.push(`━━━ ${seed.id} — "${seed.title}" ━━━`);

    // Start-state constraints.
    const cc = checkConstraints(eph, seed);
    lines.push(
      `  start: |r_sun| = ${cc.heliocentricRadiusAu.toFixed(3)} AU, ` +
        `Earth distance = ${cc.earthDistSoi.toFixed(1)}×R_SOI`,
    );
    lines.push(`    heliocentric (outside all SOIs): ${cc.heliocentric ? 'OK' : 'FAIL'}`);
    lines.push(`    not trivially at Earth (>5×R_SOI): ${cc.notTrivialEarth ? 'OK' : 'FAIL'}`);
    if (!cc.heliocentric || !cc.notTrivialEarth) {
      allPassed = false;
    }

    // Reference solution.
    const span = SEARCH_SPAN_DAYS[seed.id] ?? 200;
    const plan = solve(eph, seed, span);
    const targetingDvMag = norm(plan.targetingDv);
    lines.push(
      `  targeting burn @ epoch: Δv = ${targetingDvMag.toFixed(1)} m/s → periapsis alt ` +
        `${fmtKm(plan.targetPeriapsis - R_EARTH)} on day ${plan.approachDay.toFixed(1)}`,
    );

    const verified = verify(eph, seed, plan);
    if (!verified || !verified.result.won) {
      allPassed = false;
      lines.push(`  RESULT: FAIL — no capture found (last verdict: ${verified?.result.lost ?? 'no win'})`);
      continue;
    }

    const r = verified.result;
    const totalDv = r.deltaVSpent ?? 0;
    // The capture burn is *scheduled* for verified.captureDv, but the sim halts
    // the instant capture is detected — so the Δv actually spent (which the
    // engine reports) is the targeting burn plus however much of the capture
    // burn ran before `won` fired. Report both so the number isn't confusing.
    lines.push(`  capture burn near periapsis: scheduled Δv = ${verified.captureDv.toFixed(1)} m/s (retrograde vs Earth)`);
    lines.push(`  burns used: ${verified.burns.length}`);
    lines.push(`  Δv actually spent to capture: ${totalDv.toFixed(1)} m/s (targeting ${targetingDvMag.toFixed(1)} + partial capture)`);
    lines.push(`  mission duration: ${fmtDays(r.missionElapsed ?? 0)}`);
    lines.push(`  capture orbit: ${r.orbit ? describeOrbit(r.orbit) : '—'}`);
    lines.push(`  RESULT: WON`);

    // Determinism (§12 AC2): re-fly seed 1's exact winning plan and assert the
    // final ship state is bit-identical.
    if (seed.id === 'close-call' && r.finalState) {
      const again = fly(eph, seed, verified.burns, plan.approachDay);
      const identical =
        again.won &&
        again.finalState !== null &&
        again.finalState.position.x === r.finalState.position.x &&
        again.finalState.position.y === r.finalState.position.y &&
        again.finalState.position.z === r.finalState.position.z &&
        again.finalState.velocity.x === r.finalState.velocity.x &&
        again.finalState.velocity.y === r.finalState.velocity.y &&
        again.finalState.velocity.z === r.finalState.velocity.z;
      lines.push(`  determinism (AC2): re-flight bit-identical: ${identical ? 'OK' : 'FAIL'}`);
      if (!identical) {
        allPassed = false;
      }
    }
  }

  const runtime = ((Date.now() - t0) / 1000).toFixed(1);
  lines.push('');
  lines.push(`runtime: ${runtime}s`);
  lines.push(allPassed ? '✅ ALL SEEDS WINNABLE' : '❌ VALIDATION FAILED');

  console.log(lines.join('\n'));
  if (!allPassed) {
    process.exit(1);
  }
}

main();
