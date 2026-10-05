import { StrictMode, useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WorkspaceViews } from '@/components/app/WorkspaceViews';
import { useWorkspaceViewVisible } from '@/components/app/WorkspaceViewHost';
import { createDefaultViewLayout, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore } from '@/stores/dockStore';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';

const viewport = vi.hoisted(() => ({ mobile: false, compact: false }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => viewport.mobile, useIsCompact: () => viewport.compact }));

function Draft({ mounted, unmounted }: { mounted: () => void; unmounted: () => void }) {
  const [text, setText] = useState('');
  const visible = useWorkspaceViewVisible();
  useEffect(() => { mounted(); return unmounted; }, [mounted, unmounted]);
  return <div data-testid="draft" data-visible={visible}><input aria-label="Draft" value={text} onChange={(event) => setText(event.target.value)} /></div>;
}

describe('workspace view hosts', () => {
  beforeEach(() => {
    viewport.mobile = false;
    viewport.compact = false;
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout(), mobileTerminalOpen: false });
    useDockStore.setState(useDockStore.getInitialState());
    useChatLayoutStore.setState({ mobileSurface: 'chat' });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout(), mobileTerminalOpen: false });
    useDockStore.setState(useDockStore.getInitialState());
    localStorage.clear();
  });

  test('split menus retain content through resizing, compact/mobile transitions and dragging back', () => {
    useDockStore.getState().setDockOpen('right', true);
    const mounted = vi.fn();
    const unmounted = vi.fn();
    const views = { explorer: <Draft mounted={mounted} unmounted={unmounted} />, changes: <div>Changes contents</div>, branches: <div>Branches contents</div> };
    const { rerender } = render(<WorkspaceViews views={views} />);
    const input = screen.getByRole('textbox');
    const draft = screen.getByTestId('draft');
    fireEvent.change(input, { target: { value: 'keep this draft' } });
    draft.scrollTop = 73;
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Explorer' }));
    expect(screen.queryByRole('menuitem', { name: 'Split right' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split down' }));
    expect(screen.getAllByRole('tablist', { name: 'Right dock views' })).toHaveLength(2);
    expect(screen.getByText('Changes contents').closest('[role="tabpanel"]')).toHaveAttribute('aria-hidden', 'false');
    expect(draft).toHaveAttribute('data-visible', 'true');
    expect(screen.getByRole('textbox')).toBe(input);
    const divider = screen.getByRole('separator', { name: 'Resize right split' });
    expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
    fireEvent.keyDown(divider, { key: 'ArrowDown' });
    expect(divider).toHaveAttribute('aria-valuenow', '55');
    const split = divider.parentElement!;
    vi.spyOn(split, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 612));
    fireEvent.pointerDown(divider, { pointerId: 1, button: 0 });
    fireEvent.pointerMove(document, { pointerId: 1, clientY: 366 });
    fireEvent.pointerUp(document, { pointerId: 1 });
    expect(divider).toHaveAttribute('aria-valuenow', '60');
    viewport.compact = true;
    rerender(<WorkspaceViews views={views} />);
    expect(screen.getByRole('textbox')).toBe(input);
    viewport.mobile = true;
    act(() => useChatLayoutStore.getState().setMobileSurface('files'));
    rerender(<WorkspaceViews views={views} />);
    expect(screen.getByRole('textbox')).toBe(input);
    viewport.mobile = false;
    viewport.compact = false;
    rerender(<WorkspaceViews views={views} />);
    const dataTransfer = new DataTransfer();
    fireEvent.dragStart(screen.getByRole('tab', { name: 'Explorer' }), { dataTransfer });
    fireEvent.drop(screen.getByRole('tab', { name: 'Changes' }).closest('[role="tablist"]')!, { dataTransfer });
    expect(screen.queryByRole('separator', { name: 'Resize right split' })).toBeNull();
    expect(screen.getAllByRole('tablist', { name: 'Right dock views' })).toHaveLength(1);
    expect(input).toHaveValue('keep this draft');
    expect(draft.scrollTop).toBe(73);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  });

  test('preserves state, focus, scroll and instance through moves, hiding and breakpoints', () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    const views = { conversations: <Draft mounted={mounted} unmounted={unmounted} />, explorer: <div>Explorer contents</div> };
    const { rerender, unmount } = render(<StrictMode><WorkspaceViews views={views} /></StrictMode>);
    const input = screen.getByRole('textbox');
    const draft = screen.getByTestId('draft');
    const mountCount = mounted.mock.calls.length;
    const unmountCount = unmounted.mock.calls.length;
    fireEvent.change(input, { target: { value: 'unsent text' } });
    input.focus();
    draft.scrollTop = 90;
    act(() => useWorkspaceViewStore.getState().moveView('conversations', 'right'));
    expect(input.closest('[data-view-group]')).toHaveAttribute('data-view-group', 'right');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('unsent text');
    expect(draft.scrollTop).toBe(90);
    act(() => useWorkspaceViewStore.getState().activateView('explorer'));
    expect(draft).toHaveAttribute('data-visible', 'false');
    expect(input.closest('[data-workspace-view]')).toHaveAttribute('aria-hidden', 'true');
    act(() => useWorkspaceViewStore.getState().activateView('conversations'));
    act(() => useDockStore.getState().setDockOpen('right', false));
    expect(draft).toHaveAttribute('data-visible', 'false');
    act(() => useWorkspaceViewStore.getState().activateView('conversations'));

    viewport.mobile = true;
    rerender(<StrictMode><WorkspaceViews views={views} /></StrictMode>);
    expect(screen.getByRole('textbox')).toBe(input);
    viewport.mobile = false;
    viewport.compact = true;
    rerender(<StrictMode><WorkspaceViews views={views} /></StrictMode>);
    expect(screen.getByRole('textbox')).toBe(input);
    act(() => useDockStore.getState().setDockOpen('right', false));
    act(() => useDockStore.getState().setDockOpen('right', true));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(mounted).toHaveBeenCalledTimes(mountCount);
    expect(unmounted).toHaveBeenCalledTimes(unmountCount);
    unmount();
    expect(unmounted.mock.calls.length).toBe(unmountCount + 1);
    expect(document.querySelector('[data-workspace-view]')).toBeNull();
  });

  test('hides retained repository controls immediately when switching tabs', () => {
    useDockStore.getState().setDockOpen('right', true);
    render(<WorkspaceViews views={{
      explorer: <div>Explorer contents</div>,
      branches: <button style={{ transition: 'all 150ms', visibility: 'visible' }}>Branch control</button>,
      changes: <button style={{ transition: 'all 150ms', visibility: 'visible' }}>Changes control</button>,
    }} />);
    const branchControl = screen.getByText('Branch control');
    const changesControl = screen.getByText('Changes control');
    const branches = branchControl.closest<HTMLElement>('[data-workspace-view]')!;
    const changes = changesControl.closest<HTMLElement>('[data-workspace-view]')!;
    for (const id of ['branches', 'changes', 'explorer'] as const) {
      fireEvent.click(screen.getByRole('tab', { name: id === 'branches' ? 'Branches' : id === 'changes' ? 'Changes' : 'Explorer' }));
      expect(branches.style.opacity).toBe(id === 'branches' ? '1' : '0');
      expect(changes.style.opacity).toBe(id === 'changes' ? '1' : '0');
    }
    expect(branches).toHaveAttribute('inert');
    expect(changes).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Branch control')).toBe(branchControl);
    expect(screen.getByText('Changes control')).toBe(changesControl);
  });

  test('mobile terminal visibility is independent of desktop bottom placement', () => {
    viewport.mobile = true;
    useWorkspaceViewStore.getState().moveView('conversations', 'bottom');
    const mounted = vi.fn();
    const unmounted = vi.fn();
    render(<WorkspaceViews views={{ conversations: <div>Conversation</div>, terminals: <Draft mounted={mounted} unmounted={unmounted} /> }} />);
    expect(screen.getByTestId('draft')).toHaveAttribute('data-visible', 'false');
    act(() => useWorkspaceViewStore.getState().setMobileTerminalOpen(true));
    expect(screen.getByTestId('draft')).toHaveAttribute('data-visible', 'true');
    act(() => useDockStore.getState().setDockOpen('bottom', false));
    expect(screen.getByTestId('draft')).toHaveAttribute('data-visible', 'true');
  });

  test('move, hide and add menus use the same view identity', async () => {
    render(<WorkspaceViews views={{ conversations: <input aria-label="Conversation draft" />, explorer: <div>Explorer</div> }} />);
    const input = screen.getByRole('textbox');
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Conversations' }));
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Move to' }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Left dock' }));
    expect(input.closest('[data-view-group]')).toHaveAttribute('data-view-group', 'left');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Conversations' })).toHaveFocus());
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Conversations' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide view' }));
    expect(input.closest('[data-workspace-view]')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Center panel options' }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Conversations' }));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.closest('[data-view-group]')).toHaveAttribute('data-view-group', 'center');
  });

  test('add menus omit local views and explicitly move views from their existing dock', () => {
    render(<WorkspaceViews views={{ conversations: <div>Chat</div>, explorer: <input aria-label="Explorer state" />, changes: <div>Changes</div> }} />);
    const input = screen.getByRole('textbox', { hidden: true });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Center panel options' }), { button: 0, ctrlKey: false });
    expect(screen.queryByRole('menuitem', { name: 'Conversations' })).toBeNull();
    expect(screen.getByText('Move here')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Explorer Right dock' }));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.closest('[data-view-group]')).toHaveAttribute('data-view-group', 'center');
    expect(document.querySelectorAll('[data-workspace-view="explorer"]')).toHaveLength(1);
    expect(screen.getAllByRole('tab', { name: 'Explorer', hidden: true })).toHaveLength(1);
    const right = document.querySelector<HTMLElement>('[data-view-group="right"]')!;
    expect(within(right).queryByRole('tab', { name: 'Explorer', hidden: true })).toBeNull();
  });
});
