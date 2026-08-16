/**
 * Compatibility forwarder (S5 filesystem isolation). The list/search
 * implementation moved to `infrastructure/filesystem/workspace-files.ts`;
 * `isPathWithinWorkspace` keeps its pre-slice re-export identity over the
 * C6 workspace path policy adapter.
 */

import { workspacePathPolicyPort } from '@/adapters/capek/workspace-paths';

export const isPathWithinWorkspace = workspacePathPolicyPort.isPathWithinWorkspace;

export {
  buildIgnoreFilter,
  listDirectory,
  searchFiles,
} from '@/infrastructure/filesystem/workspace-files';
