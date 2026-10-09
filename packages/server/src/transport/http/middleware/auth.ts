// Transport HTTP auth middleware (principal resolution and admin checks)
import type { Context, Next } from 'hono';
import { isAdminPrincipal, type AccessPrincipal } from '@/application/device-access/service';
import {
  readRequestAuthInput,
  resolveRequestPrincipal,
  type RequestAuthDeps,
} from '@/transport/http/request-auth';

/**
 * Bindings the server passes to `app.fetch`. The listener resolves the
 * principal once per request because it knows the socket peer. In-process
 * calls (`app.request` in tests) omit it and are resolved here as same-machine.
 */
export interface RequestAuthBindings {
  principal?: AccessPrincipal | null;
}

const PRINCIPAL_KEY = 'principal';

export function getRequestPrincipal(c: Context): AccessPrincipal | null {
  return (c.get(PRINCIPAL_KEY) as AccessPrincipal | null | undefined) ?? null;
}

export function createAuthMiddleware(deps: RequestAuthDeps) {
  return async function authMiddleware(c: Context, next: Next) {
    const bindings = c.env as RequestAuthBindings | undefined;
    const principal = bindings && 'principal' in bindings
      ? bindings.principal ?? null
      : resolveRequestPrincipal(readRequestAuthInput(c.req.raw, null, false), deps);
    c.set(PRINCIPAL_KEY, principal);

    if (principal === null && !isPublicRoute(c.req.path)) {
      return c.json({
        error: 'Unauthorized',
        reason: 'pairing-required',
        message: 'This device is not paired with this server.',
      }, 401);
    }
    await next();
  };
}

/** Responds 403 unless the caller administers access (same machine, shared token, or auth off). */
export function requireAdmin(c: Context): Response | null {
  const principal = getRequestPrincipal(c);
  if (principal && isAdminPrincipal(principal)) return null;
  return c.json({ error: 'Forbidden', message: 'Only this server\'s own machine can manage device access.' }, 403);
}

/**
 * Routes that don't require authentication
 * Used for health checks, monitoring, public info, and pairing a new device
 */
export const PUBLIC_ROUTES = [
  '/',              // Root health check
  '/api/health',    // Health check endpoint
  '/api/info',      // Server info endpoint
  '/api/mcp/oauth/callback', // Validated by expiring, single-use OAuth state.
  '/api/auth/status',        // Reports whether this device is paired.
  '/api/auth/pair',          // Validated by a one-time pairing code.
  '/api/auth/requests',      // Creates an approval request; grants nothing by itself.
];

/**
 * Check if a path is public (doesn't require auth)
 */
export function isPublicRoute(path: string): boolean {
  if (PUBLIC_ROUTES.includes(path)) return true;
  // Waiting for an approval decision is validated by the request's secret.
  if (/^\/api\/auth\/requests\/[^/]+\/events$/.test(path)) return true;
  return /^\/api\/sessions\/[^/]+\/attachments\/[^/]+\/content$/.test(path);
}
