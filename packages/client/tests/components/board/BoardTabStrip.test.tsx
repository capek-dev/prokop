import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { BoardTabStrip } from '@/components/board/BoardTabStrip';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useAskStore } from '@/stores/askStore';
import type { Session } from '@prokopai/sdk';

const focusMock = vi.fn();
vi.mock('@/hooks/useBoardFocus', () => ({
  useBoardFocus: () => focusMock,
}));

function makeSession(id: string, title: string): Session {
  return {
    id,
    title,
    workspaceId: 'ws-1',
  } as unknown as Session;
}

function renderStrip(openIds: string[], focused: string, boardAvailable: boolean) {
  return render(
    <DndContext>
      <SortableContext items={openIds}>
        <BoardTabStrip
          openSessionIds={openIds}
          focusedSessionId={focused}
          boardAvailable={boardAvailable}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe('BoardTabStrip', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [makeSession('s1', 'First'), makeSession('s2', 'Second')],
    } as never);
    useSessionBoardStore.setState({
      openSessionIds: ['s1', 's2'],
      focusedSessionId: 's1',
      layoutMode: 'board',
    });
    useAskStore.setState({ pendingRequests: [], timedOutRequestIds: new Set() });
    localStorage.removeItem('prokopai_board_layout_preference');
    focusMock.mockClear();
  });

  afterEach(cleanup);

  test('renders one tab per open session with workspace-qualified labels', () => {
    renderStrip(['s1', 's2'], 's1', true);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(screen.getByTitle('First')).toBeInTheDocument();
    expect(screen.getByTitle('Second')).toBeInTheDocument();
  });

  test('focuses a session when its tab label is clicked', () => {
    renderStrip(['s1', 's2'], 's1', true);

    fireEvent.click(screen.getByTitle('Second'));
    expect(focusMock).toHaveBeenCalledWith('s2');
  });

  test('removes a session from the board via the tab close button', () => {
    renderStrip(['s1', 's2'], 's1', true);

    fireEvent.click(screen.getByRole('button', { name: 'Remove First from board' }));
    expect(useSessionBoardStore.getState().openSessionIds).toEqual(['s2']);
  });

  test('shows a pending-ask count badge for the session with a request', () => {
    useAskStore.setState({
      pendingRequests: [
        {
          toolCallId: 'tc1',
          sessionId: 's2',
          toolName: 'shell',
          ask: { type: 'permission' },
        } as never,
      ],
    });

    renderStrip(['s1', 's2'], 's1', true);

    expect(screen.getByTitle('1 pending permission request')).toBeInTheDocument();
    expect(screen.getByTitle('First')).toBeInTheDocument();
  });

  test('switches to tabs layout and persists the preference', () => {
    renderStrip(['s1', 's2'], 's1', true);

    fireEvent.click(screen.getByRole('button', { name: 'Tabs' }));

    expect(useSessionBoardStore.getState().layoutMode).toBe('tabs');
    expect(localStorage.getItem('prokopai_board_layout_preference')).toBe('tabs');
  });

  test('board toggle is disabled when the container cannot fit two columns', () => {
    renderStrip(['s1', 's2'], 's1', false);

    expect(screen.getByRole('button', { name: 'Board' })).toBeDisabled();
  });
});
