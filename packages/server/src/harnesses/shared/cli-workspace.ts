import type { Workspace } from '@prokopai/sdk';

/**
 * CLI turns need a real root on disk. Virtual workspaces qualify: "virtual"
 * only means Prokop created the folder (default workspaces, agent homes)
 * instead of the user choosing one. Type guard: after a passing call the
 * workspace is non-null with a path.
 */
export function cliWorkspaceAvailable(workspace: Workspace | null | undefined): workspace is Workspace {
  return Boolean(workspace?.path);
}
