import { describe, expect, test } from 'bun:test';
import { TypedEventEmitter } from '../src/emitter';
import { routeServerMessage } from '../src/types/server-messages';
import type { SdkEventMap } from '../src/types/server-messages';

interface ProviderStatusEvent {
  provider: string;
  connected: boolean;
  authorizationUrl?: string;
  error?: string;
  reauthRequired?: boolean;
}

describe('provider status message routing', () => {
  test('preserves the reauthentication status', () => {
    const emitter = new TypedEventEmitter<SdkEventMap>();
    let received: ProviderStatusEvent | undefined;

    emitter.on('provider.status', (
      provider,
      connected,
      authorizationUrl,
      error,
      reauthRequired,
    ) => {
      received = {
        provider,
        connected,
        authorizationUrl,
        error,
        reauthRequired,
      };
    });

    routeServerMessage(emitter, {
      type: 'provider.status',
      provider: 'gmail',
      connected: false,
      error: 'Reconnect Gmail to continue.',
      reauthRequired: true,
    });

    expect(received).toEqual({
      provider: 'gmail',
      connected: false,
      authorizationUrl: undefined,
      error: 'Reconnect Gmail to continue.',
      reauthRequired: true,
    });
  });
});

describe('worktree message routing', () => {
  test('routes authoritative worktree updates', () => {
    const emitter = new TypedEventEmitter<SdkEventMap>();
    let receivedId: string | undefined;
    emitter.on('worktree.updated', (worktree) => {
      receivedId = worktree.id;
    });

    routeServerMessage(emitter, {
      type: 'worktree.updated',
      worktree: {
        id: 'worktree-1',
        workspaceId: 'workspace-1',
        repositoryId: 'repository-1',
        path: '/repo-worktree',
        branch: 'feature/test',
        head: 'abc123',
        state: 'available',
        dirty: false,
        untrackedCount: 0,
        attachments: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(receivedId).toBe('worktree-1');
  });
});
