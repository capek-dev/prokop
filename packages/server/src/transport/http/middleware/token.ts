// Transport HTTP auth token validation (env-var based)

/**
 * Auth token management — env-var only.
 *
 * Set JEAN2_AUTH_TOKEN to enable authentication.
 * When set, all /api/* routes (except public ones) require this token
 * via Authorization: Bearer <token> or ?token=<token>.
 *
 * When not set, auth is disabled (all requests pass through).
 */

export function isAuthEnabled(): boolean {
  return !!process.env.JEAN2_AUTH_TOKEN;
}

export function validateToken(providedToken: string | null | undefined): boolean {
  if (!providedToken) {
    return false;
  }

  const expected = process.env.JEAN2_AUTH_TOKEN;
  if (!expected) {
    return false;
  }

  if (providedToken.length !== expected.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < providedToken.length; i++) {
    result |= providedToken.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}
