// Device pairing: standalone calls a client makes before it has a device token.

export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export interface PairedDevice {
  id: string;
  label: string;
  deviceKind: DeviceKind;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export interface AccessStatus {
  paired: boolean;
  access: 'local' | 'token' | 'open' | 'device' | null;
  /** True for the server's own machine; only admins can approve or revoke devices. */
  admin: boolean;
  device: { id: string; label: string } | null;
  pairingMethods: Array<'code' | 'approval'>;
  /** Addresses other devices use to reach this server; only sent to paired callers. */
  addresses?: string[];
}

export interface IssuedDeviceToken {
  token: string;
  device: PairedDevice;
}

export interface AccessRequestTicket {
  requestId: string;
  secret: string;
  /** Shown on this device; the approver sees the same digits. */
  matchCode: string;
  expiresAt: number;
}

export type AccessDecision =
  | { status: 'approved'; token: string; device: PairedDevice }
  | { status: 'denied' }
  | { status: 'expired' };

export interface PendingAccessRequest {
  id: string;
  label: string;
  deviceKind: DeviceKind;
  matchCode: string;
  createdAt: number;
  expiresAt: number;
}

/** WebSocket close code sent when a device's access is revoked; pair again instead of reconnecting. */
export const ACCESS_REVOKED_CLOSE_CODE = 4401;

export class PairingError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'PairingError';
  }
}

function apiUrl(serverUrl: string, path: string): string {
  const base = /^https?:\/\//.test(serverUrl) ? serverUrl : `http://${serverUrl}`;
  return `${base.replace(/\/+$/, '')}/api${path}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: string; reason?: string; message?: string };
  if (!response.ok) {
    throw new PairingError(body.message ?? `Request failed (HTTP ${response.status})`, response.status, body.reason ?? body.error);
  }
  return body as T;
}

/** Reads the pairing code from a `/pair#code=...` link (fragment, so it never reaches server logs). */
export function readPairingLink(link: string): { serverUrl: string; code: string } | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const code = new URLSearchParams(url.hash.replace(/^#/, '')).get('code')?.trim();
  if (!code || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
  return { serverUrl: url.origin, code };
}

export async function getAccessStatus(serverUrl: string, token?: string, signal?: AbortSignal): Promise<AccessStatus> {
  const response = await fetch(apiUrl(serverUrl, '/auth/status'), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  return readJson<AccessStatus>(response);
}

export async function redeemPairingCode(
  serverUrl: string,
  input: { code: string; label: string; deviceKind: DeviceKind },
): Promise<IssuedDeviceToken> {
  const response = await fetch(apiUrl(serverUrl, '/auth/pair'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<IssuedDeviceToken>(response);
}

export async function requestDeviceAccess(
  serverUrl: string,
  input: { label: string; deviceKind: DeviceKind },
): Promise<AccessRequestTicket> {
  const response = await fetch(apiUrl(serverUrl, '/auth/requests'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<AccessRequestTicket>(response);
}

/**
 * Waits for the server's owner to approve or deny a request. The server pushes
 * the decision over Server-Sent Events; nothing polls. Rejects with a
 * PairingError when the request is unknown, and with an AbortError on abort.
 */
export async function waitForAccessDecision(
  serverUrl: string,
  ticket: Pick<AccessRequestTicket, 'requestId' | 'secret'>,
  signal?: AbortSignal,
): Promise<AccessDecision> {
  const path = `/auth/requests/${encodeURIComponent(ticket.requestId)}/events?secret=${encodeURIComponent(ticket.secret)}`;
  const response = await fetch(apiUrl(serverUrl, path), { headers: { Accept: 'text/event-stream' }, signal });
  if (!response.ok || !response.body) {
    await readJson(response);
    throw new PairingError('The server did not open the approval stream.', response.status);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new PairingError('The approval stream closed before a decision.', 0, 'stream_closed');
      buffer += value;
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = frame.split('\n');
        if (lines.includes('event: decision')) {
          const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          return JSON.parse(data) as AccessDecision;
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

/**
 * Query string that authenticates a WebSocket upgrade. A token is exchanged
 * for a short-lived single-use ticket so it never appears in a socket URL.
 * Servers without tickets (older versions) fall back to the legacy `token`.
 */
export async function socketAuthQuery(serverUrl: string, token: string | undefined): Promise<Record<string, string>> {
  if (!token) return {};
  const response = await fetch(apiUrl(serverUrl, '/auth/ws-ticket'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return { token };
  const { ticket } = await readJson<{ ticket: string }>(response);
  return { ticket };
}
