import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SavedServer } from '@prokopai/sdk';
import { getQuickConnections, getSavedServers, recordServerIdentity } from '@/config/servers';
import { effectiveServerUrl, resolveHostUrl, routeCandidates, useHostRouteStore } from '@/lib/hostRoutes';

const server: SavedServer = {
  id: 's1',
  name: 'Studio',
  url: '192.168.1.5:8742',
  createdAt: '2026-10-08T00:00:00Z',
  installationId: 'install-a',
  routes: ['https://studio.ts.net'],
};

function answer(map: Record<string, string | null>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.entries(map).find(([prefix]) => url.startsWith(prefix));
    if (!match) throw new TypeError('Failed to fetch');
    return Response.json({ installationId: match[1] });
  }));
}

beforeEach(() => {
  localStorage.clear();
  useHostRouteStore.setState({ urls: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('host routes', () => {
  test('candidates prefer the last good route, then the saved URL, then learned ones', () => {
    expect(routeCandidates(server)).toEqual(['192.168.1.5:8742', 'https://studio.ts.net']);
    useHostRouteStore.getState().setUrl('s1', 'https://studio.ts.net');
    expect(routeCandidates(server)).toEqual(['https://studio.ts.net', '192.168.1.5:8742']);
  });

  test('uses the LAN address at home', async () => {
    answer({ 'http://192.168.1.5:8742': 'install-a', 'https://studio.ts.net': 'install-a' });
    expect(await resolveHostUrl(server)).toBe('192.168.1.5:8742');
  });

  test('fails over to Tailscale away from home and remembers it', async () => {
    answer({ 'https://studio.ts.net': 'install-a' });
    expect(await resolveHostUrl(server)).toBe('https://studio.ts.net');
    expect(effectiveServerUrl(server)).toBe('https://studio.ts.net');
  });

  test('never uses an address that answers as a different machine', async () => {
    answer({ 'http://192.168.1.5:8742': 'install-other', 'https://studio.ts.net': 'install-a' });
    expect(await resolveHostUrl(server)).toBe('https://studio.ts.net');
  });

  test('falls back to the saved URL when nothing answers', async () => {
    answer({});
    expect(await resolveHostUrl(server)).toBe('192.168.1.5:8742');
  });
});

describe('recordServerIdentity', () => {
  test('stores identity and learned routes without repeating the primary URL', () => {
    localStorage.setItem('prokopai_servers', JSON.stringify([{ ...server, installationId: undefined, routes: undefined }]));
    recordServerIdentity('s1', { installationId: 'install-a', routes: ['http://192.168.1.5:8742', 'https://studio.ts.net/'] });
    expect(getSavedServers()[0]).toMatchObject({ installationId: 'install-a', routes: ['https://studio.ts.net'] });
  });

  test('merges another entry for the same machine and moves its quick connections', () => {
    localStorage.setItem('prokopai_servers', JSON.stringify([
      { id: 's1', name: 'Studio', url: '192.168.1.5:8742', createdAt: 'x' },
      { id: 's2', name: 'Studio (Tailscale)', url: 'https://studio.ts.net', token: 'pkd_t', installationId: 'install-a', createdAt: 'x' },
      { id: 's3', name: 'Laptop', url: '10.0.0.9:8742', installationId: 'install-b', createdAt: 'x' },
    ]));
    localStorage.setItem('prokopai_quick_connections', JSON.stringify([
      { id: 'q1', serverId: 's2', serverName: 'Studio (Tailscale)', workspaceId: 'w1' },
    ]));
    localStorage.setItem('prokopai_last_server_id', 's2');
    const changed = vi.fn();
    window.addEventListener('prokopai:servers-changed', changed);

    expect(recordServerIdentity('s1', { installationId: 'install-a', routes: [] })).toEqual(['s2']);

    expect(getSavedServers().map((saved) => saved.id)).toEqual(['s1', 's3']);
    expect(getSavedServers()[0]).toMatchObject({ token: 'pkd_t', routes: ['https://studio.ts.net'] });
    expect(getQuickConnections()).toEqual([{ id: 'q1', serverId: 's1', serverName: 'Studio', workspaceId: 'w1' }]);
    expect(localStorage.getItem('prokopai_last_server_id')).toBe('s1');
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener('prokopai:servers-changed', changed);
  });

  test('does nothing when nothing changed', () => {
    localStorage.setItem('prokopai_servers', JSON.stringify([server]));
    const changed = vi.fn();
    window.addEventListener('prokopai:servers-changed', changed);
    expect(recordServerIdentity('s1', { installationId: 'install-a', routes: ['https://studio.ts.net'] })).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    window.removeEventListener('prokopai:servers-changed', changed);
  });
});

describe('fast switching', () => {
  test('an address that worked in this session is reused without probing', async () => {
    useHostRouteStore.getState().setUrl('s1', 'https://studio.ts.net');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolveHostUrl(server)).toBe('https://studio.ts.net');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('reprobe re-checks addresses after a failure', async () => {
    useHostRouteStore.getState().setUrl('s1', '192.168.1.5:8742');
    answer({ 'https://studio.ts.net': 'install-a' });
    expect(await resolveHostUrl(server, undefined, { reprobe: true })).toBe('https://studio.ts.net');
  });

  test('a preferred address answering shortly after a fallback still wins', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('http://192.168.1.5:8742')) await new Promise((resolve) => setTimeout(resolve, 100));
      return Response.json({ installationId: 'install-a' });
    }));
    expect(await resolveHostUrl(server)).toBe('192.168.1.5:8742');
  });

  test('an unreachable preferred address does not hold up the switch', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('http://192.168.1.5:8742')) {
        // Hangs like a LAN address away from home, until the probe timeout aborts it.
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      return Promise.resolve(Response.json({ installationId: 'install-a' }));
    }));
    const started = Date.now();
    expect(await resolveHostUrl(server)).toBe('https://studio.ts.net');
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
