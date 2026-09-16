/**
 * Codex (ChatGPT) OAuth provider.
 * Uses the generalized OAuth manager for PKCE + authorization code flow.
 */
import type { ProviderStatus } from '@prokopai/sdk';
import {
  createOpenAiResponsesModel,
  registerProvider,
  type ConnectableProvider,
  type TokenResponse,
} from '@/adapters/capek/contracts';
import { codexAccounts } from './codex-accounts';
import { CodexAccountRuntime } from './codex-account-runtime';
import {
  registerOAuthConfig,
  initiateOAuthFlow,
  refreshTokens,
  getDefaultRedirectUri,
} from '../oauth/oauth-manager';
import { CODEX_OAUTH_DUMMY_KEY } from '@/domains/provider-accounts';
const OAUTH_DUMMY_KEY = CODEX_OAUTH_DUMMY_KEY;

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

const runtime = new CodexAccountRuntime(codexAccounts, token => refreshTokens('codex', token));

export { OAUTH_DUMMY_KEY, getDefaultRedirectUri as CODEX_REDIRECT_URI };

const codexProvider: ConnectableProvider = {
  descriptor: {
    id: 'codex',
    displayName: 'ChatGPT (Codex)',
    description: 'Use ChatGPT subscription models via OAuth',
    authType: 'oauth',
    connectable: true,
    providerOptionsKey: 'openai',
  },

  getStatus(): ProviderStatus {
    return codexAccounts.status();
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
    codexAccounts.disconnect();
  },

  async onTokensReceived(tokens: TokenResponse): Promise<void> {
    codexAccounts.add(tokens);
  },

  async createModel(options) {
    const codexFetch = await runtime.createFetch();
    return createOpenAiResponsesModel({
      modelId: options.modelId,
      apiKey: OAUTH_DUMMY_KEY,
      fetch: codexFetch,
      systemPrompt: options.systemPrompt,
      sessionId: options.sessionId,
    });
  },
};

registerProvider(codexProvider);
