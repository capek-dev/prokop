import type { Database } from 'bun:sqlite';
import type {
  DeviceAccessRepository,
  DeviceKind,
  DeviceSessionRecord,
  PairingCodeRecord,
} from '@/application/ports/device-access';

/** Database accessor injected by the composition root; no module-global connection state. */
export type DeviceAccessDatabaseAccessor = () => Database;

export function initializeDeviceAccessSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS auth_device_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    device_kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS auth_pairing_codes (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
  )`);
}

interface SessionRow {
  id: string;
  token_hash: string;
  label: string;
  device_kind: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  revoked_at: number | null;
}

interface PairingCodeRow {
  id: string;
  code_hash: string;
  label: string | null;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

const DEVICE_KINDS: readonly DeviceKind[] = ['desktop', 'mobile', 'tablet', 'unknown'];

function toSession(row: SessionRow): DeviceSessionRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    label: row.label,
    deviceKind: DEVICE_KINDS.includes(row.device_kind as DeviceKind) ? row.device_kind as DeviceKind : 'unknown',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
}

function toPairingCode(row: PairingCodeRow): PairingCodeRecord {
  return {
    id: row.id,
    codeHash: row.code_hash,
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

export function createDeviceAccessRepository(getDatabase: DeviceAccessDatabaseAccessor): DeviceAccessRepository {
  return {
    insertSession(record) {
      getDatabase()
        .query(
          `INSERT INTO auth_device_sessions
             (id, token_hash, label, device_kind, created_at, expires_at, last_seen_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id, record.tokenHash, record.label, record.deviceKind,
          record.createdAt, record.expiresAt, record.lastSeenAt, record.revokedAt,
        );
    },
    findActiveSessionByTokenHash(tokenHash, now) {
      const row = getDatabase()
        .query<SessionRow, [string, number]>(
          'SELECT * FROM auth_device_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
        )
        .get(tokenHash, now);
      return row ? toSession(row) : null;
    },
    listActiveSessions(now) {
      return getDatabase()
        .query<SessionRow, [number]>(
          'SELECT * FROM auth_device_sessions WHERE revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC',
        )
        .all(now)
        .map(toSession);
    },
    touchSession(id, lastSeenAt, expiresAt) {
      getDatabase()
        .query('UPDATE auth_device_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL')
        .run(lastSeenAt, expiresAt, id);
    },
    revokeSession(id, revokedAt) {
      const result = getDatabase()
        .query('UPDATE auth_device_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
        .run(revokedAt, id);
      return result.changes > 0;
    },
    insertPairingCode(record) {
      getDatabase()
        .query(
          `INSERT INTO auth_pairing_codes (id, code_hash, label, created_at, expires_at, consumed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(record.id, record.codeHash, record.label, record.createdAt, record.expiresAt, record.consumedAt);
    },
    consumePairingCode(codeHash, now) {
      const row = getDatabase()
        .query<PairingCodeRow, [number, string, number]>(
          `UPDATE auth_pairing_codes SET consumed_at = ?
           WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
           RETURNING *`,
        )
        .get(now, codeHash, now);
      return row ? toPairingCode(row) : null;
    },
  };
}
