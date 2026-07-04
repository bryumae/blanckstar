// Local mirror of the sim's measurement log (mvp0_spec.md §7.5). The sim worker
// owns the authoritative log; the Data screen mirrors `measurementAdded` events
// plus local note echoes so the UI can render/export without a round-trip
// query command (none exists in the protocol — mirroring is the intended
// pattern, matching how src/ui/telescope's separation logging works). Clears on
// `ready` (new run / retry), matching the sim's own reset-on-restart semantics
// (mvp0_spec.md §2.3: "measurement log resets with the simulation").
import type { Measurement } from '../../sim/types';

export interface MeasurementMirror {
  all(): readonly Measurement[];
  add(measurement: Measurement): void;
  annotate(id: number, note: string): void;
  clear(): void;
  subscribe(cb: () => void): () => void;
}

export function createMeasurementMirror(): MeasurementMirror {
  let entries: Measurement[] = [];
  const subscribers = new Set<() => void>();

  function notify(): void {
    for (const cb of [...subscribers]) cb();
  }

  return {
    all: () => entries,
    add(measurement) {
      entries = [...entries, measurement];
      notify();
    },
    annotate(id, note) {
      entries = entries.map((m) => (m.id === id ? { ...m, note } : m));
      notify();
    },
    clear() {
      entries = [];
      notify();
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };
}
