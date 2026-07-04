import { describe, expect, it } from 'vitest';
import { loadEphemeris, loadStarCatalog, type FetchImpl } from '../../src/net/loadEphemeris';

function stubFetch(body: unknown): FetchImpl {
  return (async () =>
    ({
      json: async () => body,
    }) as Response) as FetchImpl;
}

describe('loadEphemeris', () => {
  it('fetches the given URL and parses the JSON body', async () => {
    const payload = {
      frame: 'heliocentric-ecliptic-J2000',
      units: { position: 'm', velocity: 'm/s', time: 'unix-seconds' },
      bodies: {
        sun: { t0: 0, dt: 86400, samples: [[0, 0, 0, 0, 0, 0]] },
      },
    };
    const result = await loadEphemeris(stubFetch(payload), '/data/ephemeris.json');
    expect(result).toEqual(payload);
  });

  it('defaults to /data/ephemeris.json when no URL is given', async () => {
    let requestedUrl: string | undefined;
    const fetchImpl: FetchImpl = (async (url: string) => {
      requestedUrl = url;
      return { json: async () => ({ frame: '', units: {}, bodies: {} }) } as Response;
    }) as FetchImpl;

    await loadEphemeris(fetchImpl);
    expect(requestedUrl).toBe('/data/ephemeris.json');
  });
});

describe('loadStarCatalog', () => {
  it('fetches and parses the star catalog array', async () => {
    const payload = [{ ra: 1.2, dec: -0.3, mag: -1.44, name: 'Sirius' }];
    const result = await loadStarCatalog(stubFetch(payload), '/data/starCatalog.json');
    expect(result).toEqual(payload);
  });

  it('defaults to /data/starCatalog.json when no URL is given', async () => {
    let requestedUrl: string | undefined;
    const fetchImpl: FetchImpl = (async (url: string) => {
      requestedUrl = url;
      return { json: async () => [] } as unknown as Response;
    }) as FetchImpl;

    await loadStarCatalog(fetchImpl);
    expect(requestedUrl).toBe('/data/starCatalog.json');
  });
});
