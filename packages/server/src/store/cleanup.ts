/** Compatibility exports for infrastructure-owned database maintenance. */
export {
  cleanupOrphanedData,
  vacuumDatabase,
  formatBytes,
} from '@/infrastructure/sqlite/cleanup';
export type {
  CleanupStats,
  VacuumResult,
} from '@/infrastructure/sqlite/cleanup';
