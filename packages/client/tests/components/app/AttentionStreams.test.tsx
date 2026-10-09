import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AttentionSnapshot, SavedServer } from '@prokopai/sdk';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const routerState = vi.hoisted(() => ({ pathname: '/server/studio/workspace', navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ state: { location: { pathname: routerState.pathname } }, navigate: routerState.navigate }),
}));

const servers: SavedServer[] = [
  { id: 'studio', name: 'Studio', url: 'studio:8742', createdAt: '' },
  { id: 'laptop', name: 'Laptop', url: 'laptop:8742', token: 'pkd_l', createdAt: '' },
];
vi.mock('@/contexts/ServerContext', () => ({ useServerContext: () => ({ servers }) }));

type Emit = (previous: AttentionSnapshot | null, next: AttentionSnapshot) => void;
const emitters = vi.hoisted(() => new Map<string, Emit>());
vi.mock('@/lib/attention', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/attention')>(),
  startAttentionStream: (server: SavedServer, onSnapshot: Emit) => {
    emitters.set(server.id, onSnapshot);
    return () => emitters.delete(server.id);
  },
}));

const openHere = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/openSessionHere', () => ({ openSessionHere: openHere }));

import { AttentionStreams } from '@/components/app/AttentionStreams';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';

const ask = { id: 'a1', kind: 'approval' as const, sessionId: 's1', sessionTitle: 'Deploy', workspaceId: 'w1', workspaceName: 'site', toolName: 'bash', createdAt: 1 };
const running = { sessionId: 's2', sessionTitle: 'Build', workspaceId: 'w1', workspaceName: 'site', runningAt: 'x' };

beforeEach(() => {
  routerState.pathname = '/server/studio/workspace';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('AttentionStreams', () => {
  test('prompts for approvals on another machine and opens the session beside your work', async () => {
    render(<AttentionStreams />);
    act(() => emitters.get('laptop')!(null, { revision: 1, asks: [ask], running: [] }));

    expect(toastMock).toHaveBeenCalledWith('Approval needed on Laptop', expect.objectContaining({
      id: 'attention-laptop-a1',
      description: 'Deploy · site',
      duration: Infinity,
    }));
    toastMock.mock.calls[0]![1].action.onClick();
    await vi.waitFor(() => expect(openHere).toHaveBeenCalledWith(expect.objectContaining({
      server: expect.objectContaining({ id: 'laptop' }),
      sessionId: 's1',
      activeServerId: 'studio',
      viewPath: '/workspace',
    })));
    expect(routerState.navigate).not.toHaveBeenCalled();
  });

  test('switches machines when opening beside your work fails', async () => {
    openHere.mockRejectedValueOnce(new Error('unreachable'));
    render(<AttentionStreams />);
    act(() => emitters.get('laptop')!(null, { revision: 1, asks: [ask], running: [] }));
    toastMock.mock.calls[0]![1].action.onClick();

    await vi.waitFor(() => expect(routerState.navigate).toHaveBeenCalledWith({
      to: '/server/$serverId/workspace/session/$sessionId',
      params: { serverId: 'laptop', sessionId: 's1' },
    }));
    expect(localStorage.getItem('activeWorkspaceId')).toBe('w1');
  });

  test('reports finished runs and clears prompts that were answered elsewhere', () => {
    render(<AttentionStreams />);
    const emit = emitters.get('laptop')!;
    const before = { revision: 1, asks: [ask], running: [running] };
    act(() => emit(before, { revision: 2, asks: [], running: [] }));

    expect(toastMock.dismiss).toHaveBeenCalledWith('attention-laptop-a1');
    expect(toastMock).toHaveBeenCalledWith('Finished on Laptop', expect.objectContaining({ description: 'Build · site' }));
  });

  test('stays quiet for sessions already open as tabs, which show their own approvals', () => {
    useSessionBoardStore.setState({ openSessionIds: ['s1'], focusedSessionId: 's1' });
    render(<AttentionStreams />);
    act(() => emitters.get('laptop')!(null, { revision: 1, asks: [ask], running: [] }));
    expect(toastMock).not.toHaveBeenCalled();
    useSessionBoardStore.setState({ openSessionIds: [], focusedSessionId: null });
  });

  test('stays quiet for the machine on screen, which shows its own asks', () => {
    render(<AttentionStreams />);
    act(() => emitters.get('studio')!(null, { revision: 1, asks: [ask], running: [] }));
    expect(toastMock).not.toHaveBeenCalled();
  });
});
