/**
 * Generalized OAuth 2.0 + PKCE flow manager.
 *
 * Owns: PKCE generation, state, pending flow tracking, token exchange, token refresh.
 * Each OAuth provider registers its config (clientId, endpoints, scopes).
 * The client-side handles receiving the redirect and posting the code back.
 */
import type { OAuthProviderConfig, OAuthRedirectStrategy } from '@jean2/sdk';
import { broadcastEvent } from '@/transport/websocket/broadcast';
import { getProvider, getProviderStatus, type TokenResponse } from '@/adapters/capek/contracts';
import {
  buildAuthorizationUrl,
  buildTokenExchangeParams,
  buildTokenRefreshParams,
  generateOAuthFlowId,
  generateOAuthState,
  generatePkceCodes,
  OAUTH_FLOW_TIMEOUT_MS,
  OAuthTokenRefreshError,
  parseOAuthErrorBody,
  type PkceCodes,
} from '@/domains/provider-accounts';
import { OAuthFlowState } from './oauth-flow-state';

export {
  OAuthTokenRefreshError,
} from '@/domains/provider-accounts';

const oauthState = new OAuthFlowState({
  handleLocalhostCallback,
});
const oauthConfigs = oauthState.configs;
const pendingFlows = oauthState.pending;

/**
 * Register an OAuth configuration for a provider.
 * Call this once at startup for each OAuth-based provider.
 */
export function registerOAuthConfig(providerId: string, config: OAuthProviderConfig): void {
  oauthConfigs.set(providerId, config);
}

/**
 * Get the registered redirect URI for a provider.
 */
export function getDefaultRedirectUri(providerId: string): string {
  const config = oauthConfigs.get(providerId);
  return config?.redirectUri ?? `http://localhost:1455/oauth/${providerId}/callback`;
}


/**
 * Handle a callback received by the localhost server.
 * Matches the state parameter to find the pending flow, then completes it.
 */
async function handleLocalhostCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    const errorMsg = errorDescription || error;
    for (const [flowId, flow] of pendingFlows) {
      if (flow.state === state) {
        broadcastEvent({
          type: 'provider.status',
          provider: flow.providerId,
          connected: false,
          error: errorMsg,
        });
        clearTimeout(flow.timeout);
        pendingFlows.delete(flowId);
        break;
      }
    }
    return new Response(htmlError(errorMsg), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!code || !state) {
    return new Response(htmlError('Missing authorization code or state'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Find the pending flow by state
  let matchedFlowId: string | undefined;
  for (const [flowId, flow] of pendingFlows) {
    if (flow.state === state) {
      matchedFlowId = flowId;
      break;
    }
  }

  if (!matchedFlowId) {
    return new Response(htmlError('Invalid state — no matching OAuth flow'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const flow = pendingFlows.get(matchedFlowId);
    const redirectUri = flow?.redirectUri ?? '';
    const result = await completeOAuthFlow(matchedFlowId, code, state, redirectUri);
    oauthState.stopLocalServerForPath(redirectUri);
    void result;
    return new Response(HTML_SUCCESS, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token exchange failed';
    return new Response(htmlError(message), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

/**
 * Initiate an OAuth flow for a provider.
 * Returns the authorization URL, flow ID, and redirect info.
 */
export async function initiateOAuthFlow(
  providerId: string,
  redirectStrategy: OAuthRedirectStrategy = 'client_redirect',
): Promise<{
  authorizationUrl: string;
  flowId: string;
  redirectStrategy: OAuthRedirectStrategy;
  redirectUri: string;
}> {
  const config = oauthConfigs.get(providerId);
  if (!config) {
    throw new Error(`No OAuth configuration registered for provider: ${providerId}`);
  }

  const pkce = await generatePkceCodes();
  const state = generateOAuthState();
  const flowId = generateOAuthFlowId();

  const redirectUri = config.redirectUri;

  // For localhost redirect URIs, start a local callback server
  if (redirectStrategy === 'client_redirect') {
    oauthState.ensureLocalServer(redirectUri);
  }

  const authorizationUrl = buildAuthorizationUrl(config, state, pkce.challenge);

  const timeout = setTimeout(() => {
    pendingFlows.delete(flowId);
  }, OAUTH_FLOW_TIMEOUT_MS);

  pendingFlows.set(flowId, {
    providerId,
    state,
    pkce,
    redirectUri,
    timeout,
  });

  return {
    authorizationUrl: authorizationUrl.toString(),
    flowId,
    redirectStrategy,
    redirectUri,
  };
}

/**
 * Complete an OAuth flow by exchanging the authorization code for tokens.
 * Called when the client posts the code back to the server.
 */
export async function completeOAuthFlow(
  flowId: string,
  code: string,
  state: string,
  redirectUri: string,
): Promise<{ providerId: string }> {
  const flow = pendingFlows.get(flowId);
  if (!flow) {
    throw new Error('Unknown or expired OAuth flow');
  }

  if (state !== flow.state) {
    pendingFlows.delete(flowId);
    clearTimeout(flow.timeout);
    throw new Error('State mismatch — potential CSRF attack');
  }

  const config = oauthConfigs.get(flow.providerId);
  if (!config) {
    throw new Error(`No OAuth configuration for provider: ${flow.providerId}`);
  }

  clearTimeout(flow.timeout);
  pendingFlows.delete(flowId);

  let tokens: TokenResponse;
  try {
    tokens = await exchangeCodeForTokens(config, code, redirectUri, flow.pkce);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token exchange failed';
    broadcastEvent({
      type: 'provider.status',
      provider: flow.providerId,
      connected: false,
      error: message,
    });
    throw err;
  }

  const provider = getProvider(flow.providerId);
  if (provider) {
    try {
      await provider.onTokensReceived(tokens);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Token persistence failed';
      broadcastEvent({
        type: 'provider.status',
        provider: flow.providerId,
        connected: false,
        error: message,
      });
      throw err;
    }
  }

  const status = getProviderStatus(flow.providerId);
  broadcastEvent({
    type: 'provider.connected',
    provider: flow.providerId,
    connected: status.connected,
    connectedAt: status.connectedAt,
    accountId: status.accountId,
  });

  return { providerId: flow.providerId };
}

/**
 * Handle a direct server callback (when the server has a public URL).
 * Returns HTML response for the browser.
 */
export async function handleServerCallback(
  providerId: string,
  url: URL,
): Promise<Response> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    const errorMsg = errorDescription || error;
    broadcastEvent({
      type: 'provider.status',
      provider: providerId,
      connected: false,
      error: errorMsg,
    });
    return new Response(htmlError(errorMsg), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!code) {
    broadcastEvent({
      type: 'provider.status',
      provider: providerId,
      connected: false,
      error: 'Missing authorization code',
    });
    return new Response(htmlError('Missing authorization code'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Find the pending flow by state for this provider
  let matchedFlowId: string | undefined;
  for (const [flowId, flow] of pendingFlows) {
    if (flow.providerId === providerId && flow.state === state) {
      matchedFlowId = flowId;
      break;
    }
  }

  if (!matchedFlowId) {
    return new Response(htmlError('Invalid state — no matching OAuth flow'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    await completeOAuthFlow(matchedFlowId, code, state!, getDefaultRedirectUri(providerId));
    return new Response(HTML_SUCCESS, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token exchange failed';
    return new Response(htmlError(message), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

/**
 * Refresh an access token using a refresh token.
 */
export function disposeOAuthFlows(): void {
  oauthState.dispose();
}

export async function refreshTokens(
  providerId: string,
  refreshToken: string,
): Promise<TokenResponse> {
  const config = oauthConfigs.get(providerId);
  if (!config) {
    throw new Error(`No OAuth configuration for provider: ${providerId}`);
  }

  const refreshParams = buildTokenRefreshParams(config, refreshToken);

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(refreshParams).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const { code, description } = parseOAuthErrorBody(errorText);

    throw new OAuthTokenRefreshError({
      providerId,
      status: response.status,
      code,
      description,
    });
  }

  return response.json() as Promise<TokenResponse>;
}

async function exchangeCodeForTokens(
  config: OAuthProviderConfig,
  code: string,
  redirectUri: string,
  pkce: PkceCodes,
): Promise<TokenResponse> {
  const exchangeParams = buildTokenExchangeParams(config, code, redirectUri, pkce.verifier);

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(exchangeParams).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<TokenResponse>;
}

const HTML_SUCCESS = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connected Successfully</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f0f17; color: #e4e4e7;">
  <div style="background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 48px 40px; max-width: 420px; width: calc(100% - 48px); text-align: center; box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);">
    <div style="width: 64px; height: 64px; margin: 0 auto 24px; background: #052e16; border: 1px solid #14532d; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </div>
    <h1 style="font-size: 22px; font-weight: 600; color: #f4f4f5; margin: 0 0 8px;">Connected Successfully</h1>
    <p style="font-size: 15px; color: #a1a1aa; margin: 0; line-height: 1.5;">You can close this window and return to jean2.</p>
  </div>
</body>
</html>`;

function htmlError(message: string): string {
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connection Failed</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f0f17; color: #e4e4e7;">
  <div style="background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 48px 40px; max-width: 420px; width: calc(100% - 48px); text-align: center; box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);">
    <div style="width: 64px; height: 64px; margin: 0 auto 24px; background: #450a0a; border: 1px solid #7f1d1d; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </div>
    <h1 style="font-size: 22px; font-weight: 600; color: #f4f4f5; margin: 0 0 8px;">Connection Failed</h1>
    <p style="font-size: 15px; color: #a1a1aa; margin: 0 0 8px; line-height: 1.5; word-break: break-word;">${escaped}</p>
    <p style="font-size: 15px; color: #a1a1aa; margin: 0; line-height: 1.5;">Please try again.</p>
  </div>
</body>
</html>`;
}
