import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientMetadata, OAuthTokens, OAuthClientInformation, OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpOAuthConfig } from '@prokopai/sdk';
import * as auth from './auth';

export interface McpOAuthCallbacks {
  redirectUrl: string;
  state: string;
  onRedirect: (url: URL) => void | Promise<void>;
  interactive?: boolean;
}

/** The credential key is scoped to workspace, server name and URL by the manager. */
export class McpOAuthProvider implements OAuthClientProvider {
  private verifier?: string;
  constructor(private key: string, private serverUrl: string,
    private config: McpOAuthConfig, private callbacks: McpOAuthCallbacks) {}
  get redirectUrl(): string { return this.callbacks.redirectUrl; }
  get clientMetadata(): OAuthClientMetadata {
    return { redirect_uris: [this.redirectUrl], client_name: 'Prokop',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: this.config.clientSecret ? 'client_secret_post' : 'none',
      ...(this.config.scope ? { scope: this.config.scope } : {}) };
  }
  async clientInformation(): Promise<(OAuthClientInformation & Pick<OAuthClientMetadata, 'token_endpoint_auth_method'>) | undefined> {
    if (this.config.clientId) return { client_id: this.config.clientId, client_secret: this.config.clientSecret };
    const info = (await auth.getAuthForUrl(this.key, this.serverUrl))?.clientInfo;
    if (!info && !this.callbacks.interactive) throw new UnauthorizedError('MCP sign-in required');
    if (info && this.callbacks.interactive && info.redirectUri !== this.redirectUrl) return undefined;
    return info ? { client_id: info.clientId, client_secret: info.clientSecret,
      token_endpoint_auth_method: info.tokenEndpointAuthMethod } : undefined;
  }
  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await auth.updateClientInfo(this.key, { clientId: info.client_id, clientSecret: info.client_secret,
      redirectUri: this.redirectUrl, tokenEndpointAuthMethod: info.token_endpoint_auth_method }, this.serverUrl);
  }
  async tokens(): Promise<OAuthTokens | undefined> {
    const tokens = (await auth.getAuthForUrl(this.key, this.serverUrl))?.tokens;
    return tokens ? { access_token: tokens.accessToken, refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresAt ? Math.floor((tokens.expiresAt - Date.now()) / 1000) : undefined,
      token_type: 'Bearer', scope: tokens.scope } : undefined;
  }
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await auth.updateTokens(this.key, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined, scope: tokens.scope }, this.serverUrl);
  }
  async redirectToAuthorization(url: URL): Promise<void> { await this.callbacks.onRedirect(url); }
  async saveCodeVerifier(value: string): Promise<void> { this.verifier = value; }
  async codeVerifier(): Promise<string> {
    if (!this.verifier) throw new Error('No pending OAuth verifier');
    return this.verifier;
  }
  async state(): Promise<string> { return this.callbacks.state; }
  async invalidateCredentials(type: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (type === 'verifier') { this.verifier = undefined; return; }
    if (type === 'discovery') return;
    if (type === 'all') { await auth.removeAuth(this.key); return; }
    const stored = await auth.getAuthForUrl(this.key, this.serverUrl);
    if (!stored) return;
    if (type === 'client') delete stored.clientInfo;
    if (type === 'tokens') delete stored.tokens;
    await auth.setAuth(this.key, stored, this.serverUrl);
  }
}
