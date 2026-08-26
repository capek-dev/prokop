import { createRef } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { AppSidebar, type AppSidebarHandle } from '@/components/layout/AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';

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
    useChatLayoutStore.setState({ sessionsPanelWidth: 256 });
  });

  test('renders desktop session navigation as a dedicated in-flow panel', () => {
    const { container, getByRole } = renderSidebar();

    const panel = container.querySelector('[data-slot="sessions-panel"]');

    expect(panel).toHaveAttribute('data-variant', 'shell');
    expect(panel).toHaveAttribute('data-sidebar', 'sidebar');
    expect(panel).toHaveClass('relative', 'h-full', 'shrink-0', 'overflow-hidden');
    expect(panel).not.toHaveClass(
      'fixed',
      'p-2',
      'rounded-lg',
      'shadow-sm',
      'transition-[width]',
    );
    const divider = getByRole('separator', { name: 'Resize Sessions' });
    expect(divider).toHaveAttribute('aria-valuenow', '256');
    expect(divider).toHaveAttribute('data-slot', 'desktop-panel-divider');
    expect(divider).toHaveClass('relative', 'w-1', 'shrink-0', 'bg-border');
    expect(container.querySelector('[data-slot="sidebar"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="sidebar-container"]')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="desktop-panel-divider-indicator"]'),
    ).toHaveClass('left-1/2', '-translate-x-1/2', 'rounded-full');
  });

  test('resizes the desktop session panel with the keyboard', () => {
    const { container, getByRole } = renderSidebar();
    const wrapper = container.querySelector<HTMLElement>('[data-panel-id="sessions"]');

    fireEvent.keyDown(getByRole('separator', { name: 'Resize Sessions' }), {
      key: 'ArrowRight',
    });

    expect(useChatLayoutStore.getState().sessionsPanelWidth).toBe(272);
    expect(wrapper?.style.getPropertyValue('--sidebar-width')).toBe('272px');
  });

  test('preserves focusSessionPanel for the active session', () => {
    const { ref, getByRole } = renderSidebar('session-2');

    act(() => ref.current?.focusSessionPanel());

    expect(getByRole('button', { name: 'Session two' })).toHaveFocus();
  });
});
