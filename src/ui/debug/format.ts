// Formatting helpers for the debug overlay (mvp0_spec.md §10). The sim's truth
// stream is SI (m, m/s); the overlay shows km/km/s per §4.1's UI-display rule
// plus the raw meters alongside, since debug mode's whole purpose is exposing
// ground truth precisely.
import type { Vector3 } from '../../core/vector3';
import { norm } from '../../core/vector3';

// "1234.568" — fixed decimals, no unit suffix (caller labels the unit).
export function formatNumber(value: number, decimals = 3): string {
  return value.toFixed(decimals);
}

export function metersToKm(value: number): number {
  return value / 1000;
}

export function metersPerSecToKmPerSec(value: number): number {
  return value / 1000;
}

// "(x, y, z) km" style vector formatting.
export function formatVectorKm(v: Vector3, decimals = 3): string {
  return `(${formatNumber(metersToKm(v.x), decimals)}, ${formatNumber(metersToKm(v.y), decimals)}, ${formatNumber(metersToKm(v.z), decimals)}) km`;
}

export function formatVectorKmPerSec(v: Vector3, decimals = 3): string {
  return `(${formatNumber(metersToKm(v.x), decimals)}, ${formatNumber(metersToKm(v.y), decimals)}, ${formatNumber(metersToKm(v.z), decimals)}) km/s`;
}

export function formatVectorRawMeters(v: Vector3, decimals = 1): string {
  return `(${formatNumber(v.x, decimals)}, ${formatNumber(v.y, decimals)}, ${formatNumber(v.z, decimals)}) m`;
}

export function formatVectorUnit(v: Vector3, decimals = 4): string {
  return `(${formatNumber(v.x, decimals)}, ${formatNumber(v.y, decimals)}, ${formatNumber(v.z, decimals)})`;
}

export function formatMagnitudeKm(v: Vector3, decimals = 3): string {
  return `${formatNumber(metersToKm(norm(v)), decimals)} km`;
}

export function formatMagnitudeKmPerSec(v: Vector3, decimals = 3): string {
  return `${formatNumber(metersToKm(norm(v)), decimals)} km/s`;
}

// UTC ISO-ish "YYYY-MM-DD HH:MM:SS Z" from a Unix-seconds sim time (§6: all
// displayed timestamps are UTC).
export function formatSimTimeUtc(simTimeSeconds: number): string {
  const iso = new Date(simTimeSeconds * 1000).toISOString(); // e.g. 2026-09-01T00:00:00.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} Z`;
}

// Mission-elapsed seconds -> "Dd HH:MM:SS".
export function formatMissionElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}
