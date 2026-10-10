/**
 * Workspace-level directory compatibility for the jean2 → prokopai rename.
 *
 * Rule: `.prokopai/` in the workspace wins; when absent but `.jean2/` exists,
 * use the legacy dir (no forking: reads and writes both go to the resolved
 * dir). When neither exists, default to `.prokopai/`.
 */

import { existsSync, realpathSync } from 'fs';
import { join } from 'path';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { LEGACY_JEAN2_DIR_NAME, PROKOPAI_DIR_NAME } from './paths';

const warnedWorkspaces = new Set<string>();

/** Test hook: clear the warn-once state. */
export function resetWorkspaceDirWarnings(): void {
  warnedWorkspaces.clear();
}

export function getProkopaiWorkspaceDir(workspacePath: string): string {
  return join(workspacePath, PROKOPAI_DIR_NAME);
}

export function getLegacyProkopWorkspaceDir(workspacePath: string): string {
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

  const legacy = getLegacyProkopWorkspaceDir(workspacePath);
  if (existsSync(legacy)) {
    if (!warnedWorkspaces.has(workspacePath)) {
      warnedWorkspaces.add(workspacePath);
      console.warn(
        `[prokop] Using legacy workspace directory ${legacy}. ` +
          'Rename it to .prokopai to migrate; legacy support will be removed in a future release.',
      );
    }
    return legacy;
  }

  return canonical;
}

function realPath(path: string): string {
  try { return realpathSync(path); } catch { return path; }
}

/**
 * The folder whose workspace knowledge (memory, skills) a working directory
 * uses. Sessions in a managed worktree work in the worktree but share the
 * main workspace's knowledge, so an edit made from any worktree is seen by
 * every session of the workspace. Other paths are their own root.
 */
export function workspaceKnowledgeRoot(workingPath: string): string {
  try {
    const rows = getDatabase().query<{ worktree: string; workspace: string }, []>(`SELECT m.path AS worktree,
      w.path AS workspace FROM managed_worktrees m JOIN workspaces w ON w.id = m.workspace_id`).all();
    const exact = rows.find(row => row.worktree === workingPath);
    if (exact) return exact.workspace;
    // CLI harnesses pass the resolved root; stored paths may go through a symlink.
    const real = realPath(workingPath);
    return rows.find(row => realPath(row.worktree) === real)?.workspace ?? workingPath;
  } catch (error) {
    console.warn('[prokop] Could not look up the workspace of a worktree; using the worktree folder', error);
    return workingPath;
  }
}

/**
 * Resolve the per-workspace memory dir (USER.md / MEMORY.md live directly in
 * it). Same precedence as resolveWorkspaceDir, applied to the main workspace
 * for worktree paths (workspaceKnowledgeRoot); kept as a separate export so
 * memory tools can adopt migrate-on-write without touching MCP config reads.
 */
export function resolveWorkspaceMemoryDir(workspacePath: string): string {
  return resolveWorkspaceDir(workspaceKnowledgeRoot(workspacePath));
}

/** Workspace skills dir, shared by the main workspace and its worktrees. */
export function resolveWorkspaceSkillsDir(workspacePath: string): string {
  return join(workspaceKnowledgeRoot(workspacePath), '.agents', 'skills');
}
