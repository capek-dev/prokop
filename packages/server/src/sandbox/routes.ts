import type { Hono } from 'hono';
import { sandboxController, type AutoResponderRule, type SandboxResponse } from '@capekai/core/internal/sandbox';
import { isSandboxActive } from '@/sandbox';

interface AutoResponderRequestBody {
  rules?: AutoResponderRule[];
}

function getJsonBody<T>(value: unknown): T {
  return value as T;
}

export function registerSandboxRoutes(app: Hono): void {
  app.get('/api/sandbox/status', (c) => {
    const pendingCalls = sandboxController.getPendingCalls();
    const history = sandboxController.getHistory();

    return c.json({
      active: isSandboxActive(),
      pendingCallCount: pendingCalls.length,
      totalCallsHandled: history.length,
    });
  });

  app.get('/api/sandbox/pending', (c) => {
    return c.json(sandboxController.getPendingCalls());
  });

  app.get('/api/sandbox/pending/:callId', (c) => {
    const callId = c.req.param('callId');
    const pendingCall = sandboxController.getPendingCall(callId);

    if (!pendingCall) {
      return c.json({ ok: false, error: `No pending call with id: ${callId}` }, 404);
    }

    return c.json(pendingCall);
  });

  app.post('/api/sandbox/pending/:callId/respond', async (c) => {
    const callId = c.req.param('callId');
    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    try {
      sandboxController.respond(callId, getJsonBody<SandboxResponse>(body));
      return c.json({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith('No pending call with id:') ? 404 : 400;
      return c.json({ ok: false, error: message }, status as 400 | 404);
    }
  });

  app.get('/api/sandbox/history', (c) => {
    return c.json(sandboxController.getHistory());
  });

  app.delete('/api/sandbox/history', (c) => {
    sandboxController.clearHistory();
    return c.json({ ok: true });
  });

  app.get('/api/sandbox/auto-responder', (c) => {
    return c.json(sandboxController.getAutoResponderRules());
  });

  app.put('/api/sandbox/auto-responder', async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const { rules } = getJsonBody<AutoResponderRequestBody>(body);
    if (!Array.isArray(rules)) {
      return c.json({ ok: false, error: 'Expected body with rules array' }, 400);
    }

    sandboxController.setAutoResponderRules(rules);
    return c.json({ ok: true });
  });
}
