import { render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => true,
}));

describe('AppSidebar on phone', () => {
  test('does not mount an off-canvas Sessions duplicate', () => {
    const { container, queryByText } = render(
      <SidebarProvider panelId="sessions">
        <AppSidebar currentSessionId={null}>
          <button type="button" data-sidebar="menu-button">
            Session one
          </button>
        </AppSidebar>
      </SidebarProvider>,
    );

    expect(container.querySelector('[data-slot="sessions-panel"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(queryByText('Session one')).toBeNull();
  });
});
