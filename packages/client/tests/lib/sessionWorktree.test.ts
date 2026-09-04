import { describe, expect, test } from 'vitest';
import type { ManagedWorktree, SessionWorktreeBinding } from '@prokopai/sdk';
import {
  buildFilesPanelRootOptions,
  getSessionWorktreeLabel,
  getWorktreeDisplayName,
  resolveFilesPanelRoot,
  resolveSessionWorktree,
} from '@/lib/sessionWorktree';

const availableWorktree: SessionWorktreeBinding = {
  id: 'worktree-1',
  name: 'root-selection-worktree',
  branch: 'feature/root-selection',
  path: '/data/worktrees/worktree-1',
  state: 'available',
};

describe('session worktree presentation', () => {
  test('follows an available session worktree', () => {
    expect(resolveFilesPanelRoot({
      workspacePath: '/workspace',
      workspaceRootId: availableWorktree.id,
      worktree: availableWorktree,
      pinned: false,
    })).toEqual({
      selectedRoot: availableWorktree.path,
      blocked: false,
      isPrimary: false,
    });
  });

  test('blocks a missing session worktree instead of using the primary checkout', () => {
    const missingWorktree = { ...availableWorktree, state: 'missing' as const };

    expect(resolveFilesPanelRoot({
      workspacePath: '/workspace',
      workspaceRootId: missingWorktree.id,
      worktree: missingWorktree,
      pinned: false,
    })).toEqual({
      selectedRoot: missingWorktree.path,
      blocked: true,
      isPrimary: false,
    });
  });

  test('keeps an explicit pinned recovery root available', () => {
    expect(resolveFilesPanelRoot({
      workspacePath: '/workspace',
      workspaceRootId: 'missing-worktree',
      worktree: null,
      pinnedRoot: '/workspace',
      pinned: true,
    })).toEqual({
      selectedRoot: '/workspace',
      blocked: false,
      isPrimary: true,
    });
  });

  test('shows the worktree name and does not invent a loading label', () => {
    expect(getSessionWorktreeLabel(availableWorktree)).toBe('root-selection-worktree');
    expect(getSessionWorktreeLabel({ ...availableWorktree, state: 'removed' })).toBe('root-selection-worktree');
    expect(getSessionWorktreeLabel(null)).toBeNull();
    expect(getWorktreeDisplayName({ name: 'detached-worktree' })).toBe('detached-worktree');
  });

  test('resolves the readable branch from the managed list when the session projection is absent', () => {
    const managedWorktree: ManagedWorktree = {
      ...availableWorktree,
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      head: 'abc123',
      dirty: false,
      untrackedCount: 0,
      attachments: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(resolveSessionWorktree(availableWorktree.id, null, [managedWorktree]))
      .toEqual(managedWorktree);
  });

  test('labels managed roots by worktree name instead of their opaque directory', () => {
    const worktree: ManagedWorktree = {
      ...availableWorktree,
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      head: 'abc123',
      dirty: false,
      untrackedCount: 0,
      attachments: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(buildFilesPanelRootOptions({
      name: 'Workspace',
      path: '/workspace',
      additionalPaths: ['/extra', worktree.path],
    }, [worktree])).toEqual([
      { label: 'Workspace', value: '/workspace' },
      { label: 'extra', value: '/extra' },
      { label: 'root-selection-worktree', value: worktree.path },
    ]);
  });
});
