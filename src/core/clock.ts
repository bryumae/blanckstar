// Numeric mission-time math (mvp0_spec.md §6). UTC/date formatting is a UI
// concern and lives in the UI layer; this module is pure numeric time only:
// mission-elapsed seconds relative to a scenario epoch, both directions.
// Time is unix seconds throughout, matching the ephemeris `time: unix-seconds`
// contract.

// Mission-elapsed seconds: how long since the scenario epoch.
export function missionElapsed(epoch: number, now: number): number {
  return now - epoch;
}

// Absolute unix time from mission-elapsed seconds.
export function timeFromElapsed(epoch: number, elapsed: number): number {
  return epoch + elapsed;
}
