// Pure functions extracted from the service worker for testability.
// These are imported by sw.ts and used inside event handlers.

export type PushEventType = 'session_completed' | 'session_failed' | 'permission_required';

export interface ProkopaiPushPayloadV1 {
  version: 1;
  eventId: string;
  type: PushEventType;
  serverId: string;
  sessionId: string;
  createdAt: number;
  route: string;
}

export const NOTIFICATION_COPY: Record<PushEventType, { title: string; body: string }> = {
  session_completed: { title: 'Prokopai', body: 'Prokopai finished a session' },
  session_failed: { title: 'Prokopai', body: 'Prokopai session failed' },
  permission_required: { title: 'Prokopai', body: 'Prokopai needs your approval' },
};

export function isProkopaiPushPayload(data: unknown): data is ProkopaiPushPayloadV1 {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return obj.version === 1
    && typeof obj.eventId === 'string'
    && typeof obj.type === 'string'
    && typeof obj.route === 'string'
    && obj.type in NOTIFICATION_COPY;
}

/**
 * Parse a push event's JSON payload. Returns null if the data is missing,
 * malformed, or not a valid Prokopai push payload.
 */
export function parsePushData(rawData: unknown): ProkopaiPushPayloadV1 | null {
  if (!rawData) return null;
  try {
    const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    if (!isProkopaiPushPayload(data)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Check if the given route string is a valid same-origin path.
 * Uses the provided origin as the base for relative routes.
 */
export function isSameOriginRoute(route: string, origin: string): boolean {
  try {
    const url = new URL(route, origin);
    return url.origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * Normalize a route into a pathname+search+hash string suitable for
 * client navigation.
 */
export function normalizeRoute(route: string, origin: string): string {
  const url = new URL(route, origin);
  return url.pathname + url.search + url.hash;
}

/**
 * Check whether any of the provided clients represents a visible, focused
 * Jean2 window. Used to suppress push notification display.
 */
export interface ClientLike {
  visibilityState: string;
  focused: boolean;
}

export function hasVisibleFocusedClient(clients: ClientLike[]): boolean {
  return clients.some((c) => c.visibilityState === 'visible' && c.focused);
}
