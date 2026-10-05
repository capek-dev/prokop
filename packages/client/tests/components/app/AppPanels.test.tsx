import { createRef, forwardRef, useEffect, useImperativeHandle } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppPanels } from '@/components/app/AppPanels';
import type { TerminalPanelHandle } from '@/components/layout/TerminalPanel';
import { useDockStore } from '@/stores/dockStore';

const mocks = vi.hoisted(() => ({ mobile: false, mount: vi.fn(), unmount: vi.fn(), focus: vi.fn() }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.mobile }));
vi.mock('@/components/layout/TerminalPanel', () => ({
  TerminalPanel: forwardRef<TerminalPanelHandle, { isOpen: boolean }>(function Terminal({ isOpen }, ref) {
    useEffect(() => { mocks.mount(); return mocks.unmount; }, []);
    useImperativeHandle(ref, () => ({ focus: mocks.focus }), []);
    return <div data-testid="terminal" data-open={isOpen} />;
  }),
}));

describe('AppPanels', () => {
  beforeEach(() => {
    mocks.mobile = false;
    vi.clearAllMocks();
    useDockStore.setState(useDockStore.getInitialState());
  });
  afterEach(() => {
    cleanup();
    useDockStore.setState(useDockStore.getInitialState());
  });

  test('keeps the terminal controller mounted through collapse and mobile layout changes', async () => {
    const ref = createRef<TerminalPanelHandle>();
    const { findByTestId, getByRole, queryByRole, rerender } = render(<AppPanels sdkClient={null} terminalPanelRef={ref} />);
    const terminal = await findByTestId('terminal');
    expect(terminal).toHaveAttribute('data-open', 'false');
    act(() => useDockStore.getState().setDockOpen('bottom', true));
    expect(terminal).toHaveAttribute('data-open', 'true');
    expect(getByRole('separator', { name: 'Resize bottom dock' })).toBeInTheDocument();

    mocks.mobile = true;
    rerender(<AppPanels sdkClient={null} terminalPanelRef={ref} />);
    expect(queryByRole('separator')).toBeNull();
    expect(await findByTestId('terminal')).toBe(terminal);
    act(() => ref.current?.focus());
    expect(mocks.focus).toHaveBeenCalledOnce();

    act(() => useDockStore.getState().setDockOpen('bottom', false));
    expect(terminal).toHaveAttribute('data-open', 'false');
    expect(mocks.mount).toHaveBeenCalledOnce();
    expect(mocks.unmount).not.toHaveBeenCalled();
  });
});
