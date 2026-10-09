import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SavedServer, Session } from '@prokopai/sdk';

type Listener = (...args: unknown[]) => void;

const sdk = vi.hoisted(() => {
  class AuthError extends Error {}
  const instances: FakeClient[] = [];
  class FakeClient {
    listeners = new Map<string, Set<Listener>>();
    connected = false;
    sessions = { resume: vi.fn() };
    dispose = vi.fn(async () => {});
    config: unknown;
    static nextConnect: (() => Promise<void>) | null = null;
    constructor(config: unknown) {
      this.config = config;
      instances.push(this);
    }
    on(event: string, listener: Listener) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(listener);
    }
    off(event: string, listener: Listener) {
      this.listeners.get(event)?.delete(listener);
    }
    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
    async connect() {
      const custom = FakeClient.nextConnect;
      FakeClient.nextConnect = null;
      if (custom) return custom();
      this.connected = true;
      this.emit('connected');
    }
  }
  return { AuthError, FakeClient, instances };
});

vi.mock('@prokopai/sdk', async (importOriginal) => ({
  ...await importOriginal<typeof import('@prokopai/sdk')>(),
  ProkopaiClient: sdk.FakeClient,
  AuthError: sdk.AuthError,
}));
vi.mock('@/config/client-identity', () => ({ resolveClientDescriptor: async () => ({ clientId: 'c', clientType: 'web' }) }));
vi.mock('@/lib/hostRoutes', () => ({ resolveHostUrl: async (server: SavedServer) => `https://${server.id}.ts.net` }));

import {
  acquireHostClient,
  foreignClientFor,
  releaseHostClient,
  setForeignHandlerContextProvider,
  useHostClientStore,
} from '@/lib/hostClientPool';
import { useForeignSessionsStore } from '@/stores/foreignSessionsStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import type { SessionHandlersContext } from '@/handlers/serverMessage';

const laptop: SavedServer = { id: 'laptop', name: 'Laptop', url: 'laptop:8742', token: 'pkd_l', createdAt: '' };
const session = (id: string, title = id) => ({ id, workspaceId: 'w-remote', title, parentId: null } as Session);

function baseContext(): SessionHandlersContext {
  return {
    setSessions: vi.fn(),
    setCurrentSession: vi.fn(),
    setModelForSession: vi.fn(),
    setVariantForSession: vi.fn(),
  } as unknown as SessionHandlersContext;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  sdk.instances.length = 0;
  localStorage.clear();
  useForeignSessionsStore.setState({ byId: {} });
  useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
  useSessionStore.setState(useSessionStore.getInitialState());
  useHostClientStore.setState({ clients: {}, urls: {}, status: {} });
});

afterEach(() => {
  releaseHostClient('laptop');
  releaseHostClient('laptop');
});

describe('host client pool', () => {
  test('connects once per machine, resumes its open sessions, and closes after the last release', async () => {
    useForeignSessionsStore.getState().add('laptop', session('remote-1'));
    useForeignSessionsStore.getState().add('laptop', session('remote-2'));
    useSessionBoardStore.setState({ openSessionIds: ['remote-1'], focusedSessionId: 'remote-1' });

    acquireHostClient(laptop);
    acquireHostClient(laptop);
    await flush();

    expect(sdk.instances).toHaveLength(1);
    const client = sdk.instances[0]!;
    expect(client.config).toMatchObject({ url: 'https://laptop.ts.net', token: 'pkd_l' });
    expect(client.sessions.resume).toHaveBeenCalledWith('remote-1');
    expect(client.sessions.resume).not.toHaveBeenCalledWith('remote-2');
    expect(useHostClientStore.getState().status.laptop).toBe('connected');
    expect(foreignClientFor('remote-1')).toBe(client);
    expect(foreignClientFor('local-session')).toBeNull();

    releaseHostClient('laptop');
    expect(client.dispose).not.toHaveBeenCalled();
    releaseHostClient('laptop');
    expect(client.dispose).toHaveBeenCalled();
    expect(useHostClientStore.getState().clients.laptop).toBeUndefined();
  });

  test('updates only tracked foreign sessions and never the active machine list', async () => {
    const base = baseContext();
    setForeignHandlerContextProvider(() => base);
    useForeignSessionsStore.getState().add('laptop', session('remote-1', 'Old'));
    acquireHostClient(laptop);
    await flush();
    const client = sdk.instances[0]!;

    client.emit('session.updated', session('remote-1', 'Renamed'));
    client.emit('session.updated', session('someone-elses', 'Untracked'));

    expect(useForeignSessionsStore.getState().byId['remote-1']?.session.title).toBe('Renamed');
    expect(useForeignSessionsStore.getState().byId['someone-elses']).toBeUndefined();
    expect(base.setSessions).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessions).toEqual([]);
    setForeignHandlerContextProvider(() => null);
  });

  test('a session deleted on its machine leaves the board', async () => {
    useForeignSessionsStore.getState().add('laptop', session('remote-1'));
    useSessionBoardStore.setState({ openSessionIds: ['remote-1'], focusedSessionId: 'remote-1' });
    acquireHostClient(laptop);
    await flush();

    sdk.instances[0]!.emit('session.deleted', 'remote-1');

    expect(useSessionBoardStore.getState().openSessionIds).toEqual([]);
    expect(useForeignSessionsStore.getState().byId['remote-1']).toBeUndefined();
  });

  test('an unpaired machine stops without retrying', async () => {
    sdk.FakeClient.nextConnect = async () => { throw new sdk.AuthError('not paired'); };
    acquireHostClient(laptop);
    await flush();
    await flush();
    expect(useHostClientStore.getState().status.laptop).toBe('unpaired');
    expect(sdk.instances).toHaveLength(1);
  });
});
