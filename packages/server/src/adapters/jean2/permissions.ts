import {
  getWorkspaceGrants,
  revokeAllWorkspaceGrants,
  revokeGrant,
} from '@/infrastructure/sqlite/permissions';
import type { PermissionGrantRepositoryPort } from '@/application/ports/permissions';

export function createJean2PermissionRepositoryPort(): PermissionGrantRepositoryPort {
  return {
    list: getWorkspaceGrants,
    revoke: revokeGrant,
    revokeAll: revokeAllWorkspaceGrants,
  };
}
