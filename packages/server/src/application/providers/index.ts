import type {
  ProviderCredentialStatus,
  ProviderCredentialsResponse,
  ProviderDescriptor,
  ProviderStatus,
} from '@jean2/sdk';
import type {
  OAuthFlowPort,
  OAuthServerCallbackResult,
  ProviderCredentialPort,
  ProviderRegistryPort,
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
}

export type ProviderConnectOutcome = {
  result: ReturnType<ProviderRegistryPort['connect']> extends Promise<infer T> ? T : never;
  status: ProviderStatus;
};

export interface ProvidersApplication {
  list(): Array<ProviderDescriptor & ProviderStatus>;
  status(providerId: string): ProviderStatus;
  connect(
    providerId: string,
    options?: { redirectStrategy?: import('@jean2/sdk').OAuthRedirectStrategy },
  ): Promise<ProviderConnectOutcome>;
  disconnect(providerId: string): Promise<void>;
  completeOAuth(
    flowId: string,
    code: string,
    state: string,
    redirectUri: string,
  ): Promise<{ providerId: string }>;
  serverCallback(providerId: string, url: URL): Promise<OAuthServerCallbackResult>;
  listCredentials(): ProviderCredentialsResponse;
  setCredential(provider: string, apiKey: string): Promise<ProviderCredentialStatus>;
  clearCredential(provider: string): Promise<ProviderCredentialStatus>;
}

export function createProvidersApplication(
  deps: ProvidersApplicationDeps,
): ProvidersApplication {
  return {
    list() {
      return deps.registry.list();
    },

    status(providerId) {
      return deps.registry.status(providerId);
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
