import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  discoverServerNoAuth,
  getDefaultServerUrl,
} from '@/lib/validateServerAuth';

function serverInfo(authentication: boolean, status = 200): Response {
  return new Response(
    JSON.stringify({ features: { authentication } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getDefaultServerUrl', () => {
  test('uses the current HTTP origin for an embedded client', () => {
    expect(getDefaultServerUrl({
      origin: 'http://example.test:8742',
      protocol: 'http:',
    })).toBe('http://example.test:8742');
  });

  test('preserves HTTPS for an embedded client', () => {
    expect(getDefaultServerUrl({
      origin: 'https://prokop.example',
      protocol: 'https:',
    })).toBe('https://prokop.example');
  });

  test('falls back to localhost for file-based clients', () => {
    expect(getDefaultServerUrl({
      origin: 'null',
      protocol: 'file:',
    })).toBe('localhost:8742');
  });
});

describe('discoverServerNoAuth', () => {
  test('uses the current origin before localhost', async () => {
    const fetchMock = vi.fn().mockResolvedValue(serverInfo(false));
    vi.stubGlobal('fetch', fetchMock);

    const result = await discoverServerNoAuth({
      currentLocation: {
        origin: 'https://prokop.example',
        protocol: 'https:',
      },
    });

    expect(result).toEqual({
      available: true,
      url: 'https://prokop.example',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://prokop.example/api/info');
  });

  test('falls back to localhost when the current origin is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serverInfo(false, 503))
      .mockResolvedValueOnce(serverInfo(false));
    vi.stubGlobal('fetch', fetchMock);

    const result = await discoverServerNoAuth({
      currentLocation: {
        origin: 'http://client.example:5173',
        protocol: 'http:',
      },
    });

    expect(result).toEqual({ available: true, url: 'localhost:8742' });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'http://client.example:5173/api/info',
      'http://localhost:8742/api/info',
    ]);
  });

  test('does not save an authentication-required candidate', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(serverInfo(true))
      .mockResolvedValueOnce(serverInfo(false, 503));
    vi.stubGlobal('fetch', fetchMock);

    const result = await discoverServerNoAuth({
      currentLocation: {
        origin: 'https://secure.example',
        protocol: 'https:',
      },
    });

    expect(result).toEqual({
      available: false,
      url: 'https://secure.example',
      authRequired: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('deduplicates a localhost current origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(serverInfo(false));
    vi.stubGlobal('fetch', fetchMock);

    await discoverServerNoAuth({
      currentLocation: {
        origin: 'http://localhost:8742',
        protocol: 'http:',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
