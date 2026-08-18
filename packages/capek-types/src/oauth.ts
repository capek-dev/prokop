/**
 * Generalized OAuth 2.0 + PKCE types for provider authentication.
 *
 * Flow:
 * 1. Client calls POST /api/providers/:id/connect
 * 2. Server generates PKCE + state, stores pending flow, returns { authorizationUrl, flowId }
 * 3. Client opens authorizationUrl in browser
 * 4. After user authenticates, the redirect arrives at one of:
 *    a. Client-side localhost listener (client receives code)
 *    b. User manually pastes the redirect URL (manual paste fallback)
 *    c. Server-side callback route (cloud-hosted server with public URL)
 * 5. Client sends the authorization code to server via POST /api/oauth/callback
 * 6. Server exchanges code + PKCE verifier for tokens, stores them, notifies client via WS
 */

/** OAuth 2.0 redirect strategy — determines where the OAuth provider redirects after auth. */
export type OAuthRedirectStrategy =
  | 'client_redirect'    // Client starts a localhost HTTP server to receive the callback
  | 'manual_paste'       // User copies the redirect URL from browser and pastes into UI
  | 'server_callback';   // Server has a public URL and receives the callback directly

/** Configuration for an OAuth 2.0 provider (PKCE + authorization code flow). */
export interface OAuthProviderConfig {
  /** OAuth 2.0 client ID registered with the provider. */
  clientId: string;
  /** OAuth 2.0 client secret (required by some providers like Google). */
  clientSecret?: string;
  /** OAuth 2.0 authorization endpoint. */
  authorizeUrl: string;
  /** OAuth 2.0 token endpoint. */
  tokenUrl: string;
  /** OAuth 2.0 scopes (space-separated). */
  scopes: string;
  /** The redirect URI registered with the OAuth provider. Must match exactly. */
  redirectUri: string;
  /** Additional parameters to include in the authorization URL. */
  extraAuthParams?: Record<string, string>;
}

/** Response from POST /api/providers/:id/connect when authType is 'oauth'. */
export interface OAuthConnectResult {
  /** URL the user must open in their browser to authenticate. */
  authorizationUrl: string;
  /** Unique flow ID to correlate the callback. */
  flowId: string;
  /** The redirect strategy the server expects. */
  redirectStrategy: OAuthRedirectStrategy;
  /** The redirect URI used in the authorization request (client needs this for localhost listener). */
  redirectUri: string;
}

/** Request body for POST /api/oauth/callback — client sends the auth code. */
export interface OAuthCallbackRequest {
  /** The flow ID from the connect response. */
  flowId: string;
  /** The authorization code from the OAuth redirect. */
  code: string;
  /** The state parameter from the OAuth redirect (for CSRF validation). */
  state: string;
  /** The redirect URI that was used (must match the one in the authorization request). */
  redirectUri: string;
}

/** Response from POST /api/oauth/callback. */
export interface OAuthCallbackResponse {
  success: boolean;
  provider?: string;
  error?: string;
}
