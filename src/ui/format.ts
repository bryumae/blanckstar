// Display-formatting helpers shared across more than one UI screen
// (mvp0_spec.md §4.1/§6: UTC/km/s-labelled display units). Screen-local
// format.ts modules re-export these and add their own screen-specific
// helpers, so a screen never needs to reach into another screen's internals
// to get the same km/degrees formatting. (fmtMet is deliberately NOT here:
// the data screen prefixes "MET " and the shell doesn't, so it's not
// actually a duplicate despite the similar name.)
export function fmtKm(meters: number, digits = 0): string {
  return `${(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })} km`;
}

export function fmtKmPerS(mPerS: number, digits = 3): string {
  return `${(mPerS / 1000).toFixed(digits)} km/s`;
}

export function fmtDegrees(radians: number, digits = 2): string {
  return `${((radians * 180) / Math.PI).toFixed(digits)}°`;
}
