import type { PermissionGrant } from '@prokopai/sdk';

export interface PermissionGrantRepositoryPort {
  list(workspaceId: string, options?: { includeRevoked?: boolean }): PermissionGrant[];
  revoke(grantId: string, revokedBy?: string | null): boolean;
  revokeAll(workspaceId: string, revokedBy?: string | null): number;
}
