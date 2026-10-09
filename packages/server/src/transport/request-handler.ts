// Transport entry point for every listener: authenticate, guard, then upgrade or route
import type { Server } from 'bun';
import type { DeviceAccessService } from '@/application/device-access/service';
import { guardRequestOrigin, isLoopbackAddress } from '@/transport/http/middleware/request-origin';
import { readRequestAuthInput, resolveRequestPrincipal } from '@/transport/http/request-auth';
import type { BunWebSocketAdapter, WsData } from '@/transport/websocket/bun-adapter';

export interface RequestHandlerDeps {
  app: { fetch(req: Request, env: Record<string, unknown>): Response | Promise<Response> };
  transport: Pick<BunWebSocketAdapter, 'handleUpgrade'>;
  deviceAccess: Pick<DeviceAccessService, 'authenticate' | 'redeemSocketTicket'>;
  validateLegacyToken(token: string): boolean;
  isAuthDisabled(): boolean;
  /** Published hostnames a same-machine proxy may forward (remote-access addresses). */
  isKnownHostname(hostname: string): boolean;
}

/**
 * Authenticates once per request (a socket ticket is single use), refuses
 * cross-site callers, then upgrades WebSockets or routes to the HTTP app.
 */
export function createRequestHandler(deps: RequestHandlerDeps) {
  const authDeps = {
    deviceAccess: deps.deviceAccess,
    validateLegacyToken: deps.validateLegacyToken,
    isAuthDisabled: deps.isAuthDisabled,
  };
  return async function handleRequest(req: Request, listener: Server<WsData>): Promise<Response | undefined> {
    const peerAddress = listener.requestIP(req)?.address ?? null;
    const isUpgrade = req.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    const principal = resolveRequestPrincipal(readRequestAuthInput(req, peerAddress, isUpgrade), authDeps);
    const refused = guardRequestOrigin(
      req,
      peerAddress,
      principal?.kind === 'token' || principal?.kind === 'device',
      deps.isKnownHostname,
    );
    if (refused) return refused;

    const viaNetwork = peerAddress !== null && !isLoopbackAddress(peerAddress);
    const upgrade = deps.transport.handleUpgrade(req, (data: WsData) => listener.upgrade(req, { data }), principal, { viaNetwork });
    if (upgrade.handled) return upgrade.response;

    // Bun closes a response that sends nothing for 10 s, which cuts quiet
    // Server-Sent Event streams mid-body (browsers report
    // ERR_INCOMPLETE_CHUNKED_ENCODING and reconnect). Event streams stay open
    // until the client aborts; every other request keeps the idle guard.
    if (req.headers.get('Accept')?.includes('text/event-stream')) listener.timeout(req, 0);

    return deps.app.fetch(req, { principal });
  };
}
