import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type {
  DeviceAccessRepository,
  DeviceKind,
  DeviceSessionRecord,
} from '@/application/ports/device-access';

/**
 * Who is making a request. Same-machine clients, the legacy shared token, and
 * an explicit no-auth opt-out administer access; paired devices only operate.
 */
export type AccessPrincipal =
  | { kind: 'local' }
  | { kind: 'token' }
  | { kind: 'open' }
  | { kind: 'device'; deviceId: string; label: string };

export function isAdminPrincipal(principal: AccessPrincipal): boolean {
  return principal.kind !== 'device';
}

export interface DeviceSummary {
  id: string;
  label: string;
  deviceKind: DeviceKind;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export interface AccessRequestSummary {
  id: string;
  label: string;
  deviceKind: DeviceKind;
  /** Shown on both screens so the approver can tell which device is asking. */
  matchCode: string;
  createdAt: number;
  expiresAt: number;
}

export interface IssuedDevice {
  token: string;
  device: DeviceSummary;
}

export type AccessRequestOutcome =
  | { status: 'approved'; token: string; device: DeviceSummary }
  | { status: 'denied' }
  | { status: 'expired' };

export interface DeviceAccessListener {
  /** Pending requests or the device list changed. Carries no secrets. */
  changed?(): void;
  /** A device lost access; its open sockets must close. */
  deviceRevoked?(deviceId: string): void;
}

export interface DeviceAccessOptions {
  repository: DeviceAccessRepository;
  now?: () => number;
  sessionTtlMs?: number;
  pairingCodeTtlMs?: number;
  accessRequestTtlMs?: number;
  socketTicketTtlMs?: number;
  maxPendingRequests?: number;
}

export interface DeviceAccessService {
  authenticate(token: string): AccessPrincipal | null;
  createPairingCode(input: { label?: string }): { code: string; expiresAt: number };
  redeemPairingCode(input: { code: string; label: string; deviceKind: DeviceKind }): IssuedDevice | null;
  /** Null when too many requests are already pending. */
  requestAccess(input: { label: string; deviceKind: DeviceKind }): { requestId: string; secret: string; matchCode: string; expiresAt: number } | null;
  /**
   * Resolves once the request is decided or expires. Null for an unknown
   * request or wrong secret. Aborting stops waiting without consuming the
   * outcome, so a reconnecting device still receives it.
   */
  waitForAccessDecision(requestId: string, secret: string, signal?: AbortSignal): Promise<AccessRequestOutcome> | null;
  listAccessRequests(): AccessRequestSummary[];
  approveAccessRequest(requestId: string): boolean;
  denyAccessRequest(requestId: string): boolean;
  listDevices(): DeviceSummary[];
  revokeDevice(deviceId: string): boolean;
  issueSocketTicket(principal: AccessPrincipal): { ticket: string; expiresAt: number };
  /** Single use. */
  redeemSocketTicket(ticket: string): AccessPrincipal | null;
  subscribe(listener: DeviceAccessListener): () => void;
  dispose(): void;
}

export const DEVICE_TOKEN_PREFIX = 'pkd_';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * DAY_MS;
const DEFAULT_PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ACCESS_REQUEST_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SOCKET_TICKET_TTL_MS = 60 * 1000;
const DEFAULT_MAX_PENDING_REQUESTS = 10;
/** Sliding expiry is written at most this often per device. */
const TOUCH_INTERVAL_MS = 60 * 1000;
const PAIRING_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PAIRING_CODE_LENGTH = 12;
const MAX_LABEL_LENGTH = 80;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/** Accepts any case, spaces, and dashes so a code can be typed as displayed. */
export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function formatPairingCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

function cleanLabel(label: string): string {
  const trimmed = label.trim().slice(0, MAX_LABEL_LENGTH);
  return trimmed.length > 0 ? trimmed : 'Unnamed device';
}

function toSummary(record: DeviceSessionRecord): DeviceSummary {
  return {
    id: record.id,
    label: record.label,
    deviceKind: record.deviceKind,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    expiresAt: record.expiresAt,
  };
}

interface PendingRequest {
  summary: AccessRequestSummary;
  secretHash: string;
  outcome: AccessRequestOutcome | null;
  waiters: Set<(outcome: AccessRequestOutcome) => void>;
  timer: ReturnType<typeof setTimeout>;
}

export function createDeviceAccessService(options: DeviceAccessOptions): DeviceAccessService {
  const { repository } = options;
  const now = options.now ?? Date.now;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const pairingCodeTtlMs = options.pairingCodeTtlMs ?? DEFAULT_PAIRING_CODE_TTL_MS;
  const accessRequestTtlMs = options.accessRequestTtlMs ?? DEFAULT_ACCESS_REQUEST_TTL_MS;
  const socketTicketTtlMs = options.socketTicketTtlMs ?? DEFAULT_SOCKET_TICKET_TTL_MS;
  const maxPendingRequests = options.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS;

  const listeners = new Set<DeviceAccessListener>();
  const pending = new Map<string, PendingRequest>();
  const tickets = new Map<string, { principal: AccessPrincipal; expiresAt: number }>();

  function notifyChanged(): void {
    for (const listener of listeners) listener.changed?.();
  }

  function issueDevice(label: string, deviceKind: DeviceKind): IssuedDevice {
    const token = `${DEVICE_TOKEN_PREFIX}${randomSecret()}`;
    const at = now();
    const record: DeviceSessionRecord = {
      id: randomUUID(),
      tokenHash: sha256(token),
      label: cleanLabel(label),
      deviceKind,
      createdAt: at,
      expiresAt: at + sessionTtlMs,
      lastSeenAt: at,
      revokedAt: null,
    };
    repository.insertSession(record);
    return { token, device: toSummary(record) };
  }

  /** Keeps an outcome until one waiter receives it, so a dropped connection can resume. */
  function settle(request: PendingRequest, outcome: AccessRequestOutcome): void {
    request.outcome = outcome;
    clearTimeout(request.timer);
    if (request.waiters.size > 0) {
      for (const waiter of request.waiters) waiter(outcome);
      pending.delete(request.summary.id);
    } else if (outcome.status !== 'approved') {
      pending.delete(request.summary.id);
    } else {
      // Hold the issued token briefly for a reconnecting waiter, then drop it.
      request.timer = setTimeout(() => pending.delete(request.summary.id), accessRequestTtlMs);
      request.timer.unref?.();
    }
  }

  function decide(requestId: string, decision: () => AccessRequestOutcome): boolean {
    const request = pending.get(requestId);
    if (!request || request.outcome !== null) return false;
    settle(request, decision());
    notifyChanged();
    return true;
  }

  return {
    authenticate(token) {
      if (!token.startsWith(DEVICE_TOKEN_PREFIX)) return null;
      const at = now();
      const record = repository.findActiveSessionByTokenHash(sha256(token), at);
      if (!record) return null;
      if (at - record.lastSeenAt >= TOUCH_INTERVAL_MS) {
        repository.touchSession(record.id, at, at + sessionTtlMs);
      }
      return { kind: 'device', deviceId: record.id, label: record.label };
    },

    createPairingCode({ label }) {
      const code = generatePairingCode();
      const at = now();
      const expiresAt = at + pairingCodeTtlMs;
      repository.insertPairingCode({
        id: randomUUID(),
        codeHash: sha256(code),
        label: label ? cleanLabel(label) : null,
        createdAt: at,
        expiresAt,
        consumedAt: null,
      });
      return { code: formatPairingCode(code), expiresAt };
    },

    redeemPairingCode({ code, label, deviceKind }) {
      const normalized = normalizePairingCode(code);
      if (normalized.length !== PAIRING_CODE_LENGTH) return null;
      const consumed = repository.consumePairingCode(sha256(normalized), now());
      if (!consumed) return null;
      const issued = issueDevice(label || consumed.label || '', deviceKind);
      notifyChanged();
      return issued;
    },

    requestAccess({ label, deviceKind }) {
      const open = Array.from(pending.values()).filter((request) => request.outcome === null);
      if (open.length >= maxPendingRequests) return null;
      const id = randomUUID();
      const secret = randomSecret();
      const createdAt = now();
      const request: PendingRequest = {
        summary: {
          id,
          label: cleanLabel(label),
          deviceKind,
          matchCode: String(randomInt(10_000)).padStart(4, '0'),
          createdAt,
          expiresAt: createdAt + accessRequestTtlMs,
        },
        secretHash: sha256(secret),
        outcome: null,
        waiters: new Set(),
        timer: setTimeout(() => {
          settle(request, { status: 'expired' });
          notifyChanged();
        }, accessRequestTtlMs),
      };
      request.timer.unref?.();
      pending.set(id, request);
      notifyChanged();
      return { requestId: id, secret, matchCode: request.summary.matchCode, expiresAt: request.summary.expiresAt };
    },

    waitForAccessDecision(requestId, secret, signal) {
      const request = pending.get(requestId);
      if (!request || request.secretHash !== sha256(secret)) return null;
      if (request.outcome !== null) {
        const outcome = request.outcome;
        clearTimeout(request.timer);
        pending.delete(requestId);
        return Promise.resolve(outcome);
      }
      return new Promise((resolve) => {
        request.waiters.add(resolve);
        signal?.addEventListener('abort', () => request.waiters.delete(resolve), { once: true });
      });
    },

    listAccessRequests() {
      return Array.from(pending.values())
        .filter((request) => request.outcome === null)
        .map((request) => request.summary);
    },

    approveAccessRequest(requestId) {
      return decide(requestId, () => {
        const request = pending.get(requestId)!;
        const issued = issueDevice(request.summary.label, request.summary.deviceKind);
        return { status: 'approved', token: issued.token, device: issued.device };
      });
    },

    denyAccessRequest(requestId) {
      return decide(requestId, () => ({ status: 'denied' }));
    },

    listDevices() {
      return repository.listActiveSessions(now()).map(toSummary);
    },

    revokeDevice(deviceId) {
      if (!repository.revokeSession(deviceId, now())) return false;
      for (const [ticket, entry] of tickets) {
        if (entry.principal.kind === 'device' && entry.principal.deviceId === deviceId) tickets.delete(ticket);
      }
      for (const listener of listeners) listener.deviceRevoked?.(deviceId);
      notifyChanged();
      return true;
    },

    issueSocketTicket(principal) {
      const at = now();
      for (const [key, entry] of tickets) {
        if (entry.expiresAt <= at) tickets.delete(key);
      }
      const ticket = randomSecret();
      const expiresAt = at + socketTicketTtlMs;
      tickets.set(ticket, { principal, expiresAt });
      return { ticket, expiresAt };
    },

    redeemSocketTicket(ticket) {
      const entry = tickets.get(ticket);
      if (!entry) return null;
      tickets.delete(ticket);
      return entry.expiresAt > now() ? entry.principal : null;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      for (const request of pending.values()) clearTimeout(request.timer);
      pending.clear();
      tickets.clear();
      listeners.clear();
    },
  };
}
