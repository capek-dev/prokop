import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PWAUpdateBanner } from '@/components/app/PWAUpdateBanner';
import { usePWAUpdateStore } from '@/pwa/updateStore';

beforeEach(() => {
  usePWAUpdateStore.setState({
    needRefresh: false,
    offlineReady: false,
    dismissed: false,
    isUpdating: false,
    serviceWorkerUpdater: null,
  });
});

describe('PWAUpdateBanner', () => {
  it('appears when an update is ready and can be deferred until the next foreground check', async () => {
    const user = userEvent.setup();
    render(<PWAUpdateBanner />);

    expect(screen.queryByText('Prokopai update ready')).not.toBeInTheDocument();

    act(() => usePWAUpdateStore.getState().markNeedRefresh());
    expect(screen.getByText('Prokopai update ready')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Prokopai update ready')).not.toBeInTheDocument();

    act(() => usePWAUpdateStore.getState().showOnForeground());
    expect(screen.getByText('Prokopai update ready')).toBeInTheDocument();
  });

  it('restarts once and disables actions while activation is in progress', async () => {
    const user = userEvent.setup();
    const updater = vi.fn().mockResolvedValue(undefined);
    usePWAUpdateStore.getState().setServiceWorkerUpdater(updater);
    usePWAUpdateStore.getState().markNeedRefresh();
    render(<PWAUpdateBanner />);

    await user.click(screen.getByRole('button', { name: 'Restart now' }));

    expect(updater).toHaveBeenCalledTimes(1);
    expect(updater).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Restarting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
  });
});
