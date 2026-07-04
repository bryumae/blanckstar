// Offline generation of data/starCatalog.json — the ~5,000 brightest real
// stars (mvp0_spec.md §7.1). Runnable via `npm run generate:stars`.
//
// Source: the HYG Database (github.com/astronexus/HYG-Database), a widely
// used open compilation merging the Hipparcos, Yale Bright Star, and Gliese
// catalogs. It ships right ascension/declination already in radians (J2000)
// and a "proper" column with common star names, so it parses more robustly
// than reconstructing names from a raw Yale BSC5 binary mirror.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HYG_CSV_URL =
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';

const STAR_COUNT = 5000;

interface Star {
  ra: number; // radians, J2000
  dec: number; // radians, J2000
  mag: number;
  name: string | null;
}

// Minimal CSV parser sufficient for HYG's format (quoted fields may contain
// commas, e.g. "9Alp CMa", but never embedded quotes or newlines).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const fields: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    fields.push(field);
    rows.push(fields);
  }
  return rows;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function main(): Promise<void> {
  console.log(`Fetching HYG database from ${HYG_CSV_URL}...`);
  const response = await fetch(HYG_CSV_URL);
  if (!response.ok) {
    throw new Error(`HYG fetch failed: HTTP ${response.status}`);
  }
  const csvText = await response.text();

  const rows = parseCsv(csvText);
  const header = rows[0];
  if (!header) {
    throw new Error('HYG CSV has no header row');
  }
  const idxOf = (col: string): number => {
    const idx = header.indexOf(col);
    if (idx === -1) throw new Error(`HYG CSV missing expected column "${col}"`);
    return idx;
  };

  const idIdx = idxOf('id');
  const raIdx = idxOf('rarad');
  const decIdx = idxOf('decrad');
  const magIdx = idxOf('mag');
  const properIdx = idxOf('proper');

  const stars: Star[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < header.length) continue;

    // HYG includes the Sun itself as id 0 (proper="Sol") — exclude it, it's
    // not a background star for telescope purposes.
    if (row[idIdx] === '0') continue;

    const ra = Number.parseFloat(row[raIdx] ?? '');
    const dec = Number.parseFloat(row[decIdx] ?? '');
    const mag = Number.parseFloat(row[magIdx] ?? '');
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(mag)) continue;

    const properName = row[properIdx]?.trim();
    stars.push({
      ra: round(ra, 6),
      dec: round(dec, 6),
      mag: round(mag, 2),
      name: properName && properName.length > 0 ? properName : null,
    });
  }

  stars.sort((a, b) => a.mag - b.mag);
  const brightest = stars.slice(0, STAR_COUNT);

  const json = JSON.stringify(brightest);
  const outPath = resolve(import.meta.dirname, '../data/starCatalog.json');
  writeFileSync(outPath, json, 'utf-8');

  const byteSize = Buffer.byteLength(json, 'utf-8');
  const namedCount = brightest.filter((s) => s.name !== null).length;
  console.log('\nSummary:');
  console.log(`  stars: ${brightest.length} (of ${stars.length} parsed, ${namedCount} named)`);
  console.log(`  brightest: ${brightest[0]?.name ?? '(unnamed)'} mag=${brightest[0]?.mag}`);
  console.log(`  size: ${(byteSize / 1024).toFixed(1)} KB`);
  console.log(`  written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
