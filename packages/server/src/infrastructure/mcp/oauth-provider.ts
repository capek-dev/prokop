import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformation,
  OAuthClientInformationFull,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpOAuthConfig } from '@jean2/sdk';
import * as auth from './auth';

const OAUTH_CALLBACK_PORT = 19876;
const OAUTH_CALLBACK_PATH = '/mcp/oauth/callback';

export interface McpOAuthCallbacks {
  onRedirect: (url: URL) => void | Promise<void>;
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private mcpName: string,
    private serverUrl: string,
    private config: McpOAuthConfig,
    private callbacks: McpOAuthCallbacks,
  ) {}

  get redirectUrl(): string {
    return `http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: 'Jean2',
      client_uri: 'https://jean2.ai',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.config.clientSecret ? 'client_secret_post' : 'none',
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const stored = await auth.getAuthForUrl(this.mcpName, this.serverUrl);
    if (!stored?.clientInfo) {
      return undefined;
    }
    return {
      client_id: stored.clientInfo.clientId,
      client_secret: stored.clientInfo.clientSecret,
    };
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await auth.updateClientInfo(this.mcpName, {
      clientId: info.client_id,
      clientSecret: info.client_secret,
      clientIdIssuedAt: info.client_id_issued_at,
      clientSecretExpiresAt: info.client_secret_expires_at,
    }, this.serverUrl);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const stored = await auth.getAuthForUrl(this.mcpName, this.serverUrl);
    if (!stored?.tokens) {
      return undefined;
    }
    const tokens: OAuthTokens = {
      access_token: stored.tokens.accessToken,
      refresh_token: stored.tokens.refreshToken,
      expires_in: stored.tokens.expiresAt ? Math.floor((stored.tokens.expiresAt - Date.now()) / 1000) : undefined,
      token_type: 'Bearer',
      scope: stored.tokens.scope,
    };
    return tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await auth.updateTokens(this.mcpName, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      scope: tokens.scope,
    }, this.serverUrl);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.callbacks.onRedirect(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await auth.updateCodeVerifier(this.mcpName, codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const stored = await auth.getAuthForUrl(this.mcpName, this.serverUrl);
    if (!stored?.codeVerifier) {
      throw new Error('No code verifier found');
    }
    return stored.codeVerifier;
  }

  async saveState(state: string): Promise<void> {
    await auth.updateOAuthState(this.mcpName, state);
  }

  async state(): Promise<string> {
    const stored = await auth.getAuthForUrl(this.mcpName, this.serverUrl);
    if (stored?.oauthState) {
      return stored.oauthState;
    }
    const newState = crypto.randomUUID();
    await this.saveState(newState);
    return newState;
  }

  async invalidateCredentials(type: 'all' | 'client' | 'tokens'): Promise<void> {
    if (type === 'all') {
      await auth.removeAuth(this.mcpName);
      return;
    }
    if (type === 'client') {
      const stored = await auth.getAuthForUrl(this.mcpName, this.serverUrl);
      if (stored) {
        const { clientInfo: _clientInfo, ...rest } = stored;
        await auth.setAuth(this.mcpName, rest, this.serverUrl);
      }
      return;
    }
    if (type === 'tokens') {
      const stored = await auth.getAuthForUrl(this.mcpName, this.serverUrl);
      if (stored) {
        const { tokens: _tokens, ...rest } = stored;
        await auth.setAuth(this.mcpName, rest, this.serverUrl);
      }
      return;
    }
  }
}

export { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH };
