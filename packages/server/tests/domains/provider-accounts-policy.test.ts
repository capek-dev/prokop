import { describe, expect, test } from 'bun:test';
import type { CodexProviderConfig, GmailProviderConfig } from '@jean2/sdk';
import {
  applyCodexRefresh,
  applyGmailRefresh,
  buildAuthorizationUrl,
  buildCodexConfig,
  buildGmailConfig,
  buildTokenExchangeParams,
  buildTokenRefreshParams,
  codexStatusFromConfig,
  extractCodexAccountId,
  extractEmailFromIdToken,
  generateOAuthState,
  generatePkceCodes,
  GMAIL_REAUTH_REQUIRED_MESSAGE,
  gmailStatusFromConfig,
  OAUTH_FLOW_TIMEOUT_MS,
  OAuthTokenRefreshError,
  parseIdTokenClaims,
  parseOAuthErrorBody,
  tokenExpiryMs,
} from '@/domains/provider-accounts';
import {
  API_KEY_EMPTY_ERROR,
  credentialStatus,
  getSupportedProviderCredential,
  mergeEnvLine,
  PROVIDER_CREDENTIALS,
  removeEnvLine,
  validateApiKeyValue,
} from '@/domains/provider-accounts';

const oauthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  authorizeUrl: 'https://example.com/authorize',
  tokenUrl: 'https://example.com/token',
  scopes: 'openid profile',
  redirectUri: 'http://localhost:1455/auth/callback',
  extraAuthParams: { prompt: 'consent', originator: 'jean2' },
};

function idToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('provider-accounts domain: OAuth flow policy', () => {
  test('generates PKCE codes, state, and flow ids with the pinned shapes', async () => {
    const pkce = await generatePkceCodes();
    expect(pkce.verifier).toHaveLength(43);
    expect(pkce.challenge.length).toBeGreaterThan(20);
    expect(pkce.challenge).not.toContain('=');

    const state = generateOAuthState();
    expect(state.length).toBeGreaterThan(20);
    expect(OAUTH_FLOW_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  test('builds the authorization URL with the exact parameter set and extra params', () => {
    const url = buildAuthorizationUrl(oauthConfig, 'state-abc', 'challenge-xyz');
    expect(url.origin + url.pathname).toBe('https://example.com/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
    expect(url.searchParams.get('scope')).toBe('openid profile');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-xyz');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('originator')).toBe('jean2');
  });

  test('builds exchange and refresh params with conditional client secret', () => {
    expect(buildTokenExchangeParams(oauthConfig, 'code', 'http://cb', 'verifier')).toEqual({
      grant_type: 'authorization_code',
      code: 'code',
      redirect_uri: 'http://cb',
      client_id: 'client-id',
      code_verifier: 'verifier',
      client_secret: 'client-secret',
    });
    expect(buildTokenExchangeParams({ ...oauthConfig, clientSecret: undefined }, 'code', 'http://cb', 'v'))
      .not.toHaveProperty('client_secret');

    expect(buildTokenRefreshParams(oauthConfig, 'refresh')).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh',
      client_id: 'client-id',
      client_secret: 'client-secret',
    });
  });

  test('parses OAuth error bodies and shapes the refresh error exactly', () => {
    expect(parseOAuthErrorBody(JSON.stringify({ error: 'invalid_grant', error_description: 'expired' })))
      .toEqual({ code: 'invalid_grant', description: 'expired' });
    expect(parseOAuthErrorBody('upstream unavailable')).toEqual({});
    expect(parseOAuthErrorBody('')).toEqual({});

    const error = new OAuthTokenRefreshError({ providerId: 'gmail', status: 400, code: 'invalid_grant', description: 'x' });
    expect(error.name).toBe('OAuthTokenRefreshError');
    expect(error.message).toBe('Token refresh failed for gmail: 400 - invalid_grant: x');
    expect(error.providerId).toBe('gmail');
    expect(error.status).toBe(400);
  });

  test('parses id tokens and extracts codex account ids and gmail emails', () => {
    const token = idToken({
      chatgpt_account_id: 'acct-1',
      email: 'user@example.com',
      organizations: [{ id: 'org-1' }],
    });
    const claims = parseIdTokenClaims(token);
    expect(claims?.email).toBe('user@example.com');
    expect(extractCodexAccountId(claims)).toBe('acct-1');
    expect(extractEmailFromIdToken(token)).toBe('user@example.com');

    expect(extractCodexAccountId(parseIdTokenClaims(idToken({
      'https://api.openai.com/auth': { chatgpt_account_id: 'auth-acct' },
    })))).toBe('auth-acct');
    expect(extractCodexAccountId(parseIdTokenClaims(idToken({ organizations: [{ id: 'org-only' }] })))).toBe('org-only');
    expect(extractCodexAccountId(undefined)).toBeUndefined();
    expect(parseIdTokenClaims('not-a-jwt')).toBeUndefined();
    expect(extractEmailFromIdToken('broken')).toBeUndefined();
  });

  test('builds and refreshes codex and gmail token configs', () => {
    const now = 1_000_000;
    const codex = buildCodexConfig({
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 1200,
      id_token: idToken({ chatgpt_account_id: 'acct' }),
    }, now);
    expect(codex).toMatchObject({
      type: 'oauth',
      provider: 'codex',
      access: 'a',
      refresh: 'r',
      expires: tokenExpiryMs({ access_token: 'a', refresh_token: 'r', expires_in: 1200 }, now),
      accountId: 'acct',
      connectedAt: new Date(now).toISOString(),
    });

    const refreshedCodex = applyCodexRefresh(
      { ...codex, accountId: 'old' },
      { access_token: 'a2', refresh_token: 'r2', id_token: idToken({ chatgpt_account_id: 'new-acct' }) },
      now + 1000,
    );
    expect(refreshedCodex.accountId).toBe('new-acct');
    expect(refreshedCodex.access).toBe('a2');

    const gmail = buildGmailConfig({
      access_token: 'g',
      refresh_token: 'gr',
      id_token: idToken({ email: 'me@example.com' }),
    }, now);
    expect(gmail).toMatchObject({ provider: 'gmail', email: 'me@example.com' });

    const refreshedGmail = applyGmailRefresh(
      { ...gmail, reauthRequired: true },
      { access_token: 'g2', refresh_token: 'gr2' },
      now,
    );
    expect(refreshedGmail.access).toBe('g2');
    expect(refreshedGmail.refresh).toBe('gr2');
    expect(refreshedGmail.reauthRequired).toBeUndefined();
  });

  test('shapes codex and gmail statuses from config records', () => {
    expect(codexStatusFromConfig(null)).toEqual({ provider: 'codex', connected: false });
    expect(codexStatusFromConfig({
      type: 'oauth', provider: 'codex', access: 'a', refresh: 'r', expires: 1,
      connectedAt: 't', accountId: 'acct',
    } as CodexProviderConfig)).toEqual({ provider: 'codex', connected: true, connectedAt: 't', accountId: 'acct' });

    expect(gmailStatusFromConfig(null)).toEqual({ provider: 'gmail', connected: false });
    expect(gmailStatusFromConfig({
      type: 'oauth', provider: 'gmail', access: 'a', refresh: 'r', expires: 1, connectedAt: 't', reauthRequired: true,
    } as GmailProviderConfig)).toEqual({
      provider: 'gmail',
      connected: false,
      reauthRequired: true,
      error: GMAIL_REAUTH_REQUIRED_MESSAGE,
      connectedAt: 't',
      displayName: 'Gmail',
      authType: 'oauth',
      connectable: true,
    });
  });
});

describe('provider-accounts domain: credential policy', () => {
  test('pins the supported credential registry and lookup', () => {
    expect(PROVIDER_CREDENTIALS).toHaveLength(6);
    expect(getSupportedProviderCredential('openai')).toEqual({
      provider: 'openai',
      envKey: 'JEAN2_LLM_OPENAI_API_KEY',
    });
    expect(getSupportedProviderCredential('ghost')).toBeUndefined();
  });

  test('validates api keys with the exact message', () => {
    expect(validateApiKeyValue('  key  ')).toBeNull();
    expect(validateApiKeyValue('   ')).toBe(API_KEY_EMPTY_ERROR);
    expect(validateApiKeyValue('')).toBe(API_KEY_EMPTY_ERROR);
  });

  test('merges and removes env lines with the exact policy', () => {
    const content = '# comment\nJEAN2_LLM_OPENAI_API_KEY=old\nJEAN2_LLM_DEEPSEEK_API_KEY=keep';

    const merged = mergeEnvLine(content, 'JEAN2_LLM_OPENAI_API_KEY', 'new');
    expect(merged.keyFound).toBe(true);
    expect(merged.content).toBe('# comment\nJEAN2_LLM_OPENAI_API_KEY=new\nJEAN2_LLM_DEEPSEEK_API_KEY=keep\n');

    const appended = mergeEnvLine(content, 'JEAN2_LLM_MINIMAX_API_KEY', 'mini');
    expect(appended.keyFound).toBe(false);
    expect(appended.content).toBe(content + '\nJEAN2_LLM_MINIMAX_API_KEY=mini\n');

    expect(removeEnvLine(content, 'JEAN2_LLM_OPENAI_API_KEY')).toBe(
      '# comment\nJEAN2_LLM_DEEPSEEK_API_KEY=keep\n',
    );
    expect(removeEnvLine(null, 'X')).toBe('');
  });

  test('builds credential status records', () => {
    expect(credentialStatus('openai', true)).toEqual({ provider: 'openai', configured: true });
    expect(credentialStatus('openai', false)).toEqual({ provider: 'openai', configured: false });
  });
});
