import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient, ProviderCredentialStatus, ProviderStatus } from '@prokopai/sdk';

const mocks = vi.hoisted(() => ({
  credentials: [
    { provider: 'typesafe', configured: false },
    { provider: 'deepseek', configured: true },
    { provider: 'openai', configured: false },
  ] as ProviderCredentialStatus[],
  providers: [
    {
      provider: 'codex',
      displayName: 'ChatGPT (Codex)',
      connected: false,
      authType: 'oauth',
    },
  ] as ProviderStatus[],
}));

vi.mock('@/hooks/queries', () => ({
  useProviderCredentialsQuery: () => ({
    data: { providers: mocks.credentials },
    isLoading: false,
  }),
  useSetProviderCredential: () => ({ mutateAsync: vi.fn() }),
  useClearProviderCredential: () => ({ mutateAsync: vi.fn() }),
  useProvidersQuery: () => ({
    data: { providers: mocks.providers },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useConnectProvider: () => ({ mutateAsync: vi.fn() }),
  useDisconnectProvider: () => ({ mutateAsync: vi.fn() }),
  useCompleteOAuth: () => ({ mutateAsync: vi.fn() }),
  useProviderAccountMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { LLMProvidersPanel } from '@/components/modals/configuration/LLMProvidersPanel';

const sdkClient = {} as ProkopaiClient;

describe('LLMProvidersPanel', () => {
  test('shows API key and account subscription providers in one panel', () => {
    render(<LLMProvidersPanel sdkClient={sdkClient} />);

    expect(screen.getByRole('heading', { name: 'API keys' })).toBeInTheDocument();
    expect(screen.getByText('DeepSeek')).toBeInTheDocument();
    expect(screen.getAllByText('TypeSafe')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Relevance scoring' })).toHaveTextContent('TypeSafe');
    expect(screen.getByRole('region', { name: 'API keys' })).not.toHaveTextContent('TypeSafe');
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Account subscriptions' })).toBeInTheDocument();
    expect(screen.getByText('ChatGPT (Codex)')).toBeInTheDocument();
    expect(screen.queryByText(/managed in the OAuth tab/i)).not.toBeInTheDocument();
  });
});
