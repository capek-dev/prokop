// Transport HTTP auth middleware (Bearer or query token)
import type { Context, Next } from 'hono';
import { validateToken, isAuthEnabled } from './token';

/**
 * Middleware to require API key authentication
 * Use on protected routes
 *
 * Token can be provided via:
 * - Authorization: Bearer <token> header
 * - ?token=<token> query parameter
 */
export async function requireAuth(c: Context, next: Next) {
  if (!isAuthEnabled()) {
    return await next();
  }

  const authHeader = c.req.header('Authorization');
  const queryToken = c.req.query('token');

  let token: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (queryToken) {
    token = queryToken;
  }

  if (!validateToken(token)) {
    return c.json({
      error: 'Unauthorized',
      message: 'Invalid or missing API token',
      hint: 'Include token in Authorization header: "Bearer <token>" or query param: ?token=<token>'
    }, 401);
  }

  await next();
}

/**
 * Optional auth middleware
 * Validates if present but doesn't require it
 * Sets 'authenticated' context variable for downstream handlers
 */
export async function optionalAuth(c: Context, next: Next) {
  if (!isAuthEnabled()) {
    c.set('authenticated', true);
    return await next();
  }

  const authHeader = c.req.header('Authorization');
  const queryToken = c.req.query('token');

  let token: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (queryToken) {
    token = queryToken;
  }

  if (validateToken(token)) {
    c.set('authenticated', true);
  } else {
    c.set('authenticated', false);
  }

  await next();
}

/**
 * Routes that don't require authentication
 * Used for health checks, monitoring, and public info
 */
export const PUBLIC_ROUTES = [
  '/',              // Root health check
  '/api/health',    // Health check endpoint
  '/api/info',      // Server info endpoint
];

/**
 * Check if a path is public (doesn't require auth)
 */
export function isPublicRoute(path: string): boolean {
  if (PUBLIC_ROUTES.includes(path)) return true;
  return /^\/api\/sessions\/[^/]+\/attachments\/[^/]+\/content$/.test(path);
}
