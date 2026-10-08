import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setMode: vi.fn(),
  setScheme: vi.fn(),
}));

vi.mock('@/components/providers/ThemeProvider', () => ({
  useTheme: () => ({
    mode: 'system',
    scheme: 'neutral',
    setMode: mocks.setMode,
    setScheme: mocks.setScheme,
    resolvedMode: 'dark',
  }),
}));

vi.mock('@/components/modals/configuration/NotificationSettings', () => ({
  NotificationSettings: () => null,
}));

import { AppearancePanel } from '@/components/modals/configuration/AppearancePanel';
import { NotificationsPanel } from '@/components/modals/configuration/NotificationsPanel';
import { useUIStore } from '@/stores/uiStore';

describe('AppearancePanel', () => {
  beforeEach(() => {
    mocks.setMode.mockClear();
    mocks.setScheme.mockClear();
    useUIStore.setState({ chatFinishSoundEnabled: true, permissionSoundEnabled: true });
  });

  test('renders mode segmented pill and selects a mode', async () => {
    const user = userEvent.setup();
    render(<AppearancePanel />);

    const dark = screen.getByRole('button', { name: /dark/i });
    expect(dark).toHaveAttribute('aria-pressed', 'false');
    await user.click(dark);
    expect(mocks.setMode).toHaveBeenCalledWith('dark');
  });

  test('marks the active scheme with aria-pressed and applies a new scheme', async () => {
    const user = userEvent.setup();
    const { container } = render(<AppearancePanel />);

    const neutral = screen.getByRole('button', { name: /^neutral$/i });
    expect(neutral).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /^ocean$/i }));
    expect(mocks.setScheme).toHaveBeenCalledWith('ocean');
    expect(screen.getAllByRole('button', { name: /^sunset$/i })).toHaveLength(1);

    // Previews resolve the real token cascade via paired mode+scheme classes.
    expect(container.querySelector('.light.ocean')).not.toBeNull();
    expect(container.querySelector('.dark.ocean')).not.toBeNull();
    expect(container.querySelectorAll('.light.neutral')).toHaveLength(1);
  });

  test('file open mode uses the same segmented pill as theme mode', async () => {
    const user = userEvent.setup();
    useUIStore.setState({ defaultFileOpenMode: 'preview' });
    render(<AppearancePanel />);

    const group = screen.getByRole('group', { name: 'File open mode' });
    expect(within(group).getByRole('button', { name: /preview files/i })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(group).getByRole('button', { name: /edit files/i }));
    expect(useUIStore.getState().defaultFileOpenMode).toBe('edit');
  });

  test('leaves notification sounds to the Notifications section', () => {
    render(<AppearancePanel />);
    expect(screen.queryByRole('switch', { name: 'Chat completion sound' })).not.toBeInTheDocument();
  });
});

describe('NotificationsPanel', () => {
  beforeEach(() => {
    useUIStore.setState({ chatFinishSoundEnabled: true, permissionSoundEnabled: true });
  });

  test('sound toggles use the Switch contract against uiStore', async () => {
    const user = userEvent.setup();
    render(<NotificationsPanel />);

    const chatToggle = screen.getByRole('switch', { name: 'Chat completion sound' });
    expect(chatToggle).toHaveAttribute('aria-checked', 'true');

    await user.click(chatToggle);
    expect(useUIStore.getState().chatFinishSoundEnabled).toBe(false);

    const permissionToggle = screen.getByRole('switch', { name: 'Permission request sound' });
    await user.click(permissionToggle);
    expect(useUIStore.getState().permissionSoundEnabled).toBe(false);
  });
});
