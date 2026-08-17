import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolve } from 'path';
import { createWorkspaceCapability } from '@capekai/core/internal/execution';
import { jean2CompatibilityBindings } from '@/adapters/capek';
import { getWorkspace } from '@/store/workspaces';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';

describe('Čapek workspace mutation adapter', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  test('adds and removes normalized paths with atomic workspace updates', async () => {
    seedWorkspace({
      id: 'workspace-1',
      path: '/workspace/project',
      additionalPaths: ['/workspace/existing'],
    });
    const capability = createWorkspaceCapability(
      jean2CompatibilityBindings.workspace.createToolWorkspaceHost({
        workspaceId: 'workspace-1',
        workspacePath: '/workspace/project',
        additionalPaths: ['/workspace/existing'],
        sessionId: 'session-1',
      }),
    );

    expect(await capability.addWorkspacePath('/workspace/new/../added')).toBe(true);
    expect(getWorkspace('workspace-1')?.additionalPaths).toEqual([
      '/workspace/existing',
      resolve('/workspace/added'),
    ]);

    expect(await capability.removeWorkspacePath('/workspace/existing')).toBe(true);
    expect(getWorkspace('workspace-1')?.additionalPaths).toEqual([
      resolve('/workspace/added'),
    ]);
  });

  test('preserves independent additional-path mutations', async () => {
    seedWorkspace({
      id: 'workspace-1',
      path: '/workspace/project',
      additionalPaths: ['/workspace/existing'],
    });
    const first = createWorkspaceCapability(
      jean2CompatibilityBindings.workspace.createToolWorkspaceHost({
        workspaceId: 'workspace-1',
        workspacePath: '/workspace/project',
        sessionId: 'session-1',
      }),
    );
    const second = createWorkspaceCapability(
      jean2CompatibilityBindings.workspace.createToolWorkspaceHost({
        workspaceId: 'workspace-1',
        workspacePath: '/workspace/project',
        sessionId: 'session-2',
      }),
    );

    expect(await Promise.all([
      first.addWorkspacePath('/workspace/a'),
      second.addWorkspacePath('/workspace/b'),
    ])).toEqual([true, true]);
    expect(getWorkspace('workspace-1')?.additionalPaths).toEqual([
      '/workspace/existing',
      '/workspace/a',
      '/workspace/b',
    ]);
    expect(await first.addWorkspacePath('/workspace/a')).toBe(true);
    expect(await second.removeWorkspacePath('/workspace/missing')).toBe(true);
    expect(getWorkspace('workspace-1')?.additionalPaths).toEqual([
      '/workspace/existing',
      '/workspace/a',
      '/workspace/b',
    ]);
  });

  test('returns false when the workspace no longer exists', async () => {
    const capability = createWorkspaceCapability(
      jean2CompatibilityBindings.workspace.createToolWorkspaceHost({
        workspaceId: 'missing',
        workspacePath: '/workspace/project',
        sessionId: 'session-1',
      }),
    );

    expect(await capability.addWorkspacePath('/workspace/added')).toBe(false);
    expect(await capability.removeWorkspacePath('/workspace/added')).toBe(false);
  });
});
