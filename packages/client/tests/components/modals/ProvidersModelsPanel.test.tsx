import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type {
  ProkopaiClient,
  ModelRuntimeStatus,
  ModelWithStatus,
  ProviderAccountStatus,
  ProviderCredentialStatus,
} from '@prokopai/sdk';

const mocks = vi.hoisted(() => {
  const usable: ModelRuntimeStatus = { providerSupported: true, providerConfigured: true, usable: true };
  const needsConfig: ModelRuntimeStatus = { providerSupported: true, providerConfigured: false, usable: false };
  const model = (id: string, name: string, providerId: string, runtimeStatus: ModelRuntimeStatus): ModelWithStatus =>
    ({ id, name, contextWindow: 200000, providerId, providerName: providerId, runtimeStatus });
  return {
  config: {
    defaultModel: 'MiniMax-M3',
    defaultProvider: 'minimax',
    providers: [
      {
        id: 'minimax',
        name: 'MiniMax',
        models: [
          model('MiniMax-M3', 'MiniMax M3', 'minimax', usable),
          model('MiniMax-M2.7', 'MiniMax M2.7', 'minimax', usable),
        ],
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        models: [model('deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', needsConfig)],
      },
    ],
  },
  credentials: [
    { provider: 'minimax', configured: true },
    { provider: 'deepseek', configured: false },
    { provider: 'openrouter', configured: false },
  ] as ProviderCredentialStatus[],
  oauthProviders: [
    {
      provider: 'codex',
      displayName: 'Codex (ChatGPT)',
      connected: true,
      authType: 'oauth',
    },
  ] as ProviderAccountStatus[],
  };
});

vi.mock('@/hooks/queries', () => ({
  useModelsConfigQuery: () => ({ data: mocks.config, isLoading: false }),
  useProviderCredentialsQuery: () => ({ data: { providers: mocks.credentials }, isLoading: false }),
  useProvidersQuery: () => ({
    data: { providers: mocks.oauthProviders },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useSetModelDefaults: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSyncModels: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateModel: () => ({ mutateAsync: vi.fn() }),
  useUpdateModel: () => ({ mutateAsync: vi.fn() }),
  useDeleteModel: () => ({ mutateAsync: vi.fn() }),
  useSetProviderCredential: () => ({ mutateAsync: vi.fn() }),
  useClearProviderCredential: () => ({ mutateAsync: vi.fn() }),
  useConnectProvider: () => ({ mutateAsync: vi.fn() }),
  useDisconnectProvider: () => ({ mutateAsync: vi.fn() }),
  useCompleteOAuth: () => ({ mutateAsync: vi.fn() }),
  useProviderAccountMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ProvidersModelsPanel } from '@/components/modals/configuration/ProvidersModelsPanel';

const sdkClient = {} as ProkopaiClient;

describe('ProvidersModelsPanel', () => {
  test('renders one card per provider with connection status, including registry-only providers', () => {
    render(<ProvidersModelsPanel sdkClient={sdkClient} />);

    expect(screen.getByRole('button', { name: /MiniMax/ })).toHaveTextContent('Connected');
    expect(screen.getByRole('button', { name: /MiniMax/ })).toHaveTextContent('2 models');
    expect(screen.getByRole('button', { name: /DeepSeek/ })).toHaveTextContent('Needs key');
    expect(screen.getByRole('button', { name: /Codex \(ChatGPT\)/ })).toHaveTextContent('Connected');
    expect(screen.getByRole('button', { name: /OpenRouter/ })).toHaveTextContent('no models');
    // Cards start collapsed: no credential controls or non-default model rows visible.
    expect(screen.queryByText('MiniMax M2.7')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set Key' })).not.toBeInTheDocument();
  });

  test('expanding a card reveals its credential control, models, and actions', async () => {
    render(<ProvidersModelsPanel sdkClient={sdkClient} />);

    fireEvent.click(screen.getByRole('button', { name: /DeepSeek/ }));

    expect(await screen.findByRole('button', { name: 'Set Key' })).toBeInTheDocument();
    expect(screen.getByText('DeepSeek V4 Pro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add model' })).toBeInTheDocument();
  });

  test('expanding the OAuth provider shows its account controls', async () => {
    render(<ProvidersModelsPanel sdkClient={sdkClient} />);

    fireEvent.click(screen.getByRole('button', { name: /Codex \(ChatGPT\)/ }));

    expect(await screen.findByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  test('header carries the default selector and the sync menu, no provider CRUD', () => {
    render(<ProvidersModelsPanel sdkClient={sdkClient} />);

    expect(screen.getAllByText('Default').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /sync models from registry/i })).toBeInTheDocument();
    // Providers are read-only catalog entries: no create/edit/delete affordances.
    expect(screen.queryByRole('button', { name: /add provider/i })).not.toBeInTheDocument();
  });
});
