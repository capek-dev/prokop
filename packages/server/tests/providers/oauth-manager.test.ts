import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  OAuthTokenRefreshError,
  refreshTokens,
  registerOAuthConfig,
} from '@/infrastructure/oauth/oauth-manager';

const originalFetch = globalThis.fetch;

describe('OAuth token refresh errors', () => {
  beforeEach(() => {
    registerOAuthConfig('test-provider', {
      clientId: 'client-id',
      authorizeUrl: 'https://example.com/authorize',
      tokenUrl: 'https://example.com/token',
      scopes: 'test.scope',
      redirectUri: 'http://localhost/callback',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('exposes structured OAuth error details', async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;

    try {
      await refreshTokens('test-provider', 'refresh-token');
      throw new Error('Expected refreshTokens to reject');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(OAuthTokenRefreshError);
      const refreshError = err as OAuthTokenRefreshError;
      expect(refreshError.providerId).toBe('test-provider');
      expect(refreshError.status).toBe(400);
      expect(refreshError.code).toBe('invalid_grant');
      expect(refreshError.description).toBe('Token has been expired or revoked.');
    }
  });

  test('does not expose a non-JSON response body', async () => {
    globalThis.fetch = mock(async () => new Response('upstream unavailable', {
      status: 503,
    })) as unknown as typeof fetch;

    try {
      await refreshTokens('test-provider', 'refresh-token');
      throw new Error('Expected refreshTokens to reject');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(OAuthTokenRefreshError);
      const refreshError = err as OAuthTokenRefreshError;
      expect(refreshError.status).toBe(503);
      expect(refreshError.code).toBeUndefined();
      expect(refreshError.description).toBeUndefined();
      expect(refreshError.message).not.toContain('upstream unavailable');
    }
  });
});
