/**
 * Workspace-level directory compatibility for the jean2 → prokopai rename.
 *
 * Rule: `.prokopai/` in the workspace wins; when absent but `.jean2/` exists,
 * use the legacy dir (no forking: reads and writes both go to the resolved
 * dir). When neither exists, default to `.prokopai/`.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { LEGACY_JEAN2_DIR_NAME, PROKOPAI_DIR_NAME } from './paths';

const warnedWorkspaces = new Set<string>();

/** Test hook: clear the warn-once state. */
export function resetWorkspaceDirWarnings(): void {
  warnedWorkspaces.clear();
}

export function getProkopaiWorkspaceDir(workspacePath: string): string {
  return join(workspacePath, PROKOPAI_DIR_NAME);
}

export function getLegacyJean2WorkspaceDir(workspacePath: string): string {
  return join(workspacePath, LEGACY_JEAN2_DIR_NAME);
}

/**
 * Resolve the per-workspace config dir: `.prokopai` ?? `.jean2` ?? `.prokopai`.
 * Warn once per workspace when the legacy dir is used.
 */
export function resolveWorkspaceDir(workspacePath: string): string {
  const canonical = getProkopaiWorkspaceDir(workspacePath);
  if (existsSync(canonical)) {
    return canonical;
  }

  const legacy = getLegacyJean2WorkspaceDir(workspacePath);
  if (existsSync(legacy)) {
    if (!warnedWorkspaces.has(workspacePath)) {
      warnedWorkspaces.add(workspacePath);
      console.warn(
        `[prokopai] Using legacy workspace directory ${legacy}. ` +
          'Rename it to .prokopai to migrate; legacy support will be removed in a future release.',
      );
    }
    return legacy;
  }

  return canonical;
}

/**
 * Resolve the per-workspace memory dir (USER.md / MEMORY.md live directly in
 * it). Same precedence as resolveWorkspaceDir; kept as a separate export so
 * memory tools can adopt migrate-on-write without touching MCP config reads.
 */
export function resolveWorkspaceMemoryDir(workspacePath: string): string {
  return resolveWorkspaceDir(workspacePath);
}
