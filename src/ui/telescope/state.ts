// Pure state-management logic for the Telescope screen sidebar (identified
// objects list, mode/FOV, angular-separation tool selection). Kept separate
// from mountTelescopeScreen.ts (DOM wiring) so it's directly unit-testable.
import type { IdentifiedObject } from '../../render/types';

export interface TelescopeUiState {
  readonly mode: 'outside' | 'telescope';
  readonly fovDeg: number;
  readonly identified: readonly IdentifiedObject[];
  readonly sepA: string | null; // identified-object id
  readonly sepB: string | null;
  readonly lastSepRadians: number | null;
  readonly lastSepLogged: boolean;
}

export function createInitialState(): TelescopeUiState {
  return {
    mode: 'outside',
    fovDeg: 60,
    identified: [],
    sepA: null,
    sepB: null,
    lastSepRadians: null,
    lastSepLogged: false,
  };
}

// Add a newly identified object to the list, deduplicating by id (re-clicking
// an already-identified object is a no-op, not a duplicate entry).
export function addIdentified(
  state: TelescopeUiState,
  obj: IdentifiedObject,
): TelescopeUiState {
  if (state.identified.some((o) => o.id === obj.id)) return state;
  return { ...state, identified: [...state.identified, obj] };
}

// Remove one identified object by id. Clears any separation-tool selection
// that pointed at it (and the stale measurement that selection produced),
// since a removed object can no longer be measured against.
export function removeIdentified(state: TelescopeUiState, id: string): TelescopeUiState {
  const identified = state.identified.filter((o) => o.id !== id);
  if (identified.length === state.identified.length) return state;
  const sepA = state.sepA === id ? null : state.sepA;
  const sepB = state.sepB === id ? null : state.sepB;
  if (sepA === state.sepA && sepB === state.sepB) return { ...state, identified };
  return { ...state, identified, sepA, sepB, lastSepRadians: null, lastSepLogged: false };
}

export function setSepSelection(
  state: TelescopeUiState,
  which: 'A' | 'B',
  id: string | null,
): TelescopeUiState {
  return which === 'A'
    ? { ...state, sepA: id, lastSepRadians: null, lastSepLogged: false }
    : { ...state, sepB: id, lastSepRadians: null, lastSepLogged: false };
}

// Angular-separation tool is enabled only once two distinct identified
// objects are selected.
export function canMeasureSeparation(state: TelescopeUiState): boolean {
  return state.sepA !== null && state.sepB !== null && state.sepA !== state.sepB;
}

export function withSeparationResult(state: TelescopeUiState, radians: number): TelescopeUiState {
  return { ...state, lastSepRadians: radians, lastSepLogged: false };
}

export function withSeparationLogged(state: TelescopeUiState): TelescopeUiState {
  return { ...state, lastSepLogged: true };
}

export function withMode(state: TelescopeUiState, mode: 'outside' | 'telescope'): TelescopeUiState {
  return { ...state, mode };
}

export function withFov(state: TelescopeUiState, fovDeg: number): TelescopeUiState {
  return { ...state, fovDeg };
}
