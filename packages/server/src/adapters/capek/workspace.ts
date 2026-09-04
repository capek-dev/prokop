import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getJean2EnvValue } from '@/infrastructure/runtime/environment';
import { getUploadDir } from '@/infrastructure/runtime/paths';
import {
  addWorkspaceAdditionalPath,
  removeWorkspaceAdditionalPath,
} from '@/infrastructure/sqlite/workspaces';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import type { Jean2CompatibilityBindings } from './types';

const managedWorktrees = createManagedWorktreeRepository(getDatabase);

export const jean2WorkspaceBindings: Jean2CompatibilityBindings['workspace'] = {
  resolveSessionWorkspace: async ({ workspaceId, workspaceRootId, workspacePath, additionalPaths }) => {
    if (!workspaceRootId) return { workspacePath, additionalPaths };

    const worktree = managedWorktrees.get(workspaceRootId);
    if (
      !workspaceId
      || !worktree
      || worktree.workspaceId !== workspaceId
      || worktree.state !== 'available'
    ) {
      throw new Error('Selected worktree is not available for this workspace');
    }
    if (!existsSync(worktree.path)) {
      managedWorktrees.update(worktree.id, { state: 'missing' });
      throw new Error('Selected worktree directory is missing');
    }

    return {
      workspacePath: worktree.path,
      additionalPaths: [],
    };
  },
  createToolWorkspaceHost: ({ workspaceId, workspacePath, additionalPaths, sessionId }) => ({
    root: workspacePath,
    additionalRoots: additionalPaths,
    allowedRoots: [getUploadDir()],
    tempDir: join(tmpdir(), 'jean2', sessionId),
    getEnvironmentValue: getJean2EnvValue,
    addAdditionalRoot: workspaceId
      ? (path: string) => addWorkspaceAdditionalPath(workspaceId, path)
      : undefined,
    removeAdditionalRoot: workspaceId
      ? (path: string) => removeWorkspaceAdditionalPath(workspaceId, path)
      : undefined,
  }),
};
