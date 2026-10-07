import {
  getWorkspaceGrants,
  revokeAllWorkspaceGrants,
  revokeGrant,
} from '@/infrastructure/sqlite/permissions';
import type { PermissionGrantRepositoryPort } from '@/application/ports/permissions';

export function createProkopPermissionRepositoryPort(): PermissionGrantRepositoryPort {
  return {
    list: getWorkspaceGrants,
    revoke: revokeGrant,
    revokeAll: revokeAllWorkspaceGrants,
  };
}
