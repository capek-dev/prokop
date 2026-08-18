import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import {
  getWorkspaceGrants,
  matchGrant,
  createGrantFromOptions,
  revokeGrant,
} from '@/infrastructure/sqlite/permissions';

// =============================================================================
// Test Suite B — Grant Matching Tests (Target-Based)
//
// Verifies that persisted grants match only intended targets and do not
// accidentally match broader or unrelated resources.
// =============================================================================

describe('grant matching — target-based permissions', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  // ===========================================================================
  // File Read Grants — Exact Matcher
  // ===========================================================================

  describe('file read grants', () => {
    test('read grant for /workspace/.env matches only .env', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
      });
      expect(result.matched).toBe(true);
    });

    test('read grant for /workspace/.env does NOT match /workspace/.env.backup', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env.backup',
      });
      expect(result.matched).toBe(false);
    });

    test('read grant for /workspace/.env does NOT match /workspace/package.json', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/package.json',
      });
      expect(result.matched).toBe(false);
    });

    test('read grant for /workspace/.env does NOT match different tool', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'read-file',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
      });
      expect(result.matched).toBe(false);
    });

    test('read grant without action matches any action for that resource', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'] },
      });

      // Should match a read request
      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
      }).matched).toBe(true);

      // Should also match a write request (no action restriction on grant)
      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'write',
        permissionKey: '/workspace/.env',
      }).matched).toBe(true);
    });

    test('read grant with action=read does NOT match write request', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'write',
        permissionKey: '/workspace/.env',
      });
      expect(result.matched).toBe(false);
    });

    test('read grant with action=read does NOT match delete request', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      const result = matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'delete',
        permissionKey: '/workspace/.env',
      });
      expect(result.matched).toBe(false);
    });
  });

  // ===========================================================================
  // File Delete Grants — Prefix Matcher
  // ===========================================================================

  describe('file delete grants', () => {
    test('delete prefix grant for /workspace/build/ matches nested paths', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'delete',
        permissionKey: '/workspace/build/',
        grantOptions: { scope: 'session', matcher: 'prefix', patterns: ['/workspace/build/'], action: 'delete' },
      });

      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'delete',
        permissionKey: '/workspace/build/index.js',
      }).matched).toBe(true);

      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'delete',
        permissionKey: '/workspace/build/src/main.ts',
      }).matched).toBe(true);
    });

    test('delete prefix grant for /workspace/build/ does NOT match /workspace/build-config/', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'delete',
        permissionKey: '/workspace/build/',
        grantOptions: { scope: 'session', matcher: 'prefix', patterns: ['/workspace/build/'], action: 'delete' },
      });

      // Note: "build-config/" starts with "build/" — this WILL match with prefix
      // This is expected behavior for prefix matching. The trailing slash ensures
      // "build" alone doesn't match "build-config", but "build/" would.
      // Actually "build-config/".startsWith("build/") is false, so this won't match.
      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'delete',
        permissionKey: '/workspace/build-config/',
      }).matched).toBe(false);
    });

    test('delete prefix grant does NOT match read requests', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'delete',
        permissionKey: '/workspace/build/',
        grantOptions: { scope: 'session', matcher: 'prefix', patterns: ['/workspace/build/'], action: 'delete' },
      });

      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/build/index.js',
      }).matched).toBe(false);
    });
  });

  // ===========================================================================
  // Network Grants — Exact Matcher
  // ===========================================================================

  describe('network grants', () => {
    test('network grant for api.example.com matches exact host', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'network',
        action: 'request',
        permissionKey: 'api.example.com',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['api.example.com'], action: 'request' },
      });

      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'network',
        action: 'request',
        permissionKey: 'api.example.com',
      }).matched).toBe(true);
    });

    test('network grant for api.example.com does NOT match other.example.com', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'network',
        action: 'request',
        permissionKey: 'api.example.com',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['api.example.com'], action: 'request' },
      });

      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'network',
        action: 'request',
        permissionKey: 'other.example.com',
      }).matched).toBe(false);
    });

    test('network grant does NOT match file resource', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'network',
        action: 'request',
        permissionKey: 'api.example.com',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['api.example.com'], action: 'request' },
      });

      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: 'api.example.com',
      }).matched).toBe(false);
    });
  });

  // ===========================================================================
  // Shell-Command Grants vs File Grants — Isolation
  // ===========================================================================

  describe('shell-command vs file grant isolation', () => {
    test('shell-command fallback grant does NOT cover structured file asks', () => {
      seedWorkspace({ id: 'ws1' });
      // Create a shell-command grant (e.g., from a fallback sudo command)
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'cat',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['cat'] },
      });

      // This should NOT match a file-read request for .env
      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
      }).matched).toBe(false);
    });

    test('file read grant does NOT cover shell-command asks', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'shell-command',
        permissionKey: 'cat',
      }).matched).toBe(false);
    });
  });

  // ===========================================================================
  // Action Field on Grants
  // ===========================================================================

  describe('grant action field', () => {
    test('grant created with action field stores it', () => {
      seedWorkspace({ id: 'ws1' });
      const grant = createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      expect(grant).not.toBeNull();
      expect(grant!.action).toBe('read');
    });

    test('grant without action field has undefined action', () => {
      seedWorkspace({ id: 'ws1' });
      const grant = createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'] },
      });

      expect(grant).not.toBeNull();
      expect(grant!.action).toBeUndefined();
    });

    test('action-aware grant visible in getWorkspaceGrants', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      const grants = getWorkspaceGrants('ws1');
      expect(grants).toHaveLength(1);
      expect(grants[0].action).toBe('read');
    });
  });

  // ===========================================================================
  // Revoked and Expired Grants
  // ===========================================================================

  describe('revoked and expired grants', () => {
    test('revoked grant does not match', () => {
      seedWorkspace({ id: 'ws1' });
      createGrantFromOptions({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      const grants = getWorkspaceGrants('ws1');
      revokeGrant(grants[0].id);

      expect(matchGrant({
        workspaceId: 'ws1',
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
      }).matched).toBe(false);
    });
  });
});
