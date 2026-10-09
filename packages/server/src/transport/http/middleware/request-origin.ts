// Transport request origin guard (drive-by and DNS-rebinding protection)

/**
 * Same-machine clients need no credential, so the server must make sure a
 * request really comes from a same-machine client and not from a web page that
 * the user happens to have open:
 *
 * - A loopback peer must address the server by a loopback name. A DNS-rebinding
 *   page reaches 127.0.0.1 through its own hostname, so its Host is foreign.
 * - A browser Origin must be this server's own origin, a loopback origin (dev
 *   servers on other ports), or a browser extension. Any other site is refused.
 *
 * Requests carrying a valid credential and CORS preflights skip these checks:
 * the credential is the authority, and a preflight has no side effects.
 */

export interface RequestOriginInput {
  method: string;
  host: string | null;
  origin: string | null;
  peerAddress: string | null;
  hasValidCredential: boolean;
  hasPreflightHeader: boolean;
  /**
   * Hostnames this server is published under (remote-access addresses, the
   * machine's Tailscale name). A same-machine proxy forwards them over
   * loopback; a rebinding page cannot use them.
   */
  isKnownHostname?: (hostname: string) => boolean;
  /**
   * The route grants nothing by itself (server info, pairing status, redeeming
   * a one-time code), so another origin may call it: a client served by one
   * machine probes and pairs another. Approval requests are not included: a
   * hostile site must not be able to raise an "Allow this device?" prompt.
   */
  crossOriginAllowed?: boolean;
}

export type RequestOriginResult =
  | { allowed: true }
  | { allowed: false; reason: 'foreign-host' | 'foreign-origin' };

const EXTENSION_SCHEMES = new Set(['chrome-extension:', 'moz-extension:', 'safari-web-extension:']);

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
  return normalized === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

export function isLoopbackHostname(hostname: string): boolean {
  const bare = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return bare === 'localhost' || bare.endsWith('.localhost') || isLoopbackAddress(bare);
}

function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin: string, host: string | null): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (EXTENSION_SCHEMES.has(parsed.protocol)) return true;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (host !== null && parsed.host.toLowerCase() === host.toLowerCase()) return true;
  return isLoopbackHostname(parsed.hostname);
}

export function checkRequestOrigin(input: RequestOriginInput): RequestOriginResult {
  if (input.hasValidCredential) return { allowed: true };
  if (input.method === 'OPTIONS' && input.hasPreflightHeader) return { allowed: true };

  if (input.peerAddress !== null && isLoopbackAddress(input.peerAddress)) {
    const hostname = input.host === null ? null : hostnameOf(input.host);
    if (hostname === null || !(isLoopbackHostname(hostname) || input.isKnownHostname?.(hostname))) {
      return { allowed: false, reason: 'foreign-host' };
    }
  }

  if (input.origin !== null && !input.crossOriginAllowed && !isAllowedOrigin(input.origin, input.host)) {
    return { allowed: false, reason: 'foreign-origin' };
  }

  return { allowed: true };
}

const CROSS_ORIGIN_SAFE_ROUTES = new Set([
  'GET /api/info',
  'GET /api/health',
  'GET /api/auth/status',
  'POST /api/auth/pair',
]);

export function isCrossOriginSafeRoute(method: string, pathname: string): boolean {
  return CROSS_ORIGIN_SAFE_ROUTES.has(`${method.toUpperCase()} ${pathname}`);
}

const REJECTION_MESSAGES: Record<'foreign-host' | 'foreign-origin', string> = {
  'foreign-host': 'Prokop does not recognize the address it was reached at. Add it on the server under Settings → Devices → Remote access, or run: prokop remote add <url>',
  'foreign-origin': 'Requests from other websites are not allowed.',
};

/**
 * Applies {@link checkRequestOrigin} to a raw request. Returns a 403 response
 * when the request must be refused, or null when it may proceed.
 * `hasValidCredential` comes from request authentication, which runs first.
 */
export function guardRequestOrigin(
  req: Request,
  peerAddress: string | null,
  hasValidCredential: boolean,
  isKnownHostname?: (hostname: string) => boolean,
): Response | null {
  const result = checkRequestOrigin({
    method: req.method,
    host: req.headers.get('Host'),
    origin: req.headers.get('Origin'),
    peerAddress,
    hasValidCredential,
    hasPreflightHeader: req.headers.has('Access-Control-Request-Method'),
    isKnownHostname,
    crossOriginAllowed: isCrossOriginSafeRoute(req.method, new URL(req.url).pathname),
  });
  if (result.allowed) return null;
  // Readable cross-origin, so a client served by another machine can tell
  // "pair this device" apart from "unreachable".
  return Response.json(
    { error: 'Forbidden', reason: result.reason, message: REJECTION_MESSAGES[result.reason] },
    { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
