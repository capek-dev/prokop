import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient, ProviderAccountStatus } from '@prokopai/sdk';

const mocks = vi.hoisted(() => ({
  providers: [] as ProviderAccountStatus[],
  accountAction: vi.fn(),
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
  useProviderAccountMutation: () => ({ mutateAsync: mocks.accountAction, isPending: false }),
}));

import { OAuthProvidersPanel } from '@/components/modals/configuration/OAuthProvidersPanel';

const sdkClient = {} as ProkopaiClient;

describe('OAuthProvidersPanel', () => {
  beforeEach(() => {
    mocks.accountAction.mockReset();
    mocks.accountAction.mockResolvedValue({});
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

  function codex(): ProviderAccountStatus {
    return {
      provider: 'codex', connected: true, activeAccountId: 'a',
      accounts: [
        { id: 'a', label: 'First account', connectedAt: '2026-01-01', connectionId: 'login-a', reauthRequired: false },
        { id: 'b', label: 'Second account', connectedAt: '2026-01-02', connectionId: 'login-b', reauthRequired: false },
      ],
    };
  }

  test('switches from the compact account selector without disconnecting', async () => {
    mocks.providers = [codex()];
    render(<OAuthProvidersPanel sdkClient={sdkClient} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Active Codex account' }));
    await userEvent.click(screen.getByRole('option', { name: 'Second account' }));
    expect(mocks.accountAction).toHaveBeenCalledWith({ providerId: 'codex', accountId: 'b', action: 'activate' });
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  test('removes only the selected account', async () => {
    mocks.providers = [codex()];
    render(<OAuthProvidersPanel sdkClient={sdkClient} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove active Codex account' }));
    expect(mocks.accountAction).toHaveBeenCalledWith({ providerId: 'codex', accountId: 'a', action: 'remove' });
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  test('shows switch failure without changing the active selection', async () => {
    mocks.providers = [codex()];
    mocks.accountAction.mockRejectedValue(new Error('Account unavailable'));
    render(<OAuthProvidersPanel sdkClient={sdkClient} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'Second account' }));
    expect(screen.getByText('Account unavailable')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveTextContent('First account');
  });

  test('keeps add-account authentication open until a new login arrives, not merely a switch', async () => {
    mocks.providers = [codex()];
    mocks.connect.mockResolvedValue({ authorizationUrl: 'https://auth.example.com', flowId: 'flow', redirectStrategy: 'server_callback' });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { rerender } = render(<OAuthProvidersPanel sdkClient={sdkClient} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument();
    mocks.providers = [{ ...codex(), activeAccountId: 'b' }];
    rerender(<OAuthProvidersPanel sdkClient={sdkClient} />);
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument();
    mocks.providers = [{ ...codex(), accounts: codex().accounts!.map(a => a.id === 'a' ? { ...a, connectionId: 'new-login-a' } : a) }];
    rerender(<OAuthProvidersPanel sdkClient={sdkClient} />);
    expect(screen.queryByRole('button', { name: 'Copy URL' })).not.toBeInTheDocument();
    open.mockRestore();
  });

  test('offers adding the first account with no selector', () => {
    mocks.providers = [{ provider: 'codex', connected: false, accounts: [], activeAccountId: null }];
    render(<OAuthProvidersPanel sdkClient={sdkClient} />);
    expect(screen.getByRole('button', { name: 'Add account' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
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
