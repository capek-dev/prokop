/**
 * Gmail OAuth service provider.
 *
 * Unlike LLM providers (Codex), Gmail is a data/action service (kind: 'service').
 * It does NOT implement createModel(). Instead, tools read the stored access token
 * directly from ~/.jean2/providers/gmail.json.
 *
 * A background timer proactively refreshes the access token before it expires,
 * so tools never need to handle token refresh logic.
 */
import type { GmailProviderConfig, ProviderStatus } from '@jean2/sdk';
import { broadcastEvent } from '@/core/broadcast';
import { registerProvider, type ConnectableProvider, type TokenResponse } from '@capekai/core/compat/jean2';
import { loadProviderConfig, saveProviderConfig, deleteProviderConfig } from './storage';
import {
  registerOAuthConfig,
  initiateOAuthFlow,
  refreshTokens,
  OAuthTokenRefreshError,
} from './oauth-manager';

const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_REDIRECT_URI = 'http://localhost:1455/oauth/gmail/callback';
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// Refresh the token when less than this much time remains before expiry.
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
// How often to check whether a refresh is needed.
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const REAUTH_REQUIRED_MESSAGE = 'Gmail authorization expired or was revoked. Reconnect Gmail to continue.';

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let isRefreshing = false;

function getClientId(): string {
  return process.env.JEAN2_GMAIL_CLIENT_ID || '';
}

function getClientSecret(): string {
  return process.env.JEAN2_GMAIL_CLIENT_SECRET || '';
}

// Register Gmail OAuth config. Credentials come from env vars.
// The config is re-registered if env vars become available later.
function registerGmailOAuthConfig(): void {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId) {
    // No credentials configured yet. The provider will show as available
    // but connect() will surface a helpful error.
    return;
  }

  registerOAuthConfig('gmail', {
    clientId,
    clientSecret: clientSecret || undefined,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: GMAIL_TOKEN_URL,
    scopes: GMAIL_SCOPES,
    redirectUri: GMAIL_REDIRECT_URI,
    extraAuthParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
  });
}

registerGmailOAuthConfig();

/**
 * Refresh the Gmail token if it's expired or about to expire.
 * Called proactively by the background timer and on demand.
 */
async function refreshGmailTokenIfNeeded(force = false): Promise<void> {
  if (isRefreshing) return;

  const config = loadProviderConfig<GmailProviderConfig>('gmail');
  if (!config || config.reauthRequired) return;

  const shouldRefresh = force || config.expires < Date.now() + REFRESH_BUFFER_MS;
  if (!shouldRefresh) return;

  isRefreshing = true;
  try {
    const tokens = await refreshTokens('gmail', config.refresh);
    config.access = tokens.access_token;
    // Google may rotate refresh tokens, so update if a new one is provided.
    if (tokens.refresh_token) {
      config.refresh = tokens.refresh_token;
    }
    config.expires = Date.now() + (tokens.expires_in ?? 3600) * 1000;
    delete config.reauthRequired;
    saveProviderConfig('gmail', config);
    console.debug('[gmail] Token refreshed proactively');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[gmail] Background token refresh failed:', message);

    if (err instanceof OAuthTokenRefreshError && err.code === 'invalid_grant') {
      config.reauthRequired = true;
      saveProviderConfig('gmail', config);
      stopBackgroundRefresh();
      broadcastEvent({
        type: 'provider.status',
        provider: 'gmail',
        connected: false,
        reauthRequired: true,
        error: REAUTH_REQUIRED_MESSAGE,
      });
    }
  } finally {
    isRefreshing = false;
  }
}

function startBackgroundRefresh(): void {
  if (refreshTimer) return;

  // Do an immediate refresh check on startup, then set the interval.
  void refreshGmailTokenIfNeeded();

  refreshTimer = setInterval(() => {
    void refreshGmailTokenIfNeeded();
  }, CHECK_INTERVAL_MS);
}

function stopBackgroundRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// Start background refresh if Gmail is already connected from a previous session.
const savedGmailConfig = loadProviderConfig<GmailProviderConfig>('gmail');
if (savedGmailConfig && !savedGmailConfig.reauthRequired) {
  startBackgroundRefresh();
}

const gmailProvider: ConnectableProvider = {
  descriptor: {
    id: 'gmail',
    displayName: 'Gmail',
    description: 'Read, search, summarize, and organize your Gmail inbox',
    authType: 'oauth',
    connectable: true,
    kind: 'service',
  },

  getStatus(): ProviderStatus {
    const config = loadProviderConfig<GmailProviderConfig>('gmail');
    if (!config) {
      return { provider: 'gmail', connected: false };
    }
    if (config.reauthRequired) {
      return {
        provider: 'gmail',
        connected: false,
        reauthRequired: true,
        error: REAUTH_REQUIRED_MESSAGE,
        connectedAt: config.connectedAt,
        displayName: 'Gmail',
        authType: 'oauth',
        connectable: true,
      };
    }
    return {
      provider: 'gmail',
      connected: true,
      connectedAt: config.connectedAt,
      displayName: 'Gmail',
      authType: 'oauth',
      connectable: true,
    };
  },

  async connect(options) {
    // Ensure config is registered (env vars may have been set since startup).
    registerGmailOAuthConfig();

    if (!getClientId()) {
      throw new Error(
        'Gmail OAuth credentials not configured. Set JEAN2_GMAIL_CLIENT_ID and JEAN2_GMAIL_CLIENT_SECRET environment variables.',
      );
    }

    const result = await initiateOAuthFlow('gmail', options?.redirectStrategy);
    return {
      authorizationUrl: result.authorizationUrl,
      flowId: result.flowId,
      redirectStrategy: result.redirectStrategy,
      redirectUri: result.redirectUri,
    };
  },

  async disconnect() {
    stopBackgroundRefresh();
    deleteProviderConfig('gmail');
  },

  async onTokensReceived(tokens: TokenResponse): Promise<void> {
    // Extract email from the id_token JWT payload if present.
    let email: string | undefined;
    if (tokens.id_token) {
      try {
        const parts = tokens.id_token.split('.');
        if (parts.length === 3) {
          const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
          email = claims.email;
        }
      } catch {
        // id_token parsing is best-effort.
      }
    }

    const config: GmailProviderConfig = {
      type: 'oauth',
      provider: 'gmail',
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      ...(email && { email }),
      connectedAt: new Date().toISOString(),
    };
    saveProviderConfig('gmail', config);
    startBackgroundRefresh();
  },
};

registerProvider(gmailProvider);
