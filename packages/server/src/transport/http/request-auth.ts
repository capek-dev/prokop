// Transport request authentication: who is calling, for HTTP and WebSocket upgrades
import type { AccessPrincipal, DeviceAccessService } from '@/application/device-access/service';
import { isLoopbackAddress, isLoopbackHostname } from '@/transport/http/middleware/request-origin';

export interface RequestAuthDeps {
  deviceAccess: Pick<DeviceAccessService, 'authenticate' | 'redeemSocketTicket'>;
  /** Legacy shared PROKOPAI_AUTH_TOKEN check. */
  validateLegacyToken(token: string): boolean;
  /** PROKOPAI_AUTH=off: every request is trusted. */
  isAuthDisabled(): boolean;
}

export interface RequestAuthInput {
  /** Socket peer; null for in-process requests, which are same-machine by definition. */
  peerAddress: string | null;
  host: string | null;
  bearer: string | null;
  /** Legacy `?token=`; only the shared token is accepted from a URL. */
  queryToken: string | null;
  /** WebSocket ticket; only accepted on upgrades. */
  socketTicket: string | null;
}

function isSameMachine(peerAddress: string | null, host: string | null): boolean {
  if (peerAddress !== null && !isLoopbackAddress(peerAddress)) return false;
  if (host === null) return true;
  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/**
 * Credentials win over location so a paired device is identified even on
 * loopback. An invalid credential from the same machine still falls back to
 * same-machine trust, because location alone would have been enough.
 */
export function resolveRequestPrincipal(input: RequestAuthInput, deps: RequestAuthDeps): AccessPrincipal | null {
  if (input.socketTicket) {
    const principal = deps.deviceAccess.redeemSocketTicket(input.socketTicket);
    if (principal) return principal;
  }
  for (const credential of [input.bearer, input.queryToken]) {
    if (credential && deps.validateLegacyToken(credential)) return { kind: 'token' };
  }
  if (input.bearer) {
    const principal = deps.deviceAccess.authenticate(input.bearer);
    if (principal) return principal;
  }
  if (isSameMachine(input.peerAddress, input.host)) return { kind: 'local' };
  if (deps.isAuthDisabled()) return { kind: 'open' };
  return null;
}

export function readRequestAuthInput(req: Request, peerAddress: string | null, allowSocketTicket: boolean): RequestAuthInput {
  const url = new URL(req.url);
  const authorization = req.headers.get('Authorization');
  return {
    peerAddress,
    host: req.headers.get('Host') ?? url.host,
    bearer: authorization?.startsWith('Bearer ') ? authorization.substring(7) : null,
    queryToken: url.searchParams.get('token'),
    socketTicket: allowSocketTicket ? url.searchParams.get('ticket') : null,
  };
}
