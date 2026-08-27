import { render, screen } from '@testing-library/react';
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

  test('sound toggles use the Switch contract against uiStore', async () => {
    const user = userEvent.setup();
    render(<AppearancePanel />);

    const chatToggle = screen.getByRole('switch', { name: 'Chat completion sound' });
    expect(chatToggle).toHaveAttribute('aria-checked', 'true');

    await user.click(chatToggle);
    expect(useUIStore.getState().chatFinishSoundEnabled).toBe(false);

    const permissionToggle = screen.getByRole('switch', { name: 'Permission request sound' });
    await user.click(permissionToggle);
    expect(useUIStore.getState().permissionSoundEnabled).toBe(false);
  });
});
