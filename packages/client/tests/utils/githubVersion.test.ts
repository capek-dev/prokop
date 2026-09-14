import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearVersionCache, fetchLatestServerVersion } from '@/utils/githubVersion';

const release = { tag_name: 'server/v1.15.0', draft: false, prerelease: false, published_at: '2026-01-01' };

beforeEach(() => clearVersionCache());
afterEach(() => vi.unstubAllGlobals());

describe('server release availability', () => {
  it('confirms publication and caches a stable release', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('1.15.0\n'))
      .mockResolvedValueOnce(Response.json(release));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchLatestServerVersion()).toBe('1.15.0');
    expect(await fetchLatestServerVersion()).toBe('1.15.0');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain('server%2Fv1.15.0');
  });

  it.each([null, {}, { ...release, draft: true }, { ...release, prerelease: true }, { ...release, tag_name: 'client/v1.15.0' }])('ignores invalid or unpublished release %j', async (metadata) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('1.15.0'))
      .mockResolvedValueOnce(Response.json(metadata)));
    expect(await fetchLatestServerVersion()).toBeNull();
  });

  it('stays quiet when the release does not exist yet', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('1.15.0'))
      .mockResolvedValueOnce(new Response('', { status: 404 })));
    expect(await fetchLatestServerVersion()).toBeNull();
  });

  it('stays quiet on network failure or malformed VERSION', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchLatestServerVersion()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>error</html>')));
    expect(await fetchLatestServerVersion()).toBeNull();
  });
});
