import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WorkspaceViewGroup } from '@/components/app/WorkspaceViewGroup';
import { WorkspaceTabStrip } from '@/components/app/WorkspaceTabStrip';
import { createDefaultViewLayout, useWorkspaceViewStore } from '@/stores/workspaceViewStore';
import { useDockStore } from '@/stores/dockStore';

const available = ['explorer', 'changes', 'branches', 'sessions'] as const;

function setup() {
  const activate = vi.fn();
  render(<>
    <WorkspaceViewGroup region="right" available={available} slotRef={() => {}} tabs={{ explorer: { label: 'Explorer', onActivate: activate } }} />
    <WorkspaceViewGroup region="left" available={available} slotRef={() => {}} tabs={{ explorer: { label: 'Explorer', onActivate: activate } }} />
    <WorkspaceViewGroup region="center" available={available} slotRef={() => {}} tabs={{}} />
  </>);
  const right = screen.getByRole('tablist', { name: 'Right dock views' });
  const left = screen.getByRole('tablist', { name: 'Left dock views' });
  const center = screen.getByRole('tablist', { name: 'Center views' });
  for (const strip of [right, left, center]) {
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 44));
    within(strip).queryAllByRole('tab').forEach((tab, index) => {
      vi.spyOn(tab.parentElement!, 'getBoundingClientRect').mockImplementation(() => new DOMRect(index * 100 - strip.scrollLeft, 0, 100, 32));
    });
  }
  return { right, left, center, activate };
}

function start(name: string) {
  const dataTransfer = new DataTransfer();
  fireEvent.dragStart(screen.getByRole('tab', { name }), { dataTransfer });
  return dataTransfer;
}

function dragAt(target: HTMLElement, type: 'dragover' | 'drop', dataTransfer: DataTransfer, clientX: number) {
  // The DOM test environment does not supply mouse coordinates on drag events.
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  fireEvent(target, event);
}

describe('workspace tab dragging', () => {
  beforeEach(() => {
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
    useDockStore.setState(useDockStore.getInitialState());
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
    useDockStore.setState(useDockStore.getInitialState());
  });

  test('only commits order on drop and clears feedback on cancellation', () => {
    const { right } = setup();
    const before = useWorkspaceViewStore.getState().layout;
    let dataTransfer = start('Explorer');
    dragAt(right, 'dragover', dataTransfer, 210);
    expect(right.querySelector('[data-tab-insertion-marker]')).not.toBeNull();
    expect(useWorkspaceViewStore.getState().layout).toBe(before);
    fireEvent.dragEnd(screen.getByRole('tab', { name: 'Explorer' }), { dataTransfer });
    expect(right.querySelector('[data-tab-insertion-marker]')).toBeNull();
    expect(useWorkspaceViewStore.getState().layout).toBe(before);
    dataTransfer = start('Explorer');
    dragAt(right, 'dragover', dataTransfer, 210);
    dragAt(right, 'drop', dataTransfer, 210);
    expect(within(right).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Changes', 'Explorer', 'Branches']);
    expect(right.querySelector('[data-tab-insertion-marker]')).toBeNull();
  });

  test('inserts into another visible dock or an empty strip and activates the moved tab', () => {
    const { left, center, activate } = setup();
    let dataTransfer = start('Explorer');
    dragAt(left, 'drop', dataTransfer, 10);
    expect(within(left).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Explorer', 'Sessions']);
    expect(activate).toHaveBeenCalledOnce();
    dataTransfer = start('Explorer');
    dragAt(center, 'drop', dataTransfer, 10);
    expect(within(center).getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab', { name: 'Explorer' })).toHaveLength(1);
  });

  test('rejects external drags and collapsed targets', () => {
    const { left } = setup();
    const before = useWorkspaceViewStore.getState().layout;
    const external = new DataTransfer();
    external.setData('application/x-prokop-workspace-tab', 'explorer');
    dragAt(left, 'dragover', external, 10);
    dragAt(left, 'drop', external, 10);
    expect(left.querySelector('[data-tab-insertion-marker]')).toBeNull();
    expect(useWorkspaceViewStore.getState().layout).toBe(before);
    const dataTransfer = start('Explorer');
    left.closest('section')!.setAttribute('inert', '');
    dragAt(left, 'drop', dataTransfer, 10);
    expect(useWorkspaceViewStore.getState().layout).toBe(before);
  });

  test('scrolls continuously at the edge and cancels its animation when leaving', () => {
    let tick: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { tick = callback; return 7; }));
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const { right } = setup();
    const dataTransfer = start('Explorer');
    dragAt(right, 'dragover', dataTransfer, 295);
    act(() => tick?.(16));
    expect(right.scrollLeft).toBeGreaterThan(0);
    fireEvent.dragLeave(right, { relatedTarget: document.body });
    expect(cancel).toHaveBeenCalledWith(7);
    expect(right.querySelector('[data-tab-insertion-marker]')).toBeNull();
  });

  test('mobile strips remain scrollable without enabling native tab dragging', () => {
    render(<WorkspaceTabStrip ids={['explorer']} activeId="explorer" tabs={{}} label="Repository views" onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('tab')).toHaveAttribute('draggable', 'false');
  });
});
