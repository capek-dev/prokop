import type { Hono } from 'hono';
import { z } from 'zod';
import { validate } from './validate';
import type { RemoteAccessService } from '@/application/remote-access/service';
import { requireAdmin } from '@/transport/http/middleware/auth';

const listenSchema = z.object({ listenOnNetwork: z.boolean() });
const addressSchema = z.object({ url: z.string().min(1).max(500) });
const tailscaleSchema = z.object({ enabled: z.boolean() });

/**
 * Where other devices reach this server. Every route requires the server's
 * own machine (or the shared token): these settings expose the server.
 */
export function registerRemoteAccessRoutes(app: Hono, remoteAccess: RemoteAccessService): void {
  /** GET /api/remote-access - listening state, addresses, suggestions, Tailscale. */
  app.get('/api/remote-access', async (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    return c.json(await remoteAccess.status());
  });

  /** PUT /api/remote-access - listen on the network or only on this machine; re-binds in place. */
  app.put('/api/remote-access', validate('json', listenSchema), async (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    return c.json(await remoteAccess.setListenOnNetwork(c.req.valid('json').listenOnNetwork));
  });

  /** POST /api/remote-access/addresses - add an address other devices use (VPN, proxy, tunnel). */
  app.post('/api/remote-access/addresses', validate('json', addressSchema), async (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    return c.json(await remoteAccess.addAddress(c.req.valid('json').url));
  });

  /** DELETE /api/remote-access/addresses?url=... - remove an address. */
  app.delete('/api/remote-access/addresses', validate('query', addressSchema), async (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    return c.json(await remoteAccess.removeAddress(c.req.valid('query').url));
  });

  /** POST /api/remote-access/tailscale - share over Tailscale HTTPS with `tailscale serve`, or stop. */
  app.post('/api/remote-access/tailscale', validate('json', tailscaleSchema), async (c) => {
    const refused = requireAdmin(c);
    if (refused) return refused;
    return c.json(await remoteAccess.setTailscale(c.req.valid('json').enabled));
  });
}
