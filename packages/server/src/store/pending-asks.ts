import { getDatabase } from './index';
import type { Ask } from '@jean2/sdk';

// =============================================================================
// Permission Request Lifecycle Status
// =============================================================================

export type PermissionRequestStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

// =============================================================================
// Database Row Types
// =============================================================================

interface PendingAskRow {
  id: string;
  session_id: string;
  tool_call_id: string;
  tool_name: string;
  ask_json: string;
  created_at: number;
  request_id: string | null;
  workspace_id: string | null;
  root_session_id: string | null;
  origin_session_id: string | null;
  status: string;
  expires_at: number | null;
  resolved_at: number | null;
  resolution_json: string | null;
  is_permission: number;
}

// =============================================================================
// Public TypeScript Types
// =============================================================================

export interface PendingAskRecord {
  id: string;
  requestId: string;
  sessionId: string;
  rootSessionId?: string;
  originSessionId?: string;
  workspaceId?: string;
  toolCallId: string;
  toolName: string;
  ask: Ask;
  status: PermissionRequestStatus;
  isPermission: boolean;
  expiresAt?: number;
  resolvedAt?: number;
  resolution?: unknown;
  createdAt: number;
}

// =============================================================================
// Input type for creating a new permission request
// =============================================================================

export interface CreatePermissionRequestInput {
  sessionId: string;
  rootSessionId?: string;
  originSessionId?: string;
  workspaceId?: string;
  toolCallId: string;
  toolName: string;
  ask: Ask;
  isPermission: boolean;
  timeoutMs: number;
}

// =============================================================================
// Create
// =============================================================================

export function createPendingAsk(record: Omit<PendingAskRecord, 'id'>): string {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const requestId = record.requestId || crypto.randomUUID();

  db.run(
    `INSERT INTO pending_asks (
      id, request_id, session_id, root_session_id, origin_session_id, workspace_id,
      tool_call_id, tool_name, ask_json, status, is_permission, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      requestId,
      record.sessionId,
      record.rootSessionId ?? null,
      record.originSessionId ?? null,
      record.workspaceId ?? null,
      record.toolCallId,
      record.toolName,
      JSON.stringify(record.ask),
      record.status || 'pending',
      record.isPermission ? 1 : 0,
      record.expiresAt ?? null,
      record.createdAt,
    ],
  );
  return id;
}

// =============================================================================
// Read / Query
// =============================================================================

export function getPermissionRequestById(id: string): PendingAskRecord | null {
  const db = getDatabase();
  const row = db
    .query('SELECT * FROM pending_asks WHERE id = ?')
    .get(id) as PendingAskRow | undefined;
  return row ? mapRowToPendingAsk(row) : null;
}

export function getPermissionRequestByRequestId(requestId: string): PendingAskRecord | null {
  const db = getDatabase();
  const row = db
    .query('SELECT * FROM pending_asks WHERE request_id = ?')
    .get(requestId) as PendingAskRow | undefined;
  return row ? mapRowToPendingAsk(row) : null;
}

export function removePendingAsk(id: string): void {
  const db = getDatabase();
  db.run('DELETE FROM pending_asks WHERE id = ?', [id]);
}

export function removePendingAsksByToolCallId(toolCallId: string): void {
  const db = getDatabase();
  db.run('DELETE FROM pending_asks WHERE tool_call_id = ?', [toolCallId]);
}

export function listPendingAsksBySession(sessionId: string): PendingAskRecord[] {
  const db = getDatabase();
  const rows = db
    .query('SELECT * FROM pending_asks WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as PendingAskRow[];
  return rows.map(mapRowToPendingAsk);
}

function mapRowToPendingAsk(row: PendingAskRow): PendingAskRecord {
  return {
    id: row.id,
    requestId: row.request_id ?? row.id,
    sessionId: row.session_id,
    rootSessionId: row.root_session_id ?? undefined,
    originSessionId: row.origin_session_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    ask: JSON.parse(row.ask_json),
    status: (row.status || 'pending') as PermissionRequestStatus,
    isPermission: row.is_permission === 1,
    expiresAt: row.expires_at ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    resolution: row.resolution_json ? JSON.parse(row.resolution_json) : undefined,
    createdAt: row.created_at,
  };
}

export function listPendingAsksByRootSession(rootSessionId: string): PendingAskRecord[] {
  const db = getDatabase();

  const rows = db
    .query(
      `WITH RECURSIVE descendants(id) AS (
        SELECT id FROM sessions WHERE id = ?
        UNION ALL
        SELECT s.id FROM sessions s
        INNER JOIN descendants d ON s.parent_id = d.id
      )
      SELECT pa.* FROM pending_asks pa
      WHERE pa.session_id IN (SELECT id FROM descendants)
      ORDER BY pa.created_at ASC`,
    )
    .all(rootSessionId) as PendingAskRow[];
  return rows.map(mapRowToPendingAsk);
}

export function listAllPendingAsks(): PendingAskRecord[] {
  const db = getDatabase();
  const rows = db
    .query('SELECT * FROM pending_asks ORDER BY created_at ASC')
    .all() as PendingAskRow[];
  return rows.map(mapRowToPendingAsk);
}

// =============================================================================
// Permission Request Lifecycle APIs (Phase 1)
// =============================================================================

/**
 * List all pending (status = 'pending') permission requests for a root session
 * and its descendants. Used for reconnect replay.
 */
export function listPendingRequestsByRootSession(rootSessionId: string): PendingAskRecord[] {
  const db = getDatabase();

  const descendantIds: string[] = [];
  const queue = [rootSessionId];
  while (queue.length > 0) {
    const currentParentId = queue.shift()!;
    const children = db
      .query('SELECT id FROM sessions WHERE parent_id = ?')
      .all(currentParentId) as { id: string }[];
    for (const child of children) {
      descendantIds.push(child.id);
      queue.push(child.id);
    }
  }

  const allIds = [rootSessionId, ...descendantIds];
  const placeholders = allIds.map(() => '?').join(',');
  const rows = db
    .query(
      `SELECT * FROM pending_asks
       WHERE status = 'pending' AND session_id IN (${placeholders})
       ORDER BY created_at ASC`,
    )
    .all(...allIds) as PendingAskRow[];
  return rows.map(mapRowToPendingAsk);
}

/**
 * Resolve a permission request by its DB id.
 * Updates status, resolved_at, and resolution payload.
 */
export function resolvePermissionRequest(
  id: string,
  status: 'approved' | 'denied',
  resolution?: unknown,
): boolean {
  const db = getDatabase();
  const now = Date.now();
  const result = db.run(
    `UPDATE pending_asks
     SET status = ?, resolved_at = ?, resolution_json = ?
     WHERE id = ? AND status = 'pending'`,
    [status, now, resolution ? JSON.stringify(resolution) : null, id],
  );
  return result.changes > 0;
}

/**
 * Resolve a permission request by requestId.
 */
export function resolvePermissionRequestByRequestId(
  requestId: string,
  status: 'approved' | 'denied',
  resolution?: unknown,
): boolean {
  const db = getDatabase();
  const now = Date.now();
  const result = db.run(
    `UPDATE pending_asks
     SET status = ?, resolved_at = ?, resolution_json = ?
     WHERE request_id = ? AND status = 'pending'`,
    [status, now, resolution ? JSON.stringify(resolution) : null, requestId],
  );
  return result.changes > 0;
}

/**
 * Expire a single permission request by id.
 * Used by the timeout path.
 */
export function expirePermissionRequest(id: string): boolean {
  const db = getDatabase();
  const now = Date.now();
  const result = db.run(
    `UPDATE pending_asks SET status = 'expired', resolved_at = ? WHERE id = ? AND status = 'pending'`,
    [now, id],
  );
  return result.changes > 0;
}

/**
 * Cancel all pending permission requests for a session.
 * Used on session interrupt / close.
 */
export function cancelPendingRequestsBySession(sessionId: string): number {
  const db = getDatabase();
  const now = Date.now();
  const result = db.run(
    `UPDATE pending_asks SET status = 'cancelled', resolved_at = ? WHERE session_id = ? AND status = 'pending'`,
    [now, sessionId],
  );
  return result.changes;
}

/**
 * Expire all permission requests older than a given age.
 * Used for periodic cleanup.
 */
export function expireOldPermissionRequests(maxAgeMs: number): number {
  const db = getDatabase();
  const cutoff = Date.now() - maxAgeMs;
  const result = db.run(
    `UPDATE pending_asks SET status = 'expired', resolved_at = ?
     WHERE status = 'pending' AND created_at < ?`,
    [Date.now(), cutoff],
  );
  return result.changes;
}

// =============================================================================
// Legacy Cleanup
// =============================================================================

export function cleanupAllPendingAsks(maxAgeMs?: number): number {
  const db = getDatabase();

  if (maxAgeMs !== undefined) {
    const now = Date.now();
    const cutoff = now - maxAgeMs;

    const expireResult = db.run(
      `UPDATE pending_asks
       SET status = 'expired', resolved_at = ?
       WHERE status = 'pending' AND created_at < ?`,
      [now, cutoff],
    );

    const deleteTerminalResult = db.run(
      `DELETE FROM pending_asks
       WHERE status IN ('approved', 'denied', 'expired', 'cancelled')
       AND created_at < ?`,
      [cutoff],
    );

    return expireResult.changes + deleteTerminalResult.changes;
  }

  const result = db.run('DELETE FROM pending_asks');
  return result.changes;
}
