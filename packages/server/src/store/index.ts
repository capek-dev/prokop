/**
 * Compatibility surface for the legacy store imports.
 *
 * Database ownership, schema initialization, migrations, and the singleton
 * live in infrastructure/sqlite/database.ts. Store modules keep their public
 * export identities while repositories and adapters migrate incrementally.
 */
export {
  DB,
  closeDatabase,
  getDatabase,
  initializeSchema,
  runMigrations,
  Database,
} from '@/infrastructure/sqlite/database';

export * from './sessions';
export * from './messages';
export * from './workspaces';
export * from './permissions';
export * from './queued-messages';
export * from './terminal-sessions';
export * from './tool-output-artifacts';
export {
  cleanupSessionOutputDir,
  cleanupSessionsOutputDirs,
  cleanupWorkspaceSessionsOutputDirs,
  deleteSessionsByWorkspace,
} from './sessions';
export { findOrphanedCompactionTriggers } from './messages';
export { reconcileSessionCompaction, reconcileAllSessionsCompaction } from './compaction-recovery';
export * from './attachments';
export { deleteAttachmentsForSession, deleteAttachmentsForWorkspace, getAttachment } from './attachments';
export * from './pending-asks';
export * from './response-formats';
export * from './pinned-messages';
export { cleanupOrphanedData, vacuumDatabase } from './cleanup';
export type { CleanupStats, VacuumResult } from './cleanup';
export * from './scheduled-jobs';
export * from './web-push';
