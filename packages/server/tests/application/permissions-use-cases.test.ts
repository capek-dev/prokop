import { describe, expect, test } from 'bun:test';
import type { PermissionGrant } from '@prokopai/sdk';
import {
  createPermissionsApplication,
  type PermissionsApplication,
} from '@/application/permissions';
import type { PermissionGrantRepositoryPort } from '@/application/ports/permissions';

const grant = { id: 'grant-1' } as PermissionGrant;

function createApplication(overrides: Partial<PermissionGrantRepositoryPort> = {}): {
  app: PermissionsApplication;
  calls: string[];
} {
  const calls: string[] = [];
  const repository: PermissionGrantRepositoryPort = {
    list: (workspaceId, options) => {
      calls.push(`list:${workspaceId}:${options?.includeRevoked ?? false}`);
      return [grant];
    },
    revoke: (grantId, revokedBy) => {
      calls.push(`revoke:${grantId}:${revokedBy ?? ''}`);
      return true;
    },
    revokeAll: (workspaceId, revokedBy) => {
      calls.push(`revokeAll:${workspaceId}:${revokedBy ?? ''}`);
      return 2;
    },
    ...overrides,
  };
  return { app: createPermissionsApplication({ repository }), calls };
}

describe('permissions application', () => {
  test('delegates list and preserves the repository result', () => {
    const { app, calls } = createApplication();
    expect(app.list('workspace-1', { includeRevoked: true })).toEqual([grant]);
    expect(calls).toEqual(['list:workspace-1:true']);
  });

  test('delegates revoke operations and preserves synchronous results', () => {
    const { app, calls } = createApplication();
    expect(app.revoke('grant-1', null)).toBe(true);
    expect(app.revokeAll('workspace-1', null)).toBe(2);
    expect(calls).toEqual(['revoke:grant-1:', 'revokeAll:workspace-1:']);
  });
});
