// Named-script persistence for the sequence console (mvp0_spec.md §2.3, §7.9:
// multiple named scripts persist across retries via localStorage). Pure model
// over the injected StorageLike seam (src/net/storage) — no DOM — so it is
// round-trip testable with a fake store.
import type { StorageLike } from '../../net/storage';
import { readJson, writeJson } from '../../net/storage';

export interface ScriptEntry {
  readonly id: string;
  readonly name: string;
  readonly source: string;
}

// Persisted shape: the script list plus which one is open.
interface PersistedScripts {
  readonly scripts: ScriptEntry[];
  readonly lastOpenId: string | null;
}

const STORAGE_KEY = 'blanckstar.scripts.v1';

const STARTER_SOURCE = `// Player script — sandboxed JS (see README §Scripting API).
// Instrument/ship/wait calls are async; await them.

const lock = await radio.lockEarth();
log('range (km):', (lock.rangeMeters / 1000).toFixed(0));
log('earth dir:', lock.direction);

const sun = await sensors.sunDirection();
log('sun dir:', sun);
`;

// Full text of README.md's "Scripting API" section, kept as comments so it's
// inert to run (harmless if the player hits Run) but always at hand without
// leaving the app. Keep in sync with README.md if that section changes.
const API_REFERENCE_SOURCE = `// Scripting API reference — copied from README.md §Scripting API.
// This script is comments only; running it does nothing.
//
// Player scripts are real JavaScript, run in a dedicated sandboxed Web
// Worker with a clean global scope (no DOM, no network, no
// importScripts). Every instrument/ship call and wait() is async —
// await them. Multiple named scripts persist in localStorage and
// survive retries.
//
// ---- time ----
// time.now()                       // -> Promise<number>, sim time (Unix seconds, UTC clock)
// await wait(seconds)              // suspends the script while sim time advances
//
// ---- logging ----
// log(...values)                   // prints to the console pane
// await log.measurements()         // -> Measurement[]; the full measurement log this run
//
// ---- radio ----
// const lock = await radio.lockEarth();
// // -> { rangeMeters, direction: Vec3, quality, tSent, tReceived }
// // direction is toward Earth's position AT TRANSMIT TIME (light-time honest)
//
// ---- sensors + telescope ----
// const sun = await sensors.sunDirection();      // -> Vec3, unit vector, inertial frame
// const att = await sensors.starAttitude();      // -> { forward: Vec3 }
// const theta = await telescope.angularSeparation('earth', 'mars'); // -> radians
//
// ---- ephemeris (bodies: "sun"|"earth"|"moon"|"mars"|"venus"|"jupiter") ----
// const p = await ephemeris.position('earth', time.now());  // -> Vec3, meters
// const v = await ephemeris.velocity('earth', time.now());  // -> Vec3, m/s
//
// ---- vector math (local, synchronous) ----
// const a = vec(1, 0, 0);
// add(a, b); sub(a, b); mul(a, 3); dot(a, b); cross(a, b);
// norm(a); normalize(a); angleBetween(a, b);
//
// ---- ship (point-then-burn) ----
// await ship.point(vec(0, 1, 0));           // instant re-orient, inertial frame
// await ship.burn(1.0, 30);                 // throttle in [0,1], duration in seconds
// const handle = ship.scheduleBurn(startTime, direction, throttle, duration);
// await ship.cancelBurn(handle);
// const status = await ship.status();
// // -> { forward, deltaVSpent, burning, scheduledBurns, massKg, maxAcceleration, maxThrustNewtons }
//
// ---- prediction — same engine as the live simulation, never validates truth ----
// const samples = predict(
//   { position, velocity, epoch },          // player-entered/candidate state
//   [{ startTime, direction, throttle, duration }],  // burns, optional
//   30 * 86400,                              // duration, seconds
//   86400,                                   // stepOut, seconds between samples
// );
//
// ---- constants ----
// C, MU_SUN, MU_EARTH, MU_MOON, R_EARTH, R_MOON, R_SOI_EARTH, AU, SHIP_MASS_KG
//
// ---- worked example — take a radio lock and a sun-direction reading, then
// log both ----
//
// const lock = await radio.lockEarth();
// log('range (km):', (lock.rangeMeters / 1000).toFixed(0));
// log('earth dir:', lock.direction);
//
// const sun = await sensors.sunDirection();
// log('sun dir:', sun);
//
// ---- forbidden (never exposed to scripts, regardless of debug mode) ----
// ship.truePosition(), ship.trueVelocity(), ship.currentOrbit(),
// ship.distanceTo(body), any transfer/autopilot/route solver, debug.*.
// The stop button always terminates the sandbox worker immediately; a
// runaway script cannot hang the game.
`;

let idCounter = 0;
function freshId(): string {
  idCounter += 1;
  return `s${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// A single script's default name generator.
function defaultName(existing: readonly ScriptEntry[]): string {
  let n = existing.length + 1;
  let name = `script_${n}.js`;
  const names = new Set(existing.map((s) => s.name));
  while (names.has(name)) {
    n += 1;
    name = `script_${n}.js`;
  }
  return name;
}

// The in-memory store, backed by StorageLike. All mutations persist immediately.
export class ScriptStore {
  private scripts: ScriptEntry[];
  private lastOpenId: string | null;

  constructor(private readonly storage: StorageLike) {
    const persisted = readJson<PersistedScripts>(storage, STORAGE_KEY);
    if (persisted && persisted.scripts.length > 0) {
      this.scripts = persisted.scripts.map((s) => ({ ...s }));
      this.lastOpenId = persisted.lastOpenId ?? this.scripts[0]!.id;
    } else {
      const starter: ScriptEntry = { id: freshId(), name: 'sequence.js', source: STARTER_SOURCE };
      const apiReference: ScriptEntry = {
        id: freshId(),
        name: 'api-reference.js',
        source: API_REFERENCE_SOURCE,
      };
      this.scripts = [starter, apiReference];
      this.lastOpenId = starter.id;
      this.persist();
    }
  }

  list(): readonly ScriptEntry[] {
    return this.scripts;
  }

  getOpenId(): string | null {
    return this.lastOpenId;
  }

  get(id: string): ScriptEntry | undefined {
    return this.scripts.find((s) => s.id === id);
  }

  setOpen(id: string): void {
    if (this.scripts.some((s) => s.id === id)) {
      this.lastOpenId = id;
      this.persist();
    }
  }

  create(): ScriptEntry {
    const entry: ScriptEntry = { id: freshId(), name: defaultName(this.scripts), source: '' };
    this.scripts.push(entry);
    this.lastOpenId = entry.id;
    this.persist();
    return entry;
  }

  updateSource(id: string, source: string): void {
    this.mutate(id, (s) => ({ ...s, source }));
  }

  rename(id: string, name: string): void {
    this.mutate(id, (s) => ({ ...s, name }));
  }

  // Delete a script. If it was open, open falls to the neighbor (or a fresh
  // starter if the list would be empty — the console always has one script).
  delete(id: string): void {
    const idx = this.scripts.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.scripts.splice(idx, 1);
    if (this.scripts.length === 0) {
      const starter: ScriptEntry = { id: freshId(), name: 'sequence.js', source: STARTER_SOURCE };
      this.scripts.push(starter);
      this.lastOpenId = starter.id;
    } else if (this.lastOpenId === id) {
      this.lastOpenId = this.scripts[Math.min(idx, this.scripts.length - 1)]!.id;
    }
    this.persist();
  }

  private mutate(id: string, fn: (s: ScriptEntry) => ScriptEntry): void {
    const idx = this.scripts.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.scripts[idx] = fn(this.scripts[idx]!);
    this.persist();
  }

  private persist(): void {
    writeJson<PersistedScripts>(this.storage, STORAGE_KEY, {
      scripts: this.scripts,
      lastOpenId: this.lastOpenId,
    });
  }
}
