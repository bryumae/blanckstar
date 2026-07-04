// Shell-local display formatting (mvp0_spec.md §6: UTC dates, MET, km/s
// display units). Mirrors src/ui/data/format.ts conventions but the shell
// owns its own copy per the phase-9 boundary (it may not import
// src/ui/data internals).
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

export function fmtKm(meters: number, digits = 0): string {
  return `${(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })} km`;
}

export function fmtKmPerS(mPerS: number, digits = 3): string {
  return `${(mPerS / 1000).toFixed(digits)} km/s`;
}

export function fmtDegrees(radians: number, digits = 2): string {
  return `${((radians * 180) / Math.PI).toFixed(digits)}°`;
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
