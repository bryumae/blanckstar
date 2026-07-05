// Offline generation of data/ephemeris.json from JPL Horizons — position +
// velocity samples for sun/earth/moon/mars/venus/jupiter, heliocentric
// ecliptic J2000 frame. Run at build time, never at runtime (mvp0_spec.md
// §4.5). Runnable via `npm run generate:ephemeris`.
//
// Time convention: Horizons returns vector-table epochs as TDB. This project
// treats TDB ≈ UTC (the two differ by a near-constant ~69 s in this era) and
// does NOT apply the offset — for a game where the sim clock is an internal
// fiction anyway, the extra precision isn't worth the complexity, and it
// keeps the JD→unix-seconds conversion a pure calendar computation. If a
// future phase needs sub-minute light-time precision, revisit this.
//
// Rounding: positions are rounded to the nearest 1 m, velocities to the
// nearest 1e-6 m/s, to keep the committed JSON compact. This is well within
// Horizons' own DE441 ephemeris accuracy for MVP0 purposes.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';

const COVERAGE_START = '2026-08-01T00:00:00Z';
const COVERAGE_END = '2028-10-01T00:00:00Z';

interface BodySpec {
  readonly id: string; // display key in output JSON
  readonly command: string; // Horizons COMMAND id
  readonly stepSeconds: number; // sample spacing
}

// Sun is the frame origin — emitted as all-zero samples rather than fetched,
// so downstream interpolation code never has to special-case it.
const SUN_ID = 'sun';

const BODIES: readonly BodySpec[] = [
  { id: 'earth', command: '399', stepSeconds: 86400 },
  { id: 'moon', command: '301', stepSeconds: 3600 },
  { id: 'mars', command: '499', stepSeconds: 86400 },
  { id: 'venus', command: '299', stepSeconds: 86400 },
  { id: 'jupiter', command: '599', stepSeconds: 86400 },
];

interface BodySeries {
  t0: number;
  dt: number;
  samples: number[][];
}

function toUnixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function formatHorizonsTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace(/\.\d+Z$/, '');
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function stepLabel(stepSeconds: number): string {
  if (stepSeconds % 86400 === 0) return `${stepSeconds / 86400}d`;
  if (stepSeconds % 3600 === 0) return `${stepSeconds / 3600}h`;
  return `${stepSeconds}s`;
}

async function fetchHorizonsChunk(
  command: string,
  startUnix: number,
  stopUnix: number,
  stepSeconds: number,
): Promise<string> {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${command}'`,
    EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@10'",
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'J2000',
    VEC_TABLE: '2',
    START_TIME: `'${formatHorizonsTime(startUnix)}'`,
    STOP_TIME: `'${formatHorizonsTime(stopUnix)}'`,
    STEP_SIZE: `'${stepLabel(stepSeconds)}'`,
  });
  const url = `${HORIZONS_URL}?${params.toString()}`;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Horizons request failed: HTTP ${response.status} for ${url}`);
    }
    const body = (await response.json()) as { result?: string; error?: string };
    if (body.error) {
      throw new Error(`Horizons API error for command ${command}: ${body.error}`);
    }
    if (!body.result) {
      throw new Error(`Horizons response missing "result" for command ${command}`);
    }
    if (body.result.includes('$$SOE')) {
      return body.result;
    }
    // Transient/busy responses sometimes omit the vector block; back off and retry.
    if (attempt < maxAttempts) {
      await sleep(1500 * attempt);
      continue;
    }
    throw new Error(`Horizons response for command ${command} had no $$SOE block:\n${body.result.slice(0, 500)}`);
  }
  throw new Error('unreachable');
}

// Each data line pair looks like:
//   2461253.500000000 = A.D. 2026-Aug-01 00:00:00.0000 TDB
//    X = 9.4712...E+07 Y =-1.1912...E+08 Z = 1.0515...E+04
//    VX= 2.3224...E+01 VY= 1.9317...E+01 VZ= 8.8525...E-02
function parseVectorBlock(raw: string): Array<{ jd: number; km: number[]; kmPerSec: number[] }> {
  const soeIdx = raw.indexOf('$$SOE');
  const eoeIdx = raw.indexOf('$$EOE');
  if (soeIdx === -1 || eoeIdx === -1) {
    throw new Error('vector block markers not found');
  }
  const block = raw.slice(soeIdx + '$$SOE'.length, eoeIdx);
  const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  const records: Array<{ jd: number; km: number[]; kmPerSec: number[] }> = [];
  for (let i = 0; i < lines.length; i += 3) {
    const jdLine = lines[i];
    const xyzLine = lines[i + 1];
    const vLine = lines[i + 2];
    if (!jdLine || !xyzLine || !vLine) break;

    const jd = Number.parseFloat((jdLine.split('=')[0] ?? '').trim());

    const xyzMatch = xyzLine.match(
      /X\s*=\s*([-+.\dE]+)\s*Y\s*=\s*([-+.\dE]+)\s*Z\s*=\s*([-+.\dE]+)/,
    );
    const vMatch = vLine.match(/VX=\s*([-+.\dE]+)\s*VY=\s*([-+.\dE]+)\s*VZ=\s*([-+.\dE]+)/);
    if (!xyzMatch || !vMatch) {
      throw new Error(`failed to parse vector lines:\n${xyzLine}\n${vLine}`);
    }

    records.push({
      jd,
      km: [
        Number.parseFloat(xyzMatch[1] ?? ''),
        Number.parseFloat(xyzMatch[2] ?? ''),
        Number.parseFloat(xyzMatch[3] ?? ''),
      ],
      kmPerSec: [
        Number.parseFloat(vMatch[1] ?? ''),
        Number.parseFloat(vMatch[2] ?? ''),
        Number.parseFloat(vMatch[3] ?? ''),
      ],
    });
  }
  return records;
}

function jdToUnixSeconds(jd: number): number {
  // Unix epoch (1970-01-01T00:00:00) is JD 2440587.5.
  return Math.round((jd - 2440587.5) * 86400);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchBodySeries(spec: BodySpec, startUnix: number, endUnix: number): Promise<BodySeries> {
  // Horizons caps response size; chunk long windows (the Moon at 1h steps
  // over ~26 months is ~19k samples) into ~90-day windows and concatenate.
  const chunkSeconds = 90 * 86400;
  const allRecords: Array<{ jd: number; km: number[]; kmPerSec: number[] }> = [];

  let chunkStart = startUnix;
  while (chunkStart < endUnix) {
    const chunkEnd = Math.min(chunkStart + chunkSeconds, endUnix);
    const raw = await fetchHorizonsChunk(spec.command, chunkStart, chunkEnd, spec.stepSeconds);
    const records = parseVectorBlock(raw);
    allRecords.push(...records);
    chunkStart = chunkEnd;
    // Be polite to the public API between sequential requests.
    await sleep(300);
  }

  // De-duplicate boundary samples shared between consecutive chunks (the end
  // of one chunk equals the start of the next).
  const seenUnix = new Set<number>();
  const samples: number[][] = [];
  let t0: number | null = null;
  for (const record of allRecords) {
    const unixSeconds = jdToUnixSeconds(record.jd);
    if (seenUnix.has(unixSeconds)) continue;
    seenUnix.add(unixSeconds);
    if (t0 === null) t0 = unixSeconds;

    const [xKm = 0, yKm = 0, zKm = 0] = record.km;
    const [vxKmS = 0, vyKmS = 0, vzKmS = 0] = record.kmPerSec;
    samples.push([
      round(xKm * 1000, 0),
      round(yKm * 1000, 0),
      round(zKm * 1000, 0),
      round(vxKmS * 1000, 6),
      round(vyKmS * 1000, 6),
      round(vzKmS * 1000, 6),
    ]);
  }

  if (t0 === null) {
    throw new Error(`no samples fetched for ${spec.id}`);
  }

  return { t0, dt: spec.stepSeconds, samples };
}

function buildSunSeries(referenceStepSeconds: number, sampleCount: number): BodySeries {
  const zeroSample = [0, 0, 0, 0, 0, 0];
  return {
    t0: toUnixSeconds(COVERAGE_START),
    dt: referenceStepSeconds,
    samples: Array.from({ length: sampleCount }, () => zeroSample),
  };
}

// Serialize with each sample array on one line, for a readable-but-compact
// committed JSON file (avoids one-number-per-line bloat from JSON.stringify).
function serializeEphemeris(bodies: Record<string, BodySeries>): string {
  const bodyEntries = Object.entries(bodies).map(([id, series]) => {
    const sampleLines = series.samples.map((s) => `[${s.join(',')}]`).join(',');
    return `    "${id}": {\n      "t0": ${series.t0},\n      "dt": ${series.dt},\n      "samples": [${sampleLines}]\n    }`;
  });

  return (
    '{\n' +
    '  "frame": "heliocentric-ecliptic-J2000",\n' +
    '  "units": { "position": "m", "velocity": "m/s", "time": "unix-seconds" },\n' +
    '  "bodies": {\n' +
    bodyEntries.join(',\n') +
    '\n  }\n' +
    '}\n'
  );
}

async function main(): Promise<void> {
  const startUnix = toUnixSeconds(COVERAGE_START);
  const endUnix = toUnixSeconds(COVERAGE_END);

  console.log(`Generating ephemeris for ${COVERAGE_START} .. ${COVERAGE_END}`);

  const bodies: Record<string, BodySeries> = {};

  for (const spec of BODIES) {
    console.log(`Fetching ${spec.id} (command ${spec.command}, step ${stepLabel(spec.stepSeconds)})...`);
    const series = await fetchBodySeries(spec, startUnix, endUnix);
    bodies[spec.id] = series;
    console.log(`  ${spec.id}: ${series.samples.length} samples`);
  }

  // Match the Sun's sample count/spacing to Earth's (daily) series so the
  // schema stays uniform without inflating file size with an hourly zero series.
  const earthSeries = bodies.earth;
  if (!earthSeries) {
    throw new Error('earth series missing — cannot size the sun placeholder series');
  }
  bodies[SUN_ID] = buildSunSeries(earthSeries.dt, earthSeries.samples.length);

  const json = serializeEphemeris(bodies);
  const outPath = resolve(import.meta.dirname, '../data/ephemeris.json');
  writeFileSync(outPath, json, 'utf-8');

  const byteSize = Buffer.byteLength(json, 'utf-8');
  console.log('\nSummary:');
  for (const [id, series] of Object.entries(bodies)) {
    console.log(`  ${id}: ${series.samples.length} samples, dt=${series.dt}s, t0=${series.t0}`);
  }
  console.log(`  total size: ${(byteSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
