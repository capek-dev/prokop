import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getRuntimeHost as getProkopCompatibilityBindings } from '@/infrastructure/runtime/host';
import {
  configureProkopBindings,
  prokopCompatibilityBindings,
} from '@/harnesses/prokop/composition/bindings';
import { deliverCapekEvent } from '@/harnesses/prokop/host/events';
import { prokopDeliveryBindings } from '@/harnesses/prokop/host/delivery';
import { prokopInteractionBindings } from '@/harnesses/prokop/host/interaction';
import { prokopSandboxBindings } from '@/harnesses/prokop/host/sandbox';
import { prokopTitleBindings } from '@/harnesses/prokop/host/titles';
import { prokopToolPolicy } from '@/harnesses/prokop/host/tool-policy';
import { prokopWorkspaceBindings } from '@/harnesses/prokop/host/workspace';
import { generateSessionTitle, hasManualSessionTitle, isDefaultSessionTitle } from '@/infrastructure/session-title';
import { isSandboxActive } from '@/infrastructure/sandbox';
import { getPermissionTimeoutMs } from '@/infrastructure/runtime/environment';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { getProkopNotificationsApplication } from '@/adapters/prokop/notifications';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';
import { getTestDataDir, resetTestDataDir, setupTestDataDir } from '#tests/test-dir';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import type { ToolDefinition } from '@prokopai/sdk/tool';

describe('Čapek binding group adapters', () => {
  beforeEach(() => {
    setupTestDataDir();
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
    resetTestDataDir();
  });

  test('interaction group keeps the async operations and identities', async () => {
    expect(Object.keys(prokopInteractionBindings).sort()).toEqual([
      'createPendingAsk', 'removePendingAsk', 'removePendingAsksByToolCallId',
      'getPermissionRequestByRequestId', 'resolvePermissionRequestByRequestId',
      'expirePermissionRequest', 'expireOldPermissionRequests', 'cancelPendingRequestsBySession',
      'listPendingAsksBySession', 'listPendingAsksByRootSession', 'listPendingRequestsByRootSession',
      'matchGrant', 'createGrantFromOptions', 'getSessionAutoApproveSeverity',
      'getPermissionTimeoutMs', 'notifyPermissionRequired',
    ].sort());

    expect(prokopInteractionBindings.getPermissionTimeoutMs).toBe(getPermissionTimeoutMs);
    expect(typeof prokopInteractionBindings.createPendingAsk).toBe('function');
    expect(typeof prokopInteractionBindings.notifyPermissionRequired).toBe('function');
    expect(getProkopNotificationsApplication().notifyPermissionRequired).toBeDefined();
  });

  test('interaction auto-approve severity reads the session record, inheriting the standard default', async () => {
    seedWorkspace({ id: 'ws1' });
    const withSeverity = seedSession('ws1', { permissionMode: 'extended' });
    const withoutSeverity = seedSession('ws1');

    expect(await prokopInteractionBindings.getSessionAutoApproveSeverity?.(withSeverity.id)).toBe('medium');
    expect(await prokopInteractionBindings.getSessionAutoApproveSeverity?.(withoutSeverity.id)).toBe('low');
    expect(await prokopInteractionBindings.getSessionAutoApproveSeverity?.('missing')).toBeUndefined();
    expect(getSession(withSeverity.id)?.permissionMode).toBe('extended');
  });

  test('title, sandbox, and delivery groups keep the exact operations', () => {
    expect(Object.keys(prokopTitleBindings).sort()).toEqual(
      ['isDefaultSessionTitle', 'hasManualSessionTitle', 'generateSessionTitle'].sort(),
    );
    expect(prokopTitleBindings.isDefaultSessionTitle).toBe(isDefaultSessionTitle);
    expect(prokopTitleBindings.hasManualSessionTitle).toBe(hasManualSessionTitle);
    expect(prokopTitleBindings.generateSessionTitle).toBe(generateSessionTitle);

    expect(Object.keys(prokopSandboxBindings)).toEqual(['isSandboxActive']);
    expect(prokopSandboxBindings.isSandboxActive).toBe(isSandboxActive);

    expect(Object.keys(prokopDeliveryBindings)).toEqual(['emit']);
    expect(prokopDeliveryBindings.emit).toBe(deliverCapekEvent);
  });

  test('bindings assemble the exact group objects in the original order', () => {
    expect(Object.keys(prokopCompatibilityBindings)).toEqual([
      'interaction', 'delivery', 'titles', 'workspace', 'toolPolicy', 'sandbox', 'layout',
    ]);
    expect(prokopCompatibilityBindings.interaction).toBe(prokopInteractionBindings);
    expect(prokopCompatibilityBindings.delivery).toBe(prokopDeliveryBindings);
    expect(prokopCompatibilityBindings.titles).toBe(prokopTitleBindings);
    expect(prokopCompatibilityBindings.workspace).toBe(prokopWorkspaceBindings);
    expect(prokopCompatibilityBindings.toolPolicy).toBe(prokopToolPolicy);
    expect(prokopCompatibilityBindings.sandbox).toBe(prokopSandboxBindings);
    expect('store' in prokopCompatibilityBindings).toBe(false);
  });

  // The compat bindings host has no unconfigured reset. Leaving Jean2
  // bindings installed matches the state that setupTestDatabase and the
  // production startup path establish, so this install test does not leak
  // beyond that expected state.
  test('installs the module-level compatibility bindings by identity', () => {
    configureProkopBindings();
    expect(getProkopCompatibilityBindings()).toBe(prokopCompatibilityBindings);
  });

  test('resolves available managed roots and fails closed for unavailable roots', async () => {
    seedWorkspace({ id: 'ws1' });
    const path = join(getTestDataDir()!, 'worktree-1');
    mkdirSync(path, { recursive: true });
    const worktrees = createManagedWorktreeRepository(getDatabase);
    worktrees.create({
      id: 'worktree-1',
      name: 'test-worktree',
      workspaceId: 'ws1',
      repositoryId: 'repository-1',
      repositoryRoot: '/repo/.git',
      path,
      branch: 'feature/test',
      head: 'abc123',
      state: 'available',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(await prokopWorkspaceBindings.resolveSessionWorkspace?.({
      sessionId: 'session-1',
      workspaceId: 'ws1',
      workspaceRootId: 'worktree-1',
      workspacePath: '/repo',
      additionalPaths: ['/other'],
    })).toEqual({ workspacePath: path, additionalPaths: [] });
    await expect(prokopWorkspaceBindings.resolveSessionWorkspace?.({
      sessionId: 'session-1',
      workspaceId: 'foreign-workspace',
      workspaceRootId: 'worktree-1',
      workspacePath: '/repo',
    })).rejects.toThrow('not available');

    rmSync(path, { recursive: true });
    await expect(prokopWorkspaceBindings.resolveSessionWorkspace?.({
      sessionId: 'session-1',
      workspaceId: 'ws1',
      workspaceRootId: 'worktree-1',
      workspacePath: '/repo',
    })).rejects.toThrow('directory is missing');
    expect(worktrees.get('worktree-1')?.state).toBe('missing');

    worktrees.update('worktree-1', { state: 'removed' });
    await expect(prokopWorkspaceBindings.resolveSessionWorkspace?.({
      sessionId: 'session-1',
      workspaceId: 'ws1',
      workspaceRootId: 'worktree-1',
      workspacePath: '/repo',
    })).rejects.toThrow('not available');
  });

  test('the tool policy adds session temp guidance only to filesystem tools', async () => {
    const readFile = { name: 'read-file', description: 'Read files' } as ToolDefinition;
    const customTool = { name: 'custom-tool' } as ToolDefinition;

    const resolved = await prokopToolPolicy.resolveDefinition?.({
      sessionId: 'session-1',
      definition: readFile,
    });
    expect(resolved?.description).toContain('Read files');
    expect(resolved?.description).toContain('jean2/session-1');
    expect(readFile.description).toBe('Read files');
    expect(await prokopToolPolicy.resolveDefinition?.({
      sessionId: 'session-1',
      definition: customTool,
    })).toBe(customTool);
  });
});
