import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AttentionSnapshot, ProkopaiClient, SavedServer } from '@prokopai/sdk';

const pool = vi.hoisted(() => ({ client: null as ProkopaiClient | null }));
vi.mock('@/lib/hostClientPool', () => ({ foreignClientFor: () => pool.client }));
vi.mock('@/lib/hostRoutes', () => ({ resolveHostUrl: async () => 'https://laptop.ts.net' }));

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }));

const servers: SavedServer[] = [
  { id: 'studio', name: 'Studio', url: 'studio:8742', createdAt: '' },
  { id: 'laptop', name: 'Laptop', url: 'laptop:8742', token: 'pkd_l', createdAt: '' },
];
vi.mock('@/contexts/ServerContext', () => ({ useServerContext: () => ({ servers }) }));

import { openSessionHere } from '@/lib/openSessionHere';
import { OtherMachinesOverview, otherMachineItems } from '@/components/layout/OtherMachinesOverview';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useAttentionStore } from '@/lib/attention';
import { useForeignSessionsStore } from '@/stores/foreignSessionsStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';

const remoteSession = { id: 'remote-1', workspaceId: 'w-remote', title: 'Deploy', parentId: null };
const snapshot: AttentionSnapshot = {
  revision: 1,
  asks: [
    { id: 'a1', kind: 'approval', sessionId: 'remote-1', sessionTitle: 'Deploy', workspaceId: 'w', workspaceName: 'site', toolName: 'bash', createdAt: 1 },
    { id: 'a2', kind: 'question', sessionId: 'remote-1', sessionTitle: 'Deploy', workspaceId: 'w', workspaceName: 'site', toolName: 'ask', createdAt: 2 },
  ],
  running: [
    { sessionId: 'remote-1', sessionTitle: 'Deploy', workspaceId: 'w', workspaceName: 'site', runningAt: 'x' },
    { sessionId: 'remote-2', sessionTitle: null, workspaceId: 'w', workspaceName: 'site', runningAt: 'x' },
  ],
};

beforeEach(() => {
  localStorage.clear();
  useForeignSessionsStore.setState({ byId: {} });
  useSessionBoardStore.setState({ openSessionIds: ['local-1'], focusedSessionId: 'local-1' });
  useAttentionStore.setState({ hosts: {} });
  pool.client = null;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('https://laptop.ts.net/api/sessions/remote-1');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer pkd_l');
    return Response.json({ session: remoteSession });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('openSessionHere', () => {
  test('adds the other machine\'s session as a tab beside local ones and keeps the URL on this machine', async () => {
    const navigate = vi.fn();
    await openSessionHere({ server: servers[1]!, sessionId: 'remote-1', activeServerId: 'studio', viewPath: '/workspace', navigate });

    expect(useForeignSessionsStore.getState().byId['remote-1']).toMatchObject({ serverId: 'laptop', session: { title: 'Deploy' } });
    expect(useSessionBoardStore.getState()).toMatchObject({ openSessionIds: ['local-1', 'remote-1'], focusedSessionId: 'remote-1' });
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      params: { serverId: 'studio', sessionId: 'remote-1' },
      search: { open: 'local-1,remote-1' },
    }));
  });

  test('loads it at once when that machine is already connected for another tab', async () => {
    const resume = vi.fn();
    pool.client = { connected: true, sessions: { resume } } as unknown as ProkopaiClient;
    await openSessionHere({ server: servers[1]!, sessionId: 'remote-1', activeServerId: 'studio', viewPath: '/overview', navigate: vi.fn() });
    expect(resume).toHaveBeenCalledWith('remote-1');
  });
});

describe('Other machines in the Overview', () => {
  test('lists each waiting or running session once, waiting first, without the machine on screen', () => {
    const items = otherMachineItems(servers, 'studio', {
      studio: { connection: 'live', snapshot },
      laptop: { connection: 'live', snapshot },
    });
    expect(items.map((item) => [item.server.id, item.sessionId, item.status, item.title])).toEqual([
      ['laptop', 'remote-1', 'approval', 'Deploy'],
      ['laptop', 'remote-2', 'running', 'Untitled session'],
    ]);
  });

  test('is hidden when nothing happens elsewhere, and opens sessions beside your work', async () => {
    const { container } = render(<SidebarProvider><OtherMachinesOverview activeServerId="studio" /></SidebarProvider>);
    expect(container.textContent).not.toContain('Other machines');

    useAttentionStore.setState({ hosts: { laptop: { connection: 'live', snapshot } } });
    cleanup();
    render(<SidebarProvider><OtherMachinesOverview activeServerId="studio" /></SidebarProvider>);
    expect(screen.getByText('Other machines')).toBeTruthy();
    expect(screen.getByText('Needs approval')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Open beside your work: Deploy'));
    await vi.waitFor(() => expect(useSessionBoardStore.getState().openSessionIds).toContain('remote-1'));
    expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({ to: '/server/$serverId/overview/session/$sessionId' }));
  });
});
