import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PendingAccessRequest, ProkopaiClient } from '@prokopai/sdk';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

import { subscribeToAccessRequests } from '@/lib/accessRequestPrompts';

const request: PendingAccessRequest = {
  id: 'r1', label: 'iPhone (Safari)', deviceKind: 'mobile', matchCode: '4821', createdAt: 0, expiresAt: Date.now() + 60_000,
};

function fakeClient(overview: () => Promise<{ requests: PendingAccessRequest[]; devices: [] }>) {
  const listeners = new Set<() => void>();
  const access = { overview: vi.fn(overview), approve: vi.fn().mockResolvedValue({ success: true }), deny: vi.fn().mockResolvedValue({ success: true }) };
  const client = {
    http: { access },
    on: (_event: string, handler: () => void) => { listeners.add(handler); },
    off: (_event: string, handler: () => void) => { listeners.delete(handler); },
  } as unknown as ProkopaiClient;
  return { client, access, emit: () => listeners.forEach((handler) => handler()) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.clearAllMocks();
});

describe('subscribeToAccessRequests', () => {
  test('prompts once per request and wires Allow and Deny', async () => {
    const { client, access, emit } = fakeClient(async () => ({ requests: [request], devices: [] }));
    const unsubscribe = subscribeToAccessRequests(client);
    await flush();
    emit();
    await flush();

    expect(toastMock).toHaveBeenCalledTimes(1);
    const [title, options] = toastMock.mock.calls[0]!;
    expect(title).toBe('Allow iPhone (Safari) to use Prokop?');
    expect(options.description).toContain('4821');
    options.action.onClick();
    expect(access.approve).toHaveBeenCalledWith('r1');
    options.cancel.onClick();
    expect(access.deny).toHaveBeenCalledWith('r1');
    unsubscribe();
  });

  test('dismisses the prompt once the request is decided elsewhere', async () => {
    let requests = [request];
    const { client, emit } = fakeClient(async () => ({ requests, devices: [] }));
    subscribeToAccessRequests(client);
    await flush();
    requests = [];
    emit();
    await flush();
    expect(toastMock.dismiss).toHaveBeenCalledWith('access-request-r1');
  });

  test('does nothing on paired devices, which cannot list requests', async () => {
    const { client } = fakeClient(async () => { throw new Error('Forbidden'); });
    subscribeToAccessRequests(client);
    await flush();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
