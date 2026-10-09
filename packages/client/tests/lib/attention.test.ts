import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AttentionSnapshot, SavedServer } from '@prokopai/sdk';
import { diffAttention, startAttentionStream, useAttentionStore } from '@/lib/attention';
import { useHostRouteStore } from '@/lib/hostRoutes';

const ask = (id: string) => ({
  id, kind: 'approval' as const, sessionId: `s-${id}`, sessionTitle: 'Deploy', workspaceId: 'w1', workspaceName: 'site', toolName: 'bash', createdAt: 1,
});
const running = (sessionId: string) => ({ sessionId, sessionTitle: 'Build', workspaceId: 'w1', workspaceName: 'site', runningAt: '2026-10-09T08:00:00Z' });
const snapshot = (revision: number, asks: string[], runningIds: string[]): AttentionSnapshot => ({
  revision, asks: asks.map(ask), running: runningIds.map(running),
});

describe('diffAttention', () => {
  test('first contact reports every waiting ask and nothing finished', () => {
    expect(diffAttention(null, snapshot(1, ['a'], ['s1']))).toEqual({ newAsks: [ask('a')], resolvedAskIds: [], finished: [] });
  });

  test('reports new and resolved asks and sessions that stopped running', () => {
    expect(diffAttention(snapshot(1, ['a', 'b'], ['s1', 's2']), snapshot(2, ['b', 'c'], ['s2']))).toEqual({
      newAsks: [ask('c')],
      resolvedAskIds: ['a'],
      finished: [running('s1')],
    });
  });
});

describe('startAttentionStream', () => {
  const server: SavedServer = { id: 'laptop', name: 'Laptop', url: 'laptop:8742', token: 'pkd_l', createdAt: '' };

  beforeEach(() => {
    useAttentionStore.setState({ hosts: {} });
    useHostRouteStore.setState({ urls: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function sse(...snapshots: AttentionSnapshot[]) {
    return new Response(snapshots.map((item) => `event: snapshot\ndata: ${JSON.stringify(item)}\n\n`).join(''));
  }

  test('stores snapshots, reconnects after the stream drops, and keeps the last snapshot while offline', async () => {
    const first = snapshot(1, ['a'], []);
    const second = snapshot(2, [], []);
    const responses: Array<() => Promise<Response>> = [
      async () => sse(first),
      async () => { throw new TypeError('Failed to fetch'); },
      async () => sse(second),
    ];
    vi.stubGlobal('fetch', vi.fn(() => (responses.shift() ?? (() => new Promise<Response>(() => {})))()));
    vi.useFakeTimers();
    const seen: Array<[number | null, number]> = [];

    const stop = startAttentionStream(server, (previous, next) => seen.push([previous?.revision ?? null, next.revision]));
    await vi.waitFor(() => expect(seen).toEqual([[null, 1]]));
    await vi.waitFor(() => expect(useAttentionStore.getState().hosts.laptop).toMatchObject({ connection: 'offline', snapshot: first }));

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(seen).toEqual([[null, 1], [1, 2]]));
    stop();
  });

  test('stops retrying when the machine says this device is not paired', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const stop = startAttentionStream(server, () => {});
    await vi.waitFor(() => expect(useAttentionStore.getState().hosts.laptop?.connection).toBe('unpaired'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });
});
