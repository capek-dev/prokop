import type {
  OAuthRedirectStrategy,
  ProviderCredentialStatus,
  ProviderCredentialsResponse,
  ProviderDescriptor,
  ProviderStatus,
} from '@prokopai/sdk';

/**
 * Inward-facing provider-account ports (S4/S5). The provider account and
 * OAuth state policy lives in the provider-accounts domain; these ports
 * carry the Capek registry seam, the OAuth flow implementation, and the
 * credential store. The Jean2 and Capek adapters wrap the current
 * implementations.
 */

export interface ProviderConnectResult {
  authorizationUrl?: string;
  flowId?: string;
  redirectStrategy?: OAuthRedirectStrategy;
  redirectUri?: string;
}

export interface ProviderRegistryPort {
  list(): Array<ProviderDescriptor & ProviderStatus>;
  status(providerId: string): ProviderStatus;
  connect(providerId: string, options?: { redirectStrategy?: OAuthRedirectStrategy }): Promise<ProviderConnectResult>;
  disconnect(providerId: string): Promise<void>;
}

export interface OAuthFlowInitResult {
  authorizationUrl: string;
  flowId: string;
  redirectStrategy: OAuthRedirectStrategy;
  redirectUri: string;
}

/** Server callback result: the application carries the exact HTML body and
 * status; the route maps it to a Response. */
export interface OAuthServerCallbackResult {
  body: string;
  status: number;
  contentType: string;
}

export interface OAuthFlowPort {
  initiate(
    providerId: string,
    redirectStrategy?: OAuthRedirectStrategy,
  ): Promise<OAuthFlowInitResult>;
  complete(
    flowId: string,
    code: string,
    state: string,
    redirectUri: string,
  ): Promise<{ providerId: string }>;
  serverCallback(providerId: string, url: URL): Promise<OAuthServerCallbackResult>;
}

/** Credential store seam. Errors propagate as the configuration layer's
 * typed errors exactly like the pre-S4 route; the application only maps
 * result values. */
export interface ProviderCredentialPort {
  list(): ProviderCredentialsResponse;
  set(provider: string, apiKey: string): Promise<ProviderCredentialStatus>;
  clear(provider: string): Promise<ProviderCredentialStatus>;
}
