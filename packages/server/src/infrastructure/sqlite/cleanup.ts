import { getDatabase } from './database';
import { removeSessionFromFts } from '@/infrastructure/session-search/fts';

export interface CleanupStats {
  orphanedParts: number;
  orphanedMessages: number;
  orphanedPendingAsks: number;
  orphanedQueuedMessages: number;
  orphanedAttachments: number;
  orphanedPinnedMessages: number;
  orphanedSessions: number;
  orphanedPermissionGrants: number;
  orphanedWorkspacePaths: number;
  orphanedTerminalSessions: number;
  orphanedFtsRows: number;
}

export function cleanupOrphanedData(): CleanupStats {
  const db = getDatabase();
  const stats: CleanupStats = {
    orphanedParts: 0,
    orphanedMessages: 0,
    orphanedPendingAsks: 0,
    orphanedQueuedMessages: 0,
    orphanedAttachments: 0,
    orphanedPinnedMessages: 0,
    orphanedSessions: 0,
    orphanedPermissionGrants: 0,
    orphanedWorkspacePaths: 0,
    orphanedTerminalSessions: 0,
    orphanedFtsRows: 0,
  };

  db.transaction(() => {
    stats.orphanedParts = db.run('DELETE FROM parts WHERE message_id NOT IN (SELECT id FROM messages)').changes;
    stats.orphanedParts += db.run('DELETE FROM parts WHERE session_id NOT IN (SELECT id FROM sessions)').changes;

    const orphanedMsgSessionIds = db.query(
      'SELECT DISTINCT session_id FROM messages WHERE session_id NOT IN (SELECT id FROM sessions)',
    ).all() as { session_id: string }[];
    stats.orphanedMessages = db.run(
      'DELETE FROM messages WHERE session_id NOT IN (SELECT id FROM sessions)',
    ).changes;
    for (const { session_id } of orphanedMsgSessionIds) {
      try { removeSessionFromFts(db, session_id); } catch { /* best effort */ }
    }

    stats.orphanedPendingAsks = db.run('DELETE FROM pending_asks WHERE session_id NOT IN (SELECT id FROM sessions)').changes;
    stats.orphanedQueuedMessages = db.run('DELETE FROM queued_messages WHERE session_id NOT IN (SELECT id FROM sessions)').changes;
    stats.orphanedAttachments = db.run('DELETE FROM attachments WHERE session_id NOT IN (SELECT id FROM sessions)').changes;
    stats.orphanedPinnedMessages = db.run('DELETE FROM pinned_messages WHERE session_id NOT IN (SELECT id FROM sessions)').changes;

    const orphanedSessionIds = db.query(
      'SELECT id FROM sessions WHERE workspace_id NOT IN (SELECT id FROM workspaces)',
    ).all() as { id: string }[];
    stats.orphanedSessions = db.run(
      'DELETE FROM sessions WHERE workspace_id NOT IN (SELECT id FROM workspaces)',
    ).changes;
    for (const { id } of orphanedSessionIds) {
      try { removeSessionFromFts(db, id); } catch { /* best effort */ }
    }

    stats.orphanedPermissionGrants = db.run('DELETE FROM permission_grants WHERE workspace_id NOT IN (SELECT id FROM workspaces)').changes;
    stats.orphanedWorkspacePaths = db.run('DELETE FROM workspace_paths WHERE workspace_id NOT IN (SELECT id FROM workspaces)').changes;
    stats.orphanedTerminalSessions = db.run('DELETE FROM terminal_sessions WHERE workspace_id NOT IN (SELECT id FROM workspaces)').changes;
    stats.orphanedFtsRows = db.run('DELETE FROM messages_fts WHERE session_id NOT IN (SELECT id FROM sessions)').changes;
  })();

  return stats;
}

export interface VacuumResult {
  reclaimedBytes: number;
  pageSizeBefore: number;
  pageSizeAfter: number;
  pageCountBefore: number;
  pageCountAfter: number;
}

export function vacuumDatabase(options?: { dryRun?: boolean }): VacuumResult {
  const db = getDatabase();
  if (!options?.dryRun) cleanupOrphanedData();

  const sizeBefore = (db.query('PRAGMA page_count').get() as { page_count?: number })?.page_count ?? 0;
  const pagesBefore = (db.query('PRAGMA page_size').get() as { page_size?: number })?.page_size ?? 4096;
  const bytesBefore = sizeBefore * pagesBefore;

  if (options?.dryRun) {
    const freelist = (db.query('PRAGMA freelist_count').get() as { freelist_count?: number })?.freelist_count ?? 0;
    return {
      reclaimedBytes: freelist * pagesBefore,
      pageSizeBefore: bytesBefore,
      pageSizeAfter: bytesBefore,
      pageCountBefore: sizeBefore,
      pageCountAfter: sizeBefore,
    };
  }

  db.run('PRAGMA wal_checkpoint(TRUNCATE)');
  db.run('VACUUM');
  const sizeAfter = (db.query('PRAGMA page_count').get() as { page_count?: number })?.page_count ?? 0;
  const pagesAfter = (db.query('PRAGMA page_size').get() as { page_size?: number })?.page_size ?? 4096;
  const bytesAfter = sizeAfter * pagesAfter;
  return {
    reclaimedBytes: Math.max(0, bytesBefore - bytesAfter),
    pageSizeBefore: bytesBefore,
    pageSizeAfter: bytesAfter,
    pageCountBefore: sizeBefore,
    pageCountAfter: sizeAfter,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
