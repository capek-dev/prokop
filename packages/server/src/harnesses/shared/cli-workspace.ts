import type { Workspace } from '@prokopai/sdk';

/**
 * CLI turns need a real root on disk. Agent homes are virtual rows backed by
 * a real home directory (agent learning reviews run there), so they pass the
 * check that blocks other virtual workspaces. Type guard: after a passing
 * call the workspace is non-null with a path.
 */
export function cliWorkspaceAvailable(workspace: Workspace | null | undefined): workspace is Workspace {
  return Boolean(workspace && workspace.path
    && (workspace.isVirtual !== true || workspace.settings?.isAgentHome === true));
}
