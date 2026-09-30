import type { PermissionMode } from './concerns';

/**
 * TEMPORARY bridge (permissions v2, slice 2): maps the three-level permission
 * mode onto the legacy risk-severity ladder while the severity consumers
 * (capek runtime auto-approve, the native harness approval ladders, the
 * client ask handler) still decide. Deleted in slice 4 when decide() becomes
 * the only authority. There is no ask-everything level: it was removed by
 * design, so nothing maps below 'low'.
 */
export type LegacyAutoApproveSeverity = 'none' | 'low' | 'medium' | 'high';

export function severityFromMode(mode: PermissionMode): LegacyAutoApproveSeverity {
  return mode === 'full' ? 'high' : mode === 'extended' ? 'medium' : 'low';
}
