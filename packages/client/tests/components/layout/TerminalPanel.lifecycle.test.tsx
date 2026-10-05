import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient } from '@prokopai/sdk';
import { TerminalPanel } from '@/components/layout/TerminalPanel';
import { useConnectionStore } from '@/stores/connectionStore';

const mocks = vi.hoisted(() => ({
  instances: [] as Array<{ dispose: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }>,
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/queries', () => ({ useWorktreesQuery: () => ({ data: [] }) }));
vi.mock('@/hooks/useVisualViewport', () => ({ useVisualViewport: () => ({ height: 900 }) }));
vi.mock('@/hooks/useTerminal', async (original) => {
  const actual = await original<typeof import('@/hooks/useTerminal')>();
  return {
    ...actual,
    createTerminalInstance: () => {
      const element = document.createElement('div');
      element.dataset.testid = 'terminal-output';
      const input = document.createElement('textarea');
      input.setAttribute('aria-label', 'Terminal input');
      element.appendChild(input);
      const terminal = {
        element, open: (container: HTMLElement) => container.appendChild(element),
        dispose: vi.fn(), write: vi.fn(), focus: vi.fn(() => input.focus()), reset: vi.fn(), cols: 80, rows: 24,
        onData: () => ({ dispose: vi.fn() }), onResize: () => ({ dispose: vi.fn() }),
      };
      mocks.instances.push(terminal);
      return { terminal, fitAddon: { fit: vi.fn() } };
    },
  };
});

function createClient() {
  const eventConnections: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
  const connections: Array<{
    dispose: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    output?: (bytes: Uint8Array) => void;
  }> = [];
  const subscribeEvents = vi.fn(async (workspaceId: string) => {
    const conn = { on: vi.fn(), dispose: vi.fn() };
    eventConnections.push(conn);
    return { conn, initialSessions: [{ id: `${workspaceId}-terminal`, title: 'Shell', status: 'running', cwd: '/work', shell: 'zsh' }] };
  });
  const connect = vi.fn(async ({ sessionId }: { sessionId: string }) => {
    const conn: typeof connections[number] & Record<string, unknown> = {
      dispose: vi.fn(), close: vi.fn(), removeAllListeners: vi.fn(), resize: vi.fn(),
      session: { sessionId, title: 'Shell', cwd: '/work', cols: 80, rows: 24, status: 'running' },
      on: (event: string, listener: (bytes: Uint8Array) => void) => {
        if (event === 'output') conn.output = listener;
      },
    };
    connections.push(conn);
    return conn;
  });
  const deleteTerminal = vi.fn(async () => {});
  const client = {
    terminal: { subscribeEvents, connect },
    http: { terminals: { create: vi.fn(), delete: deleteTerminal } },
  } as unknown as ProkopaiClient;
  return { client, subscribeEvents, connect, deleteTerminal, eventConnections, connections };
}

describe('terminal view lifetime', () => {
  beforeEach(() => {
    mocks.instances.length = 0;
    useConnectionStore.setState({ connected: true });
  });
  afterEach(() => {
    cleanup();
    useConnectionStore.setState(useConnectionStore.getInitialState());
  });

  test('terminal mount and delayed autofocus preserve center focus when the workspace changes', async () => {
    const sdk = createClient();
    const props = { workspacePath: '/work', workspaceName: 'Work', additionalPaths: [], sdkClient: sdk.client, onClose: vi.fn(), keepAlive: true };
    const content = (workspaceId: string) => <>
      <section data-view-group="center"><input aria-label="Chat draft" /></section>
      <section data-view-group="bottom"><TerminalPanel {...props} workspaceId={workspaceId} isOpen /></section>
    </>;
    const { rerender } = render(content('w1'));
    screen.getByRole('textbox', { name: 'Chat draft' }).focus();
    await screen.findByTestId('terminal-output');
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toHaveFocus();
    // Switching center sessions can change the terminal's workspace as well.
    rerender(content('w2'));
    await waitFor(() => expect(sdk.connect).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toHaveFocus();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toHaveFocus();
  });

  test('pending terminal autofocus cannot pull focus back after leaving its dock', async () => {
    const sdk = createClient();
    render(<>
      <section data-view-group="center"><input aria-label="Chat draft" /></section>
      <section data-view-group="bottom">
        <button>Terminal tab</button>
        <TerminalPanel workspaceId="w1" workspacePath="/work" workspaceName="Work" additionalPaths={[]} sdkClient={sdk.client} onClose={vi.fn()} isOpen keepAlive />
      </section>
    </>);
    screen.getByRole('button', { name: 'Terminal tab' }).focus();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Terminal input' })).toHaveFocus());
    screen.getByRole('textbox', { name: 'Chat draft' }).focus();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toHaveFocus();
  });

  test('starts on first reveal, receives output while hidden, and disposes only on workspace change or unmount', async () => {
    const sdk = createClient();
    const props = { workspaceId: 'w1', workspacePath: '/work', workspaceName: 'Work', additionalPaths: [], sdkClient: sdk.client, onClose: vi.fn(), keepAlive: true };
    const { rerender, unmount } = render(<TerminalPanel {...props} isOpen={false} />);
    expect(sdk.subscribeEvents).not.toHaveBeenCalled();
    rerender(<TerminalPanel {...props} isOpen />);
    await screen.findByTestId('terminal-output');
    await waitFor(() => expect(sdk.connect).toHaveBeenCalledTimes(1));
    const terminal = mocks.instances[0];
    rerender(<TerminalPanel {...props} isOpen={false} />);
    act(() => sdk.connections[0].output?.(new TextEncoder().encode('background output')));
    expect(terminal.write).toHaveBeenCalledWith('background output');
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(sdk.connections[0].dispose).not.toHaveBeenCalled();
    expect(sdk.eventConnections[0].dispose).not.toHaveBeenCalled();
    rerender(<TerminalPanel {...props} isOpen />);
    expect(sdk.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(sdk.connect).toHaveBeenCalledTimes(1);
    expect(mocks.instances).toHaveLength(1);

    rerender(<TerminalPanel {...props} workspaceId="w2" isOpen={false} />);
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(sdk.eventConnections[0].dispose).toHaveBeenCalledOnce();
    expect(sdk.subscribeEvents).toHaveBeenCalledTimes(1);
    rerender(<TerminalPanel {...props} workspaceId="w2" isOpen />);
    await waitFor(() => expect(sdk.connect).toHaveBeenCalledTimes(2));
    unmount();
    expect(mocks.instances[1].dispose).toHaveBeenCalledOnce();
    expect(sdk.connections[1].dispose).toHaveBeenCalledOnce();
    expect(sdk.deleteTerminal).not.toHaveBeenCalled();
    expect(sdk.connections.every((conn) => conn.close.mock.calls.length === 0)).toBe(true);
  });

  test('explicit terminal close still destroys the server resource', async () => {
    const sdk = createClient();
    render(<TerminalPanel workspaceId="w1" workspacePath="/work" workspaceName="Work" additionalPaths={[]} sdkClient={sdk.client} onClose={vi.fn()} isOpen keepAlive />);
    await waitFor(() => expect(sdk.connect).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal Shell' }));
    expect(sdk.deleteTerminal).toHaveBeenCalledWith('w1', 'w1-terminal');
    expect(sdk.connections[0].close).toHaveBeenCalledOnce();
    expect(mocks.instances[0].dispose).toHaveBeenCalledOnce();
  });
});
