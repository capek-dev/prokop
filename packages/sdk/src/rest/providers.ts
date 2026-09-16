import type { HttpClient } from '../transport/http';
import type {
  ListProvidersResponse,
  GetProviderStatusResponse,
  ConnectProviderResponse,
  DisconnectProviderResponse,
  ListCredentialsResponse,
  SetCredentialResponse,
  ClearCredentialResponse,
  CompleteOAuthResponse,
} from '../types/rest-responses';
import type { OAuthRedirectStrategy } from '../shared-types/oauth';

interface ListProvidersOptions {
  signal?: AbortSignal;
}

interface GetStatusOptions {
  signal?: AbortSignal;
}

interface ConnectOptions {
  redirectStrategy?: OAuthRedirectStrategy;
  signal?: AbortSignal;
}

interface DisconnectOptions {
  signal?: AbortSignal;
}

interface SetCredentialOptions {
  signal?: AbortSignal;
}

interface ClearCredentialOptions {
  signal?: AbortSignal;
}

interface CompleteOAuthOptions {
  flowId: string;
  code: string;
  state: string;
  redirectUri: string;
  signal?: AbortSignal;
}

export class ProvidersRestNamespace {
  constructor(private http: HttpClient) {}

  /**
   * GET /api/providers - List all connectable providers with status and metadata
   */
  async list(options?: ListProvidersOptions): Promise<ListProvidersResponse> {
    return this.http.get('/providers', { signal: options?.signal });
  }

  /**
   * GET /api/providers/:providerId/status - Get provider connection status
   */
  async getStatus(providerId: string, options?: GetStatusOptions): Promise<GetProviderStatusResponse> {
    return this.http.get(`/providers/${encodeURIComponent(providerId)}/status`, {
      signal: options?.signal,
    });
  }

  /**
   * POST /api/providers/:providerId/connect - Start OAuth connection flow
   */
  async connect(providerId: string, options?: ConnectOptions): Promise<ConnectProviderResponse> {
    return this.http.post(`/providers/${encodeURIComponent(providerId)}/connect`, {
      redirectStrategy: options?.redirectStrategy,
    }, {
      signal: options?.signal,
    });
  }

  /**
   * DELETE /api/providers/:providerId - Disconnect provider
   */
  async disconnect(providerId: string, options?: DisconnectOptions): Promise<DisconnectProviderResponse> {
    return this.http.delete(`/providers/${encodeURIComponent(providerId)}`, {
      signal: options?.signal,
    });
  }

  async activateAccount(providerId: string, accountId: string, options?: GetStatusOptions): Promise<GetProviderStatusResponse> {
    return this.http.post(`/providers/${encodeURIComponent(providerId)}/accounts/${encodeURIComponent(accountId)}/activate`, {}, {
      signal: options?.signal,
    });
  }

  async removeAccount(providerId: string, accountId: string, options?: GetStatusOptions): Promise<GetProviderStatusResponse> {
    return this.http.delete(`/providers/${encodeURIComponent(providerId)}/accounts/${encodeURIComponent(accountId)}`, {
      signal: options?.signal,
    });
  }

  /**
   * POST /api/oauth/callback - Complete OAuth flow by sending authorization code
   */
  async completeOAuth(options: CompleteOAuthOptions): Promise<CompleteOAuthResponse> {
    return this.http.post('/oauth/callback', {
      flowId: options.flowId,
      code: options.code,
      state: options.state,
      redirectUri: options.redirectUri,
    }, {
      signal: options.signal,
    });
  }

  /**
   * GET /api/config/providers - List configured provider credentials
   */
  async listCredentials(options?: ListProvidersOptions): Promise<ListCredentialsResponse> {
    return this.http.get('/config/providers', { signal: options?.signal });
  }

  /**
   * PUT /api/config/providers/:provider - Set provider API key credential
   */
  async setCredential(
    provider: string,
    data: { apiKey: string },
    options?: SetCredentialOptions,
  ): Promise<SetCredentialResponse> {
    return this.http.put(`/config/providers/${encodeURIComponent(provider)}`, data, {
      signal: options?.signal,
    });
  }

  /**
   * DELETE /api/config/providers/:provider - Clear provider credential
   */
  async clearCredential(provider: string, options?: ClearCredentialOptions): Promise<ClearCredentialResponse> {
    return this.http.delete(`/config/providers/${encodeURIComponent(provider)}`, {
      signal: options?.signal,
    });
  }
}
