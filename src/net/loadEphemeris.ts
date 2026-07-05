// Injected-fetch seam (mirrors the sibling project's pattern): side-effectful
// access to local JSON ephemeris/star-catalog data goes through here, never
// imported directly, so callers stay testable with a stub fetchImpl.
import type { EphemerisData } from '../core/ephemerisTypes';

export type FetchImpl = typeof fetch;

export async function loadEphemeris(fetchImpl: FetchImpl, url = '/data/ephemeris.json'): Promise<EphemerisData> {
  const response = await fetchImpl(url);
  return (await response.json()) as EphemerisData;
}

export interface StarCatalogEntry {
  readonly ra: number; // radians, J2000
  readonly dec: number; // radians, J2000
  readonly mag: number;
  readonly name: string | null;
}

export type RawStarCatalog = readonly StarCatalogEntry[];

export async function loadStarCatalog(fetchImpl: FetchImpl, url = '/data/starCatalog.json'): Promise<RawStarCatalog> {
  const response = await fetchImpl(url);
  return (await response.json()) as RawStarCatalog;
}
