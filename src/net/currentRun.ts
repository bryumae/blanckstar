import type { StorageLike } from './storage';
import { readJson, writeJson } from './storage';

const CURRENT_RUN_KEY = 'blanckstar.currentRun.v1';

export interface CurrentRun {
  readonly gameId: string;
  readonly scenarioId: string;
}

export type GameIdFactory = () => string;

export function readCurrentRun(storage: StorageLike): CurrentRun | null {
  const run = readJson<CurrentRun>(storage, CURRENT_RUN_KEY);
  if (!run || typeof run.gameId !== 'string' || typeof run.scenarioId !== 'string') {
    return null;
  }
  return run;
}

export function ensureCurrentRun(
  storage: StorageLike,
  scenarioId: string,
  createGameId: GameIdFactory,
): CurrentRun {
  const existing = readCurrentRun(storage);
  if (existing?.scenarioId === scenarioId) return existing;
  return createCurrentRun(storage, scenarioId, createGameId);
}

export function createCurrentRun(
  storage: StorageLike,
  scenarioId: string,
  createGameId: GameIdFactory,
): CurrentRun {
  const run = { gameId: createGameId(), scenarioId };
  writeJson<CurrentRun>(storage, CURRENT_RUN_KEY, run);
  return run;
}

export function currentRunStorageKey(): string {
  return CURRENT_RUN_KEY;
}
