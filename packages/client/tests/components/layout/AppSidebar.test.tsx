import { createRef } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { AppSidebar, type AppSidebarHandle } from '@/components/layout/AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useDockStore } from '@/stores/dockStore';

function renderSidebar(currentSessionId: string | null = null) {
  const ref = createRef<AppSidebarHandle>();
  const result = render(
    <SidebarProvider panelId="sessions">
      <AppSidebar ref={ref} currentSessionId={currentSessionId}>
        <button type="button" data-sidebar="menu-button" data-session-id="session-1">
          Session one
        </button>
        <button type="button" data-sidebar="menu-button" data-session-id="session-2">
          Session two
        </button>
      </AppSidebar>
    </SidebarProvider>,
  );

  return { ref, ...result };
}

describe('AppSidebar', () => {
  beforeEach(() => {
    useDockStore.setState(useDockStore.getInitialState());
  });

  test('renders desktop session navigation as a dedicated in-flow panel', () => {
    const { container, getByRole } = renderSidebar();

    const region = container.querySelector('[data-dock-position="left"]');
    expect(region).toContainElement(getByRole('button', { name: 'Session one' }));
    expect(getByRole('separator', { name: 'Resize left dock' })).toHaveAttribute('aria-valuenow', '256');
    expect(container.querySelector('[data-slot="sidebar-container"]')).not.toBeInTheDocument();
  });

  test('resizes the desktop session panel with the keyboard', () => {
    const { container, getByRole } = renderSidebar();
    const wrapper = container.querySelector<HTMLElement>('[data-dock-position="left"]');

    fireEvent.keyDown(getByRole('separator', { name: 'Resize left dock' }), {
      key: 'ArrowRight',
    });

    expect(useDockStore.getState().docks.left.size).toBe(272);
    expect(wrapper?.style.getPropertyValue('--dock-size')).toBe('272px');
  });

  test('preserves focusSessionPanel for the active session', () => {
    const { ref, getByRole } = renderSidebar('session-2');

    act(() => ref.current?.focusSessionPanel());

    expect(getByRole('button', { name: 'Session two' })).toHaveFocus();
  });
});
