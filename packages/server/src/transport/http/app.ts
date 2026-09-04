/**
 * Hono Application Setup
 *
 * HTTP transport composition: middleware, route registration, and error
 * presentation. Route handlers live in transport/http/routes/ modules.
 */

import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { ZodError } from 'zod';

import { requireAuth, isPublicRoute } from '@/transport/http/middleware/auth';
import { isAuthEnabled } from '@/transport/http/middleware/token';
import {
  createClientAssetResponse,
  getEmbeddedClientAssetsRoot,
  hasClientAssets,
} from '@/infrastructure/runtime/client-assets';
import { getClientEnabled } from '@/infrastructure/runtime/environment';
import { readEnv } from '@/infrastructure/runtime/env-compat';
import { VERSION } from '@/version';
import { HttpError } from '@/application/http-errors';
import { createWiredApplication, type WiredApplication } from '@/bootstrap/application';

// Route modules
import { registerSessionRoutes } from '@/transport/http/routes/sessions';
import { registerWorkspaceRoutes } from '@/transport/http/routes/workspaces';
import { registerWorktreeRoutes } from '@/transport/http/routes/worktrees';
import { registerFileRoutes } from '@/transport/http/routes/files';
import { registerToolRoutes } from '@/transport/http/routes/tools';
import { registerMcpRoutes } from '@/transport/http/routes/mcp';
import { registerConfigRoutes } from '@/transport/http/routes/config';
import { registerSandboxRoutes } from '@/transport/http/routes/sandbox';
import { registerResponseFormatRoutes } from '@/transport/http/routes/response-formats';
import { registerSchedulerRoutes } from '@/transport/http/routes/scheduler';
import { registerAgentRoutes } from '@/transport/http/routes/agents';
import { registerMaintenanceRoutes } from '@/transport/http/routes/maintenance';
import { registerNotificationRoutes } from '@/transport/http/routes/notifications';

export interface CreateAppOptions {
  clientAssetsRoot?: string | null;
}

export function createApp(application?: WiredApplication, options?: CreateAppOptions) {
  const wired = application ?? createWiredApplication();
  const configuredClientAssetsRoot = options?.clientAssetsRoot === undefined
    ? getEmbeddedClientAssetsRoot()
    : options.clientAssetsRoot;
  const clientAssetsRoot = getClientEnabled() && hasClientAssets(configuredClientAssetsRoot)
    ? configuredClientAssetsRoot
    : null;

  const app = new Hono();

  // Middleware
  app.use('*', cors());
  app.use('*', logger());
  app.use('*', prettyJSON());

  // Authentication middleware for all API routes
  app.use('/api/*', async (c, next) => {
    // Skip auth for public routes
    if (isPublicRoute(c.req.path)) {
      return await next();
    }
    
    // Require auth for all other API routes
    return await requireAuth(c, next);
  });

  // ============================================================================
  // Root and Health Endpoints
  // ============================================================================

  app.get('/', async (c) => {
    if (clientAssetsRoot !== null) {
      const response = await createClientAssetResponse(c.req.raw, clientAssetsRoot);
      if (response !== null) return response;
    }

    return c.json({
      status: 'ok',
      message: 'AI Agent Server is running',
      version: VERSION,
      timestamp: new Date().toISOString()
    });
  });

  // ============================================================================
  // API Info Endpoints
  // ============================================================================

  // GET /api/info - Server information
  app.get('/api/info', (c) => {
    return c.json({
      name: 'AI Agent Server',
      version: VERSION,
      runtime: 'bun',
      features: {
        websocket: true,
        sessions: true,
        preconfigs: true,
        tools: true,
        authentication: isAuthEnabled(),
        client: clientAssetsRoot !== null,
      },
      timestamp: new Date().toISOString()
    });
  });

  // GET /api/health - Health check
  app.get('/api/health', (c) => {
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  });

  // GET /api/auth/verify - Token verification
  // Protected by requireAuth middleware (not in PUBLIC_ROUTES)
  // Returns 200 if token is valid, 401 if invalid (handled by middleware)
  app.get('/api/auth/verify', (c) => {
    return c.json({ valid: true, timestamp: new Date().toISOString() });
  });

  // ============================================================================
  // Route Modules
  // ============================================================================

  registerSessionRoutes(app, wired.http);
  registerWorkspaceRoutes(app, wired.workspaces);
  registerWorktreeRoutes(app, wired.worktrees);
  registerFileRoutes(app, wired.files);
  registerToolRoutes(app, wired.tools);
  registerMcpRoutes(app, wired.mcp);
  registerConfigRoutes(app, wired.providers, wired.configuration);
  registerResponseFormatRoutes(app, wired.responseFormats);
  registerSchedulerRoutes(app, wired.scheduling);
  registerAgentRoutes(app, wired.agents);
  registerMaintenanceRoutes(app, wired.maintenance);
  registerNotificationRoutes(app, wired.notifications);
  if (readEnv('SANDBOX') === 'true') {
    registerSandboxRoutes(app);
  }

  // ============================================================================
  // WebSocket Handler
  // ============================================================================

  // WebSocket endpoint: GET /ws
  app.get('/ws', async (c) => {
    if (!c.req.raw.headers.get('upgrade')?.toLowerCase()) {
      return c.json({ error: 'Bad Request', message: 'Expected WebSocket upgrade' }, 400);
    }
    
    const sessionId = c.req.query('sessionId');
    
    return c.json({
      message: 'WebSocket endpoint - requires WebSocket upgrade support',
      protocol: 'ai-agent-ws',
      version: VERSION,
      sessionId
    });
  });

  // ============================================================================
  // Embedded Client
  // ============================================================================

  if (clientAssetsRoot !== null) {
    const handleClientRequest = async (request: Request): Promise<Response | null> => {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/api' || pathname.startsWith('/api/')) return null;
      if (pathname === '/ws' || pathname.startsWith('/ws/')) return null;
      return createClientAssetResponse(request, clientAssetsRoot);
    };

    app.get('*', async (c) => {
      const response = await handleClientRequest(c.req.raw);
      return response ?? c.notFound();
    });
    app.on('HEAD', '*', async (c) => {
      const response = await handleClientRequest(c.req.raw);
      return response ?? c.notFound();
    });
  }

  // ============================================================================
  // 404 and Error Handlers
  // ============================================================================

  app.notFound((c) => {
    return c.json(
      {
        error: 'Not Found',
        message: 'The requested endpoint does not exist',
        path: c.req.path,
        method: c.req.method
      },
      404
    );
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const body: Record<string, unknown> = {
        error: err.code,
        message: err.message,
      };
      if (err.details !== undefined) {
        body.details = err.details;
      }
      return c.json(body, err.status as ContentfulStatusCode);
    }

    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return c.json(
        { error: 'bad_request', message: 'Validation failed', details: issues },
        400 as ContentfulStatusCode,
      );
    }

    console.log('\n');
    console.log('========== ERROR ==========');
    console.log('Message:', err.message);
    console.log('Path:', c.req.path);
    console.log('Method:', c.req.method);
    console.log('Stack:', err.stack);
    console.log('============================\n');
    
    return c.json(
      {
        error: 'Internal Server Error',
        message: err.message || 'An unexpected error occurred',
        path: c.req.path,
        method: c.req.method
      },
      500
    );
  });

  return app;
}

export default createApp;
