import { tmpdir } from 'os';
import { join } from 'path';
import { getJean2EnvValue } from '@/infrastructure/runtime/environment';
import { getUploadDir } from '@/infrastructure/runtime/paths';
import {
  addWorkspaceAdditionalPath,
  removeWorkspaceAdditionalPath,
} from '@/infrastructure/sqlite/workspaces';
import type { Jean2CompatibilityBindings } from './types';

export const jean2WorkspaceBindings: Jean2CompatibilityBindings['workspace'] = {
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
