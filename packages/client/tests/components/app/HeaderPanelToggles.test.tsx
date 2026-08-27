import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { HeaderPanelToggles } from '@/components/app/HeaderPanelToggles';

function renderToggles(overrides: Partial<Parameters<typeof HeaderPanelToggles>[0]> = {}) {
  const props = {
    sessionsActive: false,
    onToggleSessions: vi.fn(),
    filesActive: false,
    onToggleFiles: vi.fn(),
    terminalActive: false,
    onToggleTerminal: vi.fn(),
    hasWorkspace: true,
    onOpenWorkspaceSettings: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<HeaderPanelToggles {...props} />);
  return props;
}

describe('HeaderPanelToggles', () => {
  test('renders direct toggles for panels and settings, reflecting active state', async () => {
    const user = userEvent.setup();
    const props = renderToggles({ sessionsActive: true });

    const sessions = screen.getByRole('button', { name: /hide sessions/i });
    expect(sessions).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /show files/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /show terminal/i })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: /show terminal/i }));
    expect(props.onToggleTerminal).toHaveBeenCalledTimes(1);
  });

  test('hides the Files toggle and Workspace Settings entry without a workspace', async () => {
    const user = userEvent.setup();
    const props = renderToggles({ hasWorkspace: false });

    expect(screen.queryByRole('button', { name: /files/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /settings/i }));
    expect(screen.queryByRole('menuitem', { name: /workspace settings/i })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: /^settings$/i }));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
