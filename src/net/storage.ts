// Injected localStorage seam (mvp0_spec.md §2.3, §7.6: scripts/notes/candidates
// persist across retries). Injected so ui/sim code stays testable without a
// real browser storage object.
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readJson<T>(storage: StorageLike, key: string): T | null {
  const raw = storage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as T);
}

export function writeJson<T>(storage: StorageLike, key: string, value: T): void {
  storage.setItem(key, JSON.stringify(value));
}
