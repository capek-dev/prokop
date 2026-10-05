import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DockRegion } from '@/components/layout/DockRegion';
import { DOCK_POSITIONS, useDockStore } from '@/stores/dockStore';

describe('DockRegion', () => {
  beforeEach(() => {
    useDockStore.setState(useDockStore.getInitialState());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    useDockStore.setState(useDockStore.getInitialState());
  });

  test.each(DOCK_POSITIONS)('keeps %s content and local state through collapse/reopen', (position) => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Content() {
      const [value, setValue] = useState('');
      useEffect(() => { mounted(); return unmounted; }, []);
      return <input aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />;
    }
    useDockStore.getState().setDockOpen(position, true);
    const { getByRole, queryByRole } = render(<DockRegion position={position}><Content /></DockRegion>);
    const input = getByRole('textbox');
    const region = input.closest('[data-dock-position]');
    fireEvent.change(input, { target: { value: 'keep this draft' } });

    act(() => useDockStore.getState().setDockOpen(position, false));
    expect(region).toHaveAttribute('inert');
    expect(region).toHaveAttribute('aria-hidden', 'true');
    expect(queryByRole('separator')).toBeNull();
    expect(input).toBeInTheDocument();

    act(() => useDockStore.getState().setDockOpen(position, true));
    expect(getByRole('textbox')).toBe(input);
    expect(input).toHaveValue('keep this draft');
    expect(region).not.toHaveAttribute('inert');
    expect(mounted).toHaveBeenCalledOnce();
    expect(unmounted).not.toHaveBeenCalled();
  });

  test.each([
    ['left', 'ArrowRight', 'ArrowLeft', 272],
    ['right', 'ArrowLeft', 'ArrowRight', 556],
    ['bottom', 'ArrowUp', 'ArrowDown', 352],
  ] as const)('resizes %s with the correct keyboard direction', (position, grow, shrink, expected) => {
    useDockStore.getState().setDockOpen(position, true);
    const { getByRole } = render(<DockRegion position={position}>Content</DockRegion>);
    const divider = getByRole('separator', { name: `Resize ${position} dock` });
    fireEvent.keyDown(divider, { key: grow });
    expect(useDockStore.getState().docks[position].size).toBe(expected);
    expect(divider).toHaveAttribute('aria-orientation', position === 'bottom' ? 'horizontal' : 'vertical');
    fireEvent.keyDown(divider, { key: shrink });
    expect(useDockStore.getState().docks[position].size).toBe(expected - 16);
  });

  test.each(DOCK_POSITIONS)('commits %s pointer resizing only when the gesture ends', (position) => {
    useDockStore.getState().setDockOpen(position, true);
    const { getByRole, container } = render(<DockRegion position={position}>Content</DockRegion>);
    const region = container.querySelector<HTMLElement>('[data-dock-position]')!;
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 100, 800, 700));
    const previousSize = useDockStore.getState().docks[position].size;
    fireEvent.pointerDown(getByRole('separator'), { button: 0, pointerId: 1 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 600, clientY: 400 });
    expect(useDockStore.getState().docks[position].size).toBe(previousSize);
    fireEvent.pointerUp(document, { pointerId: 1 });
    expect(useDockStore.getState().docks[position].size).toBe(400);
  });

  test('temporarily bounds a right dock to its container without overwriting the saved width', async () => {
    let width = 900;
    let notifyResize = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, 0, this.dataset.testid === 'container' ? width : 0, 800);
    });
    useDockStore.getState().setDockOpen('right', true);
    useDockStore.getState().setDockSize('right', 650);
    const { getByRole } = render(<div data-testid="container"><DockRegion position="right">Content</DockRegion></div>);
    expect(getByRole('separator')).toHaveAttribute('aria-valuenow', '508');
    expect(useDockStore.getState().docks.right.size).toBe(650);

    width = 1400;
    act(() => notifyResize());
    await vi.waitFor(() => expect(getByRole('separator')).toHaveAttribute('aria-valuenow', '650'));
    expect(useDockStore.getState().docks.right.size).toBe(650);
  });
});
