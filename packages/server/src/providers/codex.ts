/**
 * Codex (ChatGPT) OAuth provider.
 * Uses the generalized OAuth manager for PKCE + authorization code flow.
 */
import type { LanguageModel } from 'ai';
import type { CodexProviderConfig, ProviderStatus } from '@jean2/sdk';
import { registerProvider, type ConnectableProvider, type TokenResponse } from '@capekai/core/compat/jean2';
import { loadProviderConfig, saveProviderConfig, deleteProviderConfig } from './storage';
import {
  registerOAuthConfig,
  initiateOAuthFlow,
  refreshTokens,
  getDefaultRedirectUri,
} from './oauth-manager';

const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const OAUTH_DUMMY_KEY = 'codex-oauth-dummy-key';

interface IdTokenClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  email?: string;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
  };
}

function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return undefined;
  }
}

function extractAccountId(claims: IdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims['https://api.openai.com/auth']?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  );
}

// Register Codex OAuth config with the generalized manager
registerOAuthConfig('codex', {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  scopes: 'openid profile email offline_access',
  redirectUri: 'http://localhost:1455/auth/callback',
  extraAuthParams: {
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'jean2',
  },
});

async function getCodexConfig(): Promise<CodexProviderConfig | null> {
  const config = loadProviderConfig<CodexProviderConfig>('codex');
  if (!config) {
    return null;
  }

  if (config.expires < Date.now()) {
    try {
      const tokens = await refreshTokens('codex', config.refresh);
      config.access = tokens.access_token;
      config.refresh = tokens.refresh_token;
      config.expires = Date.now() + (tokens.expires_in ?? 3600) * 1000;

      if (tokens.id_token) {
        const claims = parseJwtClaims(tokens.id_token);
        if (claims) {
          const accountId = extractAccountId(claims);
          if (accountId) {
            config.accountId = accountId;
          }
        }
      }

      saveProviderConfig('codex', config);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to refresh Codex token, clearing config:', message);
      deleteProviderConfig('codex');
      return null;
    }
  }

  return config;
}

function getCodexStatus(): { connected: boolean; connectedAt?: string; accountId?: string } {
  const config = loadProviderConfig<CodexProviderConfig>('codex');
  if (!config) {
    return { connected: false };
  }
  return {
    connected: true,
    connectedAt: config.connectedAt,
    accountId: config.accountId,
  };
}

async function createCodexFetch(config: CodexProviderConfig): Promise<typeof globalThis.fetch> {
  const currentConfig = config.expires < Date.now()
    ? await getCodexConfig()
    : config;

  if (!currentConfig) {
    throw new Error('Codex not connected');
  }

  const codexFetch = async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
    const headers = new Headers(init?.headers);

    headers.delete('authorization');
    headers.delete('Authorization');
    headers.set('authorization', `Bearer ${currentConfig.access}`);

    if (currentConfig.accountId) {
      headers.set('ChatGPT-Account-Id', currentConfig.accountId);
    }

    headers.set('originator', 'jean2');

    const parsed = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const isCodexEndpoint = parsed.pathname.includes('/v1/responses') || parsed.pathname.includes('/chat/completions');
    const url = isCodexEndpoint
      ? new URL(CODEX_API_ENDPOINT)
      : new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);

    const response = await globalThis.fetch(url, {
      ...init,
      headers,
    });

    if (response.status === 401) {
      const refreshed = await getCodexConfig();
      if (refreshed) {
        const retryHeaders = new Headers(headers);
        retryHeaders.set('authorization', `Bearer ${refreshed.access}`);
        return globalThis.fetch(url, { ...init, headers: retryHeaders });
      }
    }

    return response;
  };

  return Object.assign(codexFetch, {
    preconnect: globalThis.fetch.preconnect,
  });
}

export { OAUTH_DUMMY_KEY, getDefaultRedirectUri as CODEX_REDIRECT_URI };

const codexProvider: ConnectableProvider = {
  descriptor: {
    id: 'codex',
    displayName: 'ChatGPT (Codex)',
    description: 'Use ChatGPT subscription models via OAuth',
    authType: 'oauth',
    connectable: true,
  },

  getStatus(): ProviderStatus {
    const status = getCodexStatus();
    return {
      provider: 'codex',
      connected: status.connected,
      connectedAt: status.connectedAt,
      accountId: status.accountId,
    };
  },

  async connect(options) {
    const result = await initiateOAuthFlow('codex', options?.redirectStrategy);
    return {
      authorizationUrl: result.authorizationUrl,
      flowId: result.flowId,
      redirectStrategy: result.redirectStrategy,
      redirectUri: result.redirectUri,
    };
  },

  async disconnect() {
    deleteProviderConfig('codex');
  },

  async onTokensReceived(tokens: TokenResponse): Promise<void> {
    const accountId = tokens.id_token ? extractAccountId(parseJwtClaims(tokens.id_token) ?? {}) : undefined;
    const config: CodexProviderConfig = {
      type: 'oauth',
      provider: 'codex',
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      ...(accountId && { accountId }),
      connectedAt: new Date().toISOString(),
    };
    saveProviderConfig('codex', config);
  },

  async createModel(options) {
    const config = await getCodexConfig();
    if (!config) {
      throw new Error('Codex not connected. Please connect your ChatGPT subscription in Settings.');
    }
    const codexFetch = await createCodexFetch(config);
    const { createOpenAI } = await import('@ai-sdk/openai');
    const openai = createOpenAI({
      apiKey: OAUTH_DUMMY_KEY,
      fetch: codexFetch,
    });
    return {
      model: openai.responses(options.modelId) as unknown as LanguageModel,
      useProviderInstructions: true,
      omitMaxOutputTokens: true,
      providerOptions: {
        openai: {
          instructions: options.systemPrompt || 'You are a helpful assistant.',
          promptCacheKey: options.sessionId,
          store: false,
        },
      },
    };
  },
};

registerProvider(codexProvider);
