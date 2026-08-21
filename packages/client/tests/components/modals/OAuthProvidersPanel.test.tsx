import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient, ProviderStatus } from '@prokopai/sdk';

const mocks = vi.hoisted(() => ({
  providers: [] as ProviderStatus[],
  connect: vi.fn(),
  disconnect: vi.fn(),
  complete: vi.fn(),
}));

vi.mock('@/hooks/queries', () => ({
  useProvidersQuery: () => ({
    data: { providers: mocks.providers },
    isLoading: false,
  }),
  useConnectProvider: () => ({ mutateAsync: mocks.connect }),
  useDisconnectProvider: () => ({ mutateAsync: mocks.disconnect }),
  useCompleteOAuth: () => ({ mutateAsync: mocks.complete }),
}));

import { OAuthProvidersPanel } from '@/components/modals/configuration/OAuthProvidersPanel';

const sdkClient = {} as ProkopaiClient;

describe('OAuthProvidersPanel', () => {
  beforeEach(() => {
    mocks.connect.mockReset();
    mocks.disconnect.mockReset();
    mocks.complete.mockReset();
    mocks.connect.mockResolvedValue({});
  });

  test('shows a direct reconnect action for invalid credentials', async () => {
    mocks.providers = [{
      provider: 'gmail',
      displayName: 'Gmail',
      connected: false,
      reauthRequired: true,
      error: 'Gmail authorization expired or was revoked. Reconnect Gmail to continue.',
    }];

    render(<OAuthProvidersPanel sdkClient={sdkClient} />);

    expect(screen.getByText('Reauthentication required')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.getByText(/authorization expired or was revoked/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /reconnect/i }));

    expect(mocks.connect).toHaveBeenCalledWith({ providerId: 'gmail' });
  });

  test('keeps the normal connected state unchanged', () => {
    mocks.providers = [{
      provider: 'gmail',
      displayName: 'Gmail',
      connected: true,
    }];

    render(<OAuthProvidersPanel sdkClient={sdkClient} />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument();
  });
});
