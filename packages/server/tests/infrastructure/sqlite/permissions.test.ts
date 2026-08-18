import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import {
  getWorkspaceGrants,
  matchGrant,
  createGrantFromOptions,
  revokeGrant,
  revokeAllWorkspaceGrants,
} from '@/infrastructure/sqlite/permissions';

describe('permissions store', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  // ===========================================================================
  // Canonical Permission Grants
  // ===========================================================================

  describe('canonical grants', () => {
    test('createGrantFromOptions with workspace scope persists', () => {
      seedWorkspace({ id: 'ws1' });
      const grant = createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['npm test'] },
      });

      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe('workspace');
      expect(grant!.matcher).toBe('exact');
      expect(grant!.patterns).toEqual(['npm test']);
      expect(grant!.allowed).toBe(true);
    });

    test('createGrantFromOptions with once scope is NOT persisted', () => {
      seedWorkspace({ id: 'ws1' });
      const grant = createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'rm -rf /',
        grantOptions: { scope: 'once', matcher: 'exact' },
      });

      expect(grant).not.toBeNull();
      expect(grant!.scope).toBe('once');

      // Should not be in the database
      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'rm -rf /',
      });
      expect(result.matched).toBe(false);
    });

    test('matchGrant with exact matcher', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['npm test'] },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
      });
      expect(result.matched).toBe(true);
      expect(result.grant).not.toBeNull();
    });

    test('matchGrant with exact matcher does not match different key', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['npm test'] },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm build',
      });
      expect(result.matched).toBe(false);
    });

    test('matchGrant with prefix matcher', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'read-file',
        resource: 'file',
        permissionKey: '/project/src/',
        grantOptions: { scope: 'workspace', matcher: 'prefix', patterns: ['/project/src/'] },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'read-file',
        resource: 'file',
        permissionKey: '/project/src/index.ts',
      });
      expect(result.matched).toBe(true);
    });

    test('matchGrant with shell-command matcher (prefix wildcard)', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'shell-command', patterns: ['npm *'] },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm build',
      });
      expect(result.matched).toBe(true);
    });

    test('matchGrant with shell-command matcher (suffix wildcard)', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'test',
        grantOptions: { scope: 'workspace', matcher: 'shell-command', patterns: ['*test'] },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
      });
      expect(result.matched).toBe(true);
    });

    test('matchGrant with shell-command matcher is case insensitive', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'NPM TEST',
        grantOptions: { scope: 'workspace', matcher: 'shell-command', patterns: ['npm test'] },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'NPM TEST',
      });
      expect(result.matched).toBe(true);
    });

    test('matchGrant does not match different tool', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['npm test'] },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'read-file',
        resource: 'file',
        permissionKey: 'npm test',
      });
      expect(result.matched).toBe(false);
    });

    test('matchGrant does not match different workspace', () => {
      seedWorkspace({ id: 'ws1' });
      seedWorkspace({ id: 'ws2' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['npm test'] },
      });

      const result = matchGrant({
        workspaceId: 'ws2',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
      });
      expect(result.matched).toBe(false);
    });

    test('getWorkspaceGrants returns active grants', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['npm test'] },
      });

      const grants = getWorkspaceGrants('ws1');
      expect(grants).toHaveLength(1);
    });

    test('getWorkspaceGrants excludes revoked by default', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['npm test'] },
      });

      const grants = getWorkspaceGrants('ws1');
      revokeGrant(grants[0].id);

      expect(getWorkspaceGrants('ws1')).toHaveLength(0);
    });

    test('getWorkspaceGrants includes revoked when option set', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['npm test'] },
      });

      const grants = getWorkspaceGrants('ws1');
      revokeGrant(grants[0].id);

      const allGrants = getWorkspaceGrants('ws1', { includeRevoked: true });
      expect(allGrants).toHaveLength(1);
      expect(allGrants[0].revokedAt).not.toBeNull();
    });

    test('revokeGrant marks grant as revoked', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['npm test'] },
      });

      const grants = getWorkspaceGrants('ws1');
      const result = revokeGrant(grants[0].id);

      expect(result).toBe(true);
      // Revoked grant should not match
      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
      }).matched).toBe(false);
    });

    test('revokeAllWorkspaceGrants revokes all grants', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['npm test'] },
      });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'read-file',
        resource: 'file',
        permissionKey: '/test/',
        grantOptions: { scope: 'workspace', matcher: 'prefix', patterns: ['/test/'] },
      });

      const count = revokeAllWorkspaceGrants('ws1');
      expect(count).toBe(2);
      expect(getWorkspaceGrants('ws1')).toHaveLength(0);
    });

    test('matchGrant with multiple patterns matches any', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['npm test', 'npm build', 'npm run'] },
      });

      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm build',
      }).matched).toBe(true);

      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
      }).matched).toBe(true);
    });

    test('matchGrant with session scope and expiration', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
        grantOptions: { scope: 'session', matcher: 'exact', patterns: ['npm test'], duration: 3600000 },
      });

      // Should match immediately
      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'npm test',
      }).matched).toBe(true);
    });
  });
});
