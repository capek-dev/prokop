import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProviderStatus } from '@prokopai/sdk';
import type { SessionHandlersContext } from '@/handlers/serverMessage/types';

const { mockInvalidate } = vi.hoisted(() => ({ mockInvalidate: vi.fn() }));

vi.mock('@/components/providers/QueryProvider', () => ({
  queryClient: { invalidateQueries: mockInvalidate },
}));

import {
  handleProviderConnected,
  handleProviderStatus,
} from '@/handlers/serverMessage/providerHandlers';

function createContext(initial: ProviderStatus[]): {
  ctx: SessionHandlersContext;
  getStatuses: () => ProviderStatus[];
} {
  let statuses = initial;
  const setProviderStatuses = vi.fn((updater: (previous: ProviderStatus[]) => ProviderStatus[]) => {
    statuses = updater(statuses);
  });

  return {
    ctx: { setProviderStatuses } as unknown as SessionHandlersContext,
    getStatuses: () => statuses,
  };
}

describe('providerHandlers', () => {
  beforeEach(() => {
    mockInvalidate.mockClear();
  });

  test('stores a reauthentication-required status', () => {
    const { ctx, getStatuses } = createContext([{
      provider: 'gmail',
      connected: true,
    }]);

    handleProviderStatus({
      type: 'provider.status',
      provider: 'gmail',
      connected: false,
      error: 'Reconnect Gmail to continue.',
      reauthRequired: true,
    }, ctx);

    expect(getStatuses()[0]).toMatchObject({
      provider: 'gmail',
      connected: false,
      error: 'Reconnect Gmail to continue.',
      reauthRequired: true,
    });
  });

  test('clears stale reauthentication state after a successful connection', () => {
    const { ctx, getStatuses } = createContext([{
      provider: 'gmail',
      connected: false,
      error: 'Reconnect Gmail to continue.',
      reauthRequired: true,
    }]);

    handleProviderConnected({
      type: 'provider.connected',
      provider: 'gmail',
      connected: true,
      connectedAt: '2026-01-01T00:00:00.000Z',
    }, ctx);

    expect(getStatuses()[0]).toMatchObject({
      provider: 'gmail',
      connected: true,
      connectedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(getStatuses()[0].error).toBeUndefined();
    expect(getStatuses()[0].reauthRequired).toBeUndefined();
  });
});
