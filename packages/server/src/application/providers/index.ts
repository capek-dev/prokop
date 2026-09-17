import type {
  ContextSelectionSettings,
  ContextSelectionUpdate,
  ProviderCredentialStatus,
  ProviderCredentialsResponse,
  ProviderDescriptor,
  ProviderStatus,
  ProviderAccountStatus,
} from '@prokopai/sdk';
import { NotFoundError } from '../http-errors';
import type {
  OAuthFlowPort,
  OAuthServerCallbackResult,
  ProviderCredentialPort,
  ProviderRegistryPort,
  SubscriptionAccountsPort,
} from '../ports/provider-accounts';

/**
 * Provider-account use cases (S4). Own the route-level orchestration for
 * the provider endpoints: list shape (descriptor spread over status),
 * connect-then-status ordering, disconnect, OAuth completion, and the
 * credential list/set/clear flows. Transport maps the results to wire
 * shapes; the Capek registry, the OAuth flow implementation, and the
 * credential store stay behind ports.
 */

export interface ProvidersApplicationDeps {
  registry: ProviderRegistryPort;
  oauth: OAuthFlowPort;
  credentials: ProviderCredentialPort;
  accounts?: SubscriptionAccountsPort;
}

export type ProviderConnectOutcome = {
  result: ReturnType<ProviderRegistryPort['connect']> extends Promise<infer T> ? T : never;
  status: ProviderStatus;
};

export interface ProvidersApplication {
  list(): Array<ProviderDescriptor & ProviderAccountStatus>;
  status(providerId: string): ProviderAccountStatus;
  activateAccount(providerId: string, accountId: string): ProviderAccountStatus;
  removeAccount(providerId: string, accountId: string): ProviderAccountStatus;
  connect(
    providerId: string,
    options?: { redirectStrategy?: import('@prokopai/sdk').OAuthRedirectStrategy },
  ): Promise<ProviderConnectOutcome>;
  disconnect(providerId: string): Promise<void>;
  completeOAuth(
    flowId: string,
    code: string,
    state: string,
    redirectUri: string,
  ): Promise<{ providerId: string }>;
  serverCallback(providerId: string, url: URL): Promise<OAuthServerCallbackResult>;
  getContextSelection(): ContextSelectionSettings;
  setContextSelection(update: boolean | ContextSelectionUpdate): Promise<ContextSelectionSettings>;
  listCredentials(): ProviderCredentialsResponse;
  setCredential(provider: string, apiKey: string): Promise<ProviderCredentialStatus>;
  clearCredential(provider: string): Promise<ProviderCredentialStatus>;
}

export function createProvidersApplication(
  deps: ProvidersApplicationDeps,
): ProvidersApplication {
  const accountsFor = (providerId: string): SubscriptionAccountsPort => {
    if (providerId !== 'codex' || !deps.accounts) throw new NotFoundError('Provider accounts not available');
    return deps.accounts;
  };
  return {
    list() {
      return deps.registry.list().map(provider => provider.provider === 'codex' && deps.accounts
        ? { ...provider, ...deps.accounts.status() }
        : provider);
    },

    status(providerId) {
      return providerId === 'codex' && deps.accounts ? deps.accounts.status() : deps.registry.status(providerId);
    },

    activateAccount(providerId, accountId) {
      const accounts = accountsFor(providerId);
      accounts.activate(accountId);
      return accounts.status();
    },

    removeAccount(providerId, accountId) {
      const accounts = accountsFor(providerId);
      accounts.remove(accountId);
      return accounts.status();
    },

    async connect(providerId, options) {
      const result = await deps.registry.connect(providerId, options);
      const status = deps.registry.status(providerId);
      return { result, status };
    },

    disconnect(providerId) {
      return deps.registry.disconnect(providerId);
    },

    completeOAuth(flowId, code, state, redirectUri) {
      return deps.oauth.complete(flowId, code, state, redirectUri);
    },

    serverCallback(providerId, url) {
      return deps.oauth.serverCallback(providerId, url);
    },

    getContextSelection() {
      if (!deps.credentials.getContextSelection) throw new NotFoundError('Context selection settings unavailable');
      return deps.credentials.getContextSelection();
    },
    setContextSelection(enabled) {
      if (!deps.credentials.setContextSelection) throw new NotFoundError('Context selection settings unavailable');
      return deps.credentials.setContextSelection(enabled);
    },
    listCredentials() {
      return deps.credentials.list();
    },

    setCredential(provider, apiKey) {
      return deps.credentials.set(provider, apiKey);
    },

    clearCredential(provider) {
      return deps.credentials.clear(provider);
    },
  };
}
