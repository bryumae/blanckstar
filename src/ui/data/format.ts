// Formatting helpers for the Data screen (mvp0_spec.md §7). Pure display-layer
// utilities: SI-internal values in, UTC/km/s-labelled strings out (§4.1). No
// truth leaks here — callers decide what's safe to show.
import type { Vector3 } from '../../core/vector3';

export function fmtUtc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('.000Z', 'Z');
}

export function fmtMet(missionElapsedSeconds: number): string {
  const sign = missionElapsedSeconds < 0 ? '-' : '+';
  const s = Math.floor(Math.abs(missionElapsedSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `MET ${sign}${days}d ${hh}:${mm}:${ss}`;
}

export function fmtVec(v: Vector3, digits = 3): string {
  return `(${v.x.toFixed(digits)}, ${v.y.toFixed(digits)}, ${v.z.toFixed(digits)})`;
}

export function fmtKm(meters: number, digits = 0): string {
  return `${(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })} km`;
}

export function fmtKmVec(vMeters: Vector3, digits = 1): string {
  return `(${(vMeters.x / 1000).toFixed(digits)}, ${(vMeters.y / 1000).toFixed(digits)}, ${(vMeters.z / 1000).toFixed(digits)})`;
}

export function fmtKmPerS(mPerS: number, digits = 3): string {
  return `${(mPerS / 1000).toFixed(digits)} km/s`;
}

export function fmtNumber(x: number, digits = 3): string {
  return x.toFixed(digits);
}

export function fmtScientific(x: number, digits = 6): string {
  return x.toExponential(digits).replace('e+', ' × 10^').replace('e-', ' × 10^-');
}

export function fmtDegrees(radians: number, digits = 2): string {
  return `${((radians * 180) / Math.PI).toFixed(digits)}°`;
}

export function fmtAU(meters: number, auMeters: number, digits = 4): string {
  return (meters / auMeters).toFixed(digits);
}
