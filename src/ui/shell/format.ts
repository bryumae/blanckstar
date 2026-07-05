// Shell-local display formatting (mvp0_spec.md §6: UTC dates, MET, km/s
// display units). Shares the km/degrees formatters with the Data screen via
// ../format.ts; the shell owns its own copy of anything screen-specific per
// the phase-9 boundary (it may not import src/ui/data internals).
export { fmtKm, fmtKmPerS, fmtDegrees } from '../format';

export function fmtUtcClock(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toISOString().replace('T', ' ').replace('.000Z', 'Z');
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
  return `${sign}${days}d ${hh}:${mm}:${ss}`;
}

export function fmtDuration(seconds: number): string {
  const s = Math.floor(Math.abs(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${s % 60}s`;
}
