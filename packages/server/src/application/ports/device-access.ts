/** Kind of device reported by the client during pairing; display only, never an authorization input. */
export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'unknown';

/** Persisted device session. Only the token hash is stored; the raw token is returned once. */
export interface DeviceSessionRecord {
  id: string;
  tokenHash: string;
  label: string;
  deviceKind: DeviceKind;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

/** Persisted one-time pairing code. Only the code hash is stored. */
export interface PairingCodeRecord {
  id: string;
  codeHash: string;
  label: string | null;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface DeviceAccessRepository {
  insertSession(record: DeviceSessionRecord): void;
  /** Active means not revoked and not expired at `now`. */
  findActiveSessionByTokenHash(tokenHash: string, now: number): DeviceSessionRecord | null;
  listActiveSessions(now: number): DeviceSessionRecord[];
  touchSession(id: string, lastSeenAt: number, expiresAt: number): void;
  /** Returns false when the session does not exist or was already revoked. */
  revokeSession(id: string, revokedAt: number): boolean;
  insertPairingCode(record: PairingCodeRecord): void;
  /** Atomically marks an unexpired, unconsumed code as consumed; null when it cannot be redeemed. */
  consumePairingCode(codeHash: string, now: number): PairingCodeRecord | null;
}
