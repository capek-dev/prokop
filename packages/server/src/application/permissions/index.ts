import type { PermissionGrant } from '@jean2/sdk';
import type { PermissionGrantRepositoryPort } from '../ports/permissions';

export interface PermissionsApplication {
  list(workspaceId: string, options?: { includeRevoked?: boolean }): PermissionGrant[];
  revoke(grantId: string, revokedBy?: string | null): boolean;
  revokeAll(workspaceId: string, revokedBy?: string | null): number;
}

export interface PermissionsApplicationDeps {
  repository: PermissionGrantRepositoryPort;
}

export function createPermissionsApplication(
  deps: PermissionsApplicationDeps,
): PermissionsApplication {
  return {
    list(workspaceId, options) {
      return deps.repository.list(workspaceId, options);
    },
    revoke(grantId, revokedBy) {
      return deps.repository.revoke(grantId, revokedBy);
    },
    revokeAll(workspaceId, revokedBy) {
      return deps.repository.revokeAll(workspaceId, revokedBy);
    },
  };
}
