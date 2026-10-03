import { useCallback, useEffect, useState } from 'react';
import type { PermissionGrant, ProkopaiClient } from '@prokopai/sdk';

/** Settings can inspect a workspace independently of the active conversation. */
export function useWorkspacePermissions(client: ProkopaiClient | null, workspaceId: string): {
  permissions: PermissionGrant[];
  refresh: () => void;
  revoke: (id: string) => void;
  revokeAll: () => void;
} {
  const [result, setResult] = useState<{ client: ProkopaiClient; workspaceId: string; grants: PermissionGrant[] }>();
  const refresh = useCallback(() => {
    if (client?.connected) client.permissions.list(workspaceId, true);
  }, [client, workspaceId]);

  useEffect(() => {
    if (!client) return;
    const onList = (id: string, grants: PermissionGrant[]) => {
      if (id === workspaceId) setResult({ client, workspaceId, grants });
    };
    const onRevoked = (grantId: string) => {
      setResult(current => current && current.client === client && current.workspaceId === workspaceId
        ? { ...current, grants: current.grants.map(grant => grant.id === grantId
          ? { ...grant, revokedAt: new Date().toISOString() } : grant) }
        : current);
    };
    const onAllRevoked = (id: string) => {
      if (id === workspaceId) refresh();
    };
    client.on('permission.list', onList);
    client.on('permission.revoked', onRevoked);
    client.on('permission.all_revoked', onAllRevoked);
    client.on('connected', refresh);
    refresh();
    return () => {
      client.off('permission.list', onList);
      client.off('permission.revoked', onRevoked);
      client.off('permission.all_revoked', onAllRevoked);
      client.off('connected', refresh);
    };
  }, [client, workspaceId, refresh]);

  return {
    permissions: result?.client === client && result?.workspaceId === workspaceId ? result.grants : [],
    refresh,
    revoke: (id: string) => { if (client?.connected) client.permissions.revoke(id); },
    revokeAll: () => { if (client?.connected) client.permissions.revokeAll(workspaceId); },
  };
}
