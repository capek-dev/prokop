import type {
  CodexProviderConfig,
  OAuthProviderConfig,
  ProviderStatus,
} from '@prokopai/sdk';

/**
 * Provider-accounts domain: OAuth 2.0 + PKCE flow policy.
 *
 * Pure policy for the OAuth flows: PKCE generation, state and flow id
 * generation, authorization URL construction, token exchange and refresh
 * request parameters, refresh error shaping, OAuth error body parsing,
 * JWT id-token claim extraction, and the per-provider token config records.
 * The network calls, pending-flow tracking, localhost callback servers, and
 * broadcasts stay in `providers/oauth-manager.ts`; the manager consumes
 * these rules. No transport, filesystem, network, or Capek imports.
 */

export const OAUTH_FLOW_TIMEOUT_MS = 5 * 60 * 1000;
export const OAUTH_DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
export const CODEX_OAUTH_DUMMY_KEY = 'codex-oauth-dummy-key';

const RANDOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export interface OAuthTokenRefreshErrorData {
  providerId: string;
  status: number;
  code?: string;
  description?: string;
}

export class OAuthTokenRefreshError extends Error {
  readonly providerId: string;
  readonly status: number;
  readonly code?: string;
  readonly description?: string;

  constructor({ providerId, status, code, description }: OAuthTokenRefreshErrorData) {
    const details = [code, description].filter(Boolean).join(': ');
    super(`Token refresh failed for ${providerId}: ${status}${details ? ` - ${details}` : ''}`);
    this.name = 'OAuthTokenRefreshError';
    this.providerId = providerId;
    this.status = status;
    this.code = code;
    this.description = description;
  }
}

/** Parse an OAuth error response body without exposing raw upstream text
 * when the body is not JSON. */
export function parseOAuthErrorBody(
  text: string,
): { code?: string; description?: string } {
  try {
    const errorBody = JSON.parse(text) as unknown;
    if (typeof errorBody === 'object' && errorBody !== null) {
      const errorRecord = errorBody as Record<string, unknown>;
      return {
        code: typeof errorRecord.error === 'string' ? errorRecord.error : undefined,
        description: typeof errorRecord.error_description === 'string'
          ? errorRecord.error_description
          : undefined,
      };
    }
  } catch {
    // Ignore non-JSON error bodies.
  }
  return {};
}

export function base64UrlEncode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return Buffer.from(binary, 'binary')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function generateRandomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => RANDOM_ALPHABET[b % RANDOM_ALPHABET.length])
    .join('');
}

export interface PkceCodes {
  verifier: string;
  challenge: string;
}

export async function generatePkceCodes(): Promise<PkceCodes> {
  const verifier = generateRandomString(43);
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const challenge = base64UrlEncode(new Uint8Array(hash));
  return { verifier, challenge };
}

export function generateOAuthState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export function generateOAuthFlowId(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

/** Build the authorization URL with the exact pre-domain parameter order. */
export function buildAuthorizationUrl(
  config: OAuthProviderConfig,
  state: string,
  challenge: string,
): URL {
  const authorizationUrl = new URL(config.authorizeUrl);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', config.clientId);
  authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizationUrl.searchParams.set('scope', config.scopes);
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('code_challenge', challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');

  if (config.extraAuthParams) {
    for (const [key, value] of Object.entries(config.extraAuthParams)) {
      authorizationUrl.searchParams.set(key, value);
    }
  }

  return authorizationUrl;
}

export function buildTokenExchangeParams(
  config: OAuthProviderConfig,
  code: string,
  redirectUri: string,
  verifier: string,
): Record<string, string> {
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  };
  if (config.clientSecret) {
    params.client_secret = config.clientSecret;
  }
  return params;
}

export function buildTokenRefreshParams(
  config: OAuthProviderConfig,
  refreshToken: string,
): Record<string, string> {
  const params: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
  };
  if (config.clientSecret) {
    params.client_secret = config.clientSecret;
  }
  return params;
}

// ── JWT id-token extraction ──────────────────────────────────

interface CodexIdTokenClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  email?: string;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
  };
}

export function parseIdTokenClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function extractCodexAccountId(
  claims: Record<string, unknown> | undefined,
): string | undefined {
  if (!claims) return undefined;
  const codex = claims as unknown as CodexIdTokenClaims;
  return (
    codex.chatgpt_account_id ||
    codex['https://api.openai.com/auth']?.chatgpt_account_id ||
    codex.organizations?.[0]?.id
  );
}

// ── Token config records ─────────────────────────────────────

export interface OAuthTokenSet {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  id_token?: string;
}

export function tokenExpiryMs(tokens: OAuthTokenSet, now: number): number {
  return now + (tokens.expires_in ?? OAUTH_DEFAULT_TOKEN_LIFETIME_SECONDS) * 1000;
}

export function buildCodexConfig(
  tokens: OAuthTokenSet,
  now: number,
): CodexProviderConfig {
  const accountId = tokens.id_token
    ? extractCodexAccountId(parseIdTokenClaims(tokens.id_token))
    : undefined;
  return {
    type: 'oauth',
    provider: 'codex',
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: tokenExpiryMs(tokens, now),
    ...(accountId && { accountId }),
    connectedAt: new Date(now).toISOString(),
  };
}

/** Codex refresh application: replace the token fields, update the account
 * id when a new id_token is present, keep the rest of the record. */
export function applyCodexRefresh(
  config: CodexProviderConfig,
  tokens: OAuthTokenSet,
  now: number,
): CodexProviderConfig {
  config.access = tokens.access_token;
  config.refresh = tokens.refresh_token;
  config.expires = tokenExpiryMs(tokens, now);

  if (tokens.id_token) {
    const accountId = extractCodexAccountId(parseIdTokenClaims(tokens.id_token));
    if (accountId) {
      config.accountId = accountId;
    }
  }
  return config;
}

// ── Provider status shaping ──────────────────────────────────

export function codexStatusFromConfig(
  config: CodexProviderConfig | null,
): ProviderStatus {
  if (!config) {
    return { provider: 'codex', connected: false };
  }
  return {
    provider: 'codex',
    connected: true,
    connectedAt: config.connectedAt,
    accountId: config.accountId,
  };
}

