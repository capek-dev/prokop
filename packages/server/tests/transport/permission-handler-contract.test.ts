import { afterEach, describe, expect, test } from 'bun:test';
import type { PermissionGrant, ServerMessage } from '@jean2/sdk';
import { installWireApplication, type WireApplication } from '@/transport/websocket/application';
import {
  handlePermissionList,
  handlePermissionRevoke,
  handlePermissionRevokeAll,
} from '@/transport/websocket/handlers/permissions';
import type { PermissionsApplication } from '@/application/permissions';
import type { SessionApplication, SessionControlApplication } from '@/application';
import type { ProvidersApplication } from '@/application/providers';
import type { NotificationsApplication } from '@/application/notifications';
import type { RouterContext } from '@/transport/websocket/router-context';
import type { ConnectionId } from '@/transport/websocket/connection-id';

const connectionId = 'connection-1' as ConnectionId;

function makeContext(sent: ServerMessage[]): RouterContext<ConnectionId> {
  return {
    send: (_origin, message) => sent.push(message),
    broadcast: () => {},
    broadcastToSession: () => {},
    sendToController: () => {},
    sendToAskTargets: () => {},
    clients: new Map(),
  };
}

function makeNotifications(): NotificationsApplication {
  return {} as NotificationsApplication;
}

function installPermissions(permissions: PermissionsApplication): void {
  const wire: WireApplication = {
    session: {} as SessionApplication<ConnectionId>,
    control: {} as SessionControlApplication<ConnectionId>,
    providers: {} as ProvidersApplication,
    notifications: makeNotifications(),
    permissions,
  };
  installWireApplication(wire);
}

afterEach(() => {
  installPermissions({
    list: () => [],
    revoke: () => false,
    revokeAll: () => 0,
  });
});

describe('permission wire handler contract', () => {
  test('lists grants with the exact server message', () => {
    const sent: ServerMessage[] = [];
    const grants = [{ id: 'grant-1' } as PermissionGrant];
    installPermissions({
      list: (workspaceId, options) => {
        expect(workspaceId).toBe('workspace-1');
        expect(options).toEqual({ includeRevoked: true });
        return grants;
      },
      revoke: () => false,
      revokeAll: () => 0,
    });

    handlePermissionList(makeContext(sent), connectionId, {
      type: 'permission.list',
      workspaceId: 'workspace-1',
      includeRevoked: true,
    });

    expect(sent).toEqual([{
      type: 'permission.list',
      workspaceId: 'workspace-1',
      grants,
    }]);
  });

  test('revoke handlers preserve exact messages and counts', () => {
    const sent: ServerMessage[] = [];
    installPermissions({
      list: () => [],
      revoke: (grantId, revokedBy) => {
        expect(grantId).toBe('grant-1');
        expect(revokedBy).toBeNull();
        return true;
      },
      revokeAll: (workspaceId, revokedBy) => {
        expect(workspaceId).toBe('workspace-1');
        expect(revokedBy).toBeNull();
        return 3;
      },
    });
    const context = makeContext(sent);

    handlePermissionRevoke(context, connectionId, {
      type: 'permission.revoke',
      grantId: 'grant-1',
    });
    handlePermissionRevokeAll(context, connectionId, {
      type: 'permission.revoke_all',
      workspaceId: 'workspace-1',
    });

    expect(sent).toEqual([
      { type: 'permission.revoked', grantId: 'grant-1' },
      { type: 'permission.all_revoked', workspaceId: 'workspace-1', count: 3 },
    ]);
  });
});
