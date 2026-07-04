// Injected-fetch seam (mirrors the sibling project's pattern): side-effectful
// access to local JSON ephemeris/star-catalog data goes through here, never
// imported directly, so callers stay testable with a stub fetchImpl.
export type FetchImpl = typeof fetch;

export interface RawEphemeris {
  readonly bodies: Record<string, unknown>;
}

export async function loadEphemeris(fetchImpl: FetchImpl, url = '/data/ephemeris.json'): Promise<RawEphemeris> {
  const response = await fetchImpl(url);
  return (await response.json()) as RawEphemeris;
}
