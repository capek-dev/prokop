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

export interface VacuumResult {
  reclaimedBytes: number;
  pageSizeBefore: number;
  pageSizeAfter: number;
  pageCountBefore: number;
  pageCountAfter: number;
}

export interface MaintenanceApplication {
  cleanup(): CleanupStats;
  vacuum(options?: { dryRun?: boolean }): VacuumResult;
}
