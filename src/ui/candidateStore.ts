// Shared store for saved state-candidate estimates (mvp0_spec.md §7.6):
// position+velocity+epoch guesses the player names and compares. Persisted via
// the injected storage seam; consumed by the Sequence screen's Candidates tab
// (save/compare) and the Data screen's inserted-state analysis (select).
import type { Vector3 } from './../core/vector3';
import type { StorageLike } from './../net/storage';
import { readJson, writeJson } from './../net/storage';

export interface CandidateEstimate {
  readonly id: string;
  readonly name: string;
  readonly epoch: number; // unix seconds the state is valid at
  readonly position: Vector3; // m, heliocentric ecliptic J2000
  readonly velocity: Vector3; // m/s
  readonly createdAt: number; // unix seconds (wall clock), for stable ordering
}

export interface CandidateStore {
  list(): readonly CandidateEstimate[];
  get(id: string): CandidateEstimate | null;
  save(candidate: CandidateEstimate): void; // upsert by id
  remove(id: string): void;
  subscribe(cb: () => void): () => void; // change notifications, returns unsubscribe
}

const STORAGE_KEY = 'blanckstar.candidates.v1';

export function createCandidateStore(storage: StorageLike): CandidateStore {
  let candidates: CandidateEstimate[] = readJson<CandidateEstimate[]>(storage, STORAGE_KEY) ?? [];
  const subscribers = new Set<() => void>();

  const persist = (): void => {
    writeJson(storage, STORAGE_KEY, candidates);
    for (const cb of [...subscribers]) cb();
  };

  return {
    list: () => candidates,
    get: (id) => candidates.find((c) => c.id === id) ?? null,
    save(candidate) {
      const index = candidates.findIndex((c) => c.id === candidate.id);
      candidates = index >= 0
        ? [...candidates.slice(0, index), candidate, ...candidates.slice(index + 1)]
        : [...candidates, candidate];
      persist();
    },
    remove(id) {
      candidates = candidates.filter((c) => c.id !== id);
      persist();
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };
}
