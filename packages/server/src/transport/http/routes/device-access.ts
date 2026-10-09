import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { validate } from './validate';
import { isAdminPrincipal, type DeviceAccessService } from '@/application/device-access/service';
import { getRequestPrincipal, requireAdmin } from '@/transport/http/middleware/auth';

const deviceKindSchema = z.enum(['desktop', 'mobile', 'tablet', 'unknown']).default('unknown');

const pairSchema = z.object({
  code: z.string().min(1).max(64),
  label: z.string().max(200).default(''),
  deviceKind: deviceKindSchema,
});

const accessRequestSchema = z.object({
  label: z.string().max(200).default(''),
  deviceKind: deviceKindSchema,
});

const pairingCodeSchema = z.object({
  label: z.string().max(200).optional(),
}).default({});

const SSE_KEEPALIVE_MS = 25_000;

/**
 * Device pairing and access management. Pairing, approval requests, and
 * status are public; listing, approving, and creating pairing codes require
 * the server's own machine (or the shared token); everything else requires a
 * paired device.
 */
export interface DeviceAccessRouteOptions {
  /** Links another device can open to pair; empty when the server only listens on this machine. */
  pairingLinks?: (code: string) => string[];
  /** Addresses other devices use; clients learn them to fail over between routes. */
  addresses?: () => string[];
}

export function registerDeviceAccessRoutes(
  app: Hono,
  deviceAccess: DeviceAccessService,
  options: DeviceAccessRouteOptions = {},
): void {
  /** GET /api/auth/status - whether this caller is paired, and how. */
  app.get('/api/auth/status', (c) => {
    const principal = getRequestPrincipal(c);
    return c.json({
      paired: principal !== null,
      access: principal?.kind ?? null,
      admin: principal !== null && isAdminPrincipal(principal),
      device: principal?.kind === 'device' ? { id: principal.deviceId, label: principal.label } : null,
      pairingMethods: ['code', 'approval'],
      ...(principal !== null && options.addresses ? { addresses: options.addresses() } : {}),
    });
  });

  /** POST /api/auth/pair - exchange a one-time pairing code for a device token. */
  app.post('/api/auth/pair', validate('json', pairSchema), (c) => {
    const body = c.req.valid('json');
    const issued = deviceAccess.redeemPairingCode(body);
    if (!issued) {
      return c.json({ error: 'invalid_code', message: 'This pairing code is invalid, expired, or already used.' }, 400);
    }
    return c.json(issued);
  });

  /** POST /api/auth/requests - ask the server's owner to approve this device. */
  app.post('/api/auth/requests', validate('json', accessRequestSchema), (c) => {
    const created = deviceAccess.requestAccess(c.req.valid('json'));
    if (!created) {
      return c.json({ error: 'too_many_requests', message: 'Too many devices are waiting for approval. Try again later.' }, 429);
    }
    return c.json(created, 201);
  });

  /**
   * GET /api/auth/requests/:id/events?secret=... - Server-Sent Events stream
   * that sends one `decision` event (approved with token, denied, or expired).
   */
  app.get('/api/auth/requests/:id/events', (c) => {
    const waiting = new AbortController();
    const decision = deviceAccess.waitForAccessDecision(c.req.param('id'), c.req.query('secret') ?? '', waiting.signal);
    if (!decision) {
      return c.json({ error: 'not_found', message: 'This approval request does not exist or has finished.' }, 404);
    }
    return streamSSE(c, async (stream) => {
      let done = false;
      const aborted = new Promise<null>((resolve) => {
        stream.onAbort(() => {
          done = true;
          waiting.abort();
          resolve(null);
        });
      });
      // Flush headers now so the waiting device (and any proxy) sees an open stream.
      await stream.write(': waiting\n\n');
      const keepalive = setInterval(() => {
        if (!done) void stream.write(': keepalive\n\n');
      }, SSE_KEEPALIVE_MS);
      try {
        const outcome = await Promise.race([decision, aborted]);
        if (outcome && !done) await stream.writeSSE({ event: 'decision', data: JSON.stringify(outcome) });
      } finally {
        clearInterval(keepalive);
      }
    });
  });

  /** GET /api/auth/access - pending approval requests and paired devices. */
  app.get('/api/auth/access', (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    return c.json({ requests: deviceAccess.listAccessRequests(), devices: deviceAccess.listDevices() });
  });

  app.post('/api/auth/requests/:id/approve', (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    if (!deviceAccess.approveAccessRequest(c.req.param('id'))) {
      return c.json({ error: 'not_found', message: 'This approval request has already finished.' }, 404);
    }
    return c.json({ success: true });
  });

  app.post('/api/auth/requests/:id/deny', (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    if (!deviceAccess.denyAccessRequest(c.req.param('id'))) {
      return c.json({ error: 'not_found', message: 'This approval request has already finished.' }, 404);
    }
    return c.json({ success: true });
  });

  /** DELETE /api/auth/devices/:id - revoke a device. A device may also revoke itself. */
  app.delete('/api/auth/devices/:id', (c) => {
    const id = c.req.param('id');
    const principal = getRequestPrincipal(c);
    const isSelf = principal?.kind === 'device' && principal.deviceId === id;
    if (!isSelf) {
      const refused = requireAdmin(c);
      if (refused) return refused;
    }
    if (!deviceAccess.revokeDevice(id)) {
      return c.json({ error: 'not_found', message: 'This device is not paired.' }, 404);
    }
    return c.json({ success: true });
  });

  /** POST /api/auth/pairing-codes - create a one-time pairing code for a QR or link. */
  app.post('/api/auth/pairing-codes', validate('json', pairingCodeSchema), (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    const created = deviceAccess.createPairingCode(c.req.valid('json'));
    return c.json({ ...created, links: options.pairingLinks?.(created.code) ?? [] }, 201);
  });

  /** POST /api/auth/ws-ticket - short-lived single-use ticket so tokens stay out of socket URLs. */
  app.post('/api/auth/ws-ticket', (c) => {
    const principal = getRequestPrincipal(c);
    if (!principal) return c.json({ error: 'Unauthorized' }, 401);
    return c.json(deviceAccess.issueSocketTicket(principal));
  });
}
