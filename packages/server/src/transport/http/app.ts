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
import { getClientEnabled } from '@/infrastructure/runtime/environment';
import { VERSION } from '@/version';
import { HttpError } from '@/application/http-errors';
import { createWiredApplication, type WiredApplication } from '@/bootstrap/application';

// Route modules
import { registerSessionRoutes } from '@/transport/http/routes/sessions';
import { registerWorkspaceRoutes } from '@/transport/http/routes/workspaces';
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

export function createApp(application?: WiredApplication) {
  const wired = application ?? createWiredApplication();

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

  app.get('/', (c) => {
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
        client: getClientEnabled(),
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
  registerFileRoutes(app, wired.files);
  registerToolRoutes(app, wired.tools);
  registerMcpRoutes(app, wired.mcp);
  registerConfigRoutes(app, wired.providers, wired.configuration);
  registerResponseFormatRoutes(app, wired.responseFormats);
  registerSchedulerRoutes(app, wired.scheduling);
  registerAgentRoutes(app, wired.agents);
  registerMaintenanceRoutes(app, wired.maintenance);
  registerNotificationRoutes(app, wired.notifications);
  if (process.env.JEAN2_SANDBOX === 'true') {
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
