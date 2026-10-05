import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProkopaiClient } from '@prokopai/sdk';
import { retainFileTree, retainGitStatus } from '@/lib/rootFeedSubscriptions';

function fakeClient() {
  const listeners = new Map<string, Set<() => void>>();
  const client = {
    connected: true,
    on: vi.fn((event: string, fn: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: () => void) => listeners.get(event)?.delete(fn)),
    git: { subscribeStatus: vi.fn(), unsubscribeStatus: vi.fn(), refreshStatus: vi.fn() },
    files: { subscribeTree: vi.fn(), unsubscribeTree: vi.fn(), refreshTree: vi.fn() },
    emit(event: string) { for (const fn of listeners.get(event) ?? []) fn(); },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  };
  return client;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('views of the same root share one server subscription', () => {
  const client = fakeClient();
  const sdk = client as unknown as ProkopaiClient;
  const releaseA = retainGitStatus(sdk, 'ws', '/repo');
  const releaseB = retainGitStatus(sdk, 'ws', '/repo');
  expect(client.git.subscribeStatus).toHaveBeenCalledTimes(1);

  releaseA();
  releaseA();
  expect(client.git.unsubscribeStatus).not.toHaveBeenCalled();
  releaseB();
  expect(client.git.unsubscribeStatus).toHaveBeenCalledWith('ws', '/repo');
  expect(client.listenerCount('connected')).toBe(0);
});

test('subscriptions are re-sent after a reconnect', () => {
  const client = fakeClient();
  const release = retainGitStatus(client as unknown as ProkopaiClient, 'ws', undefined);
  client.git.subscribeStatus.mockClear();

  client.emit('connected');
  expect(client.git.subscribeStatus).toHaveBeenCalledWith('ws', undefined);
  release();
});

test('a disconnected client subscribes on the next connect', () => {
  const client = fakeClient();
  client.connected = false;
  const release = retainGitStatus(client as unknown as ProkopaiClient, 'ws', '/repo');
  expect(client.git.subscribeStatus).not.toHaveBeenCalled();

  client.connected = true;
  client.emit('connected');
  expect(client.git.subscribeStatus).toHaveBeenCalledWith('ws', '/repo');
  release();
});

test('window focus asks the server to recompute each watched root once', () => {
  const client = fakeClient();
  const release = retainGitStatus(client as unknown as ProkopaiClient, 'ws', '/repo');

  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('focus'));
  expect(client.git.refreshStatus).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  expect(client.git.refreshStatus).toHaveBeenCalledTimes(1);
  expect(client.git.refreshStatus).toHaveBeenCalledWith('ws', '/repo');
  release();
});

test('file tree subscriptions are counted separately from Git status', () => {
  const client = fakeClient();
  const sdk = client as unknown as ProkopaiClient;
  const releaseStatus = retainGitStatus(sdk, 'ws', '/repo');
  const releaseTree = retainFileTree(sdk, 'ws', '/repo');
  expect(client.files.subscribeTree).toHaveBeenCalledWith('ws', '/repo');
  expect(client.git.subscribeStatus).toHaveBeenCalledTimes(1);

  window.dispatchEvent(new Event('focus'));
  vi.advanceTimersByTime(300);
  expect(client.files.refreshTree).toHaveBeenCalledWith('ws', '/repo');

  releaseTree();
  expect(client.files.unsubscribeTree).toHaveBeenCalledWith('ws', '/repo');
  expect(client.git.unsubscribeStatus).not.toHaveBeenCalled();
  releaseStatus();
});
