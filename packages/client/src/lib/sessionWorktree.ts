import type { ManagedWorktree, SessionWorktreeBinding } from '@prokopai/sdk';

interface ResolveFilesPanelRootInput {
  workspacePath: string;
  workspaceRootId?: string | null;
  worktree?: SessionWorktreeBinding | null;
  pinnedRoot?: string | null;
  pinned: boolean;
}

export interface FilesPanelRootResolution {
  selectedRoot: string;
  blocked: boolean;
  isPrimary: boolean;
}

export interface FilesPanelRootOption {
  label: string;
  value: string;
}

type WorktreeNameSource = Pick<ManagedWorktree, 'name'>;
type WorktreeBinding = Pick<ManagedWorktree, 'id' | 'name' | 'branch' | 'path' | 'state'>;

function pathBasename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const slashIndex = trimmed.lastIndexOf('/');
  return slashIndex === -1 ? trimmed : trimmed.slice(slashIndex + 1);
}

export function buildFilesPanelRootOptions(
  workspace: { name: string; path: string; additionalPaths: string[] },
  worktrees: ManagedWorktree[],
): FilesPanelRootOption[] {
  const options: FilesPanelRootOption[] = [
    {
      label: workspace.name || pathBasename(workspace.path) || 'Workspace',
      value: workspace.path,
    },
    ...workspace.additionalPaths.map((path) => ({
      label: pathBasename(path) || path,
      value: path,
    })),
  ];

  for (const worktree of worktrees) {
    if (worktree.state !== 'available' || worktree.path === workspace.path) continue;
    const option = {
      label: worktree.name,
      value: worktree.path,
    };
    const existingIndex = options.findIndex(({ value }) => value === worktree.path);
    if (existingIndex >= 0) options[existingIndex] = option;
    else options.push(option);
  }

  return options;
}

export function getWorktreeDisplayName(worktree: WorktreeNameSource): string {
  return worktree.name;
}

export function resolveSessionWorktree(
  workspaceRootId: string | null | undefined,
  sessionWorktree: SessionWorktreeBinding | null | undefined,
  managedWorktrees: ManagedWorktree[],
): WorktreeBinding | null {
  if (!workspaceRootId) return null;
  return managedWorktrees.find((worktree) => worktree.id === workspaceRootId)
    ?? sessionWorktree
    ?? null;
}

export function resolveFilesPanelRoot({
  workspacePath,
  workspaceRootId,
  worktree,
  pinnedRoot,
  pinned,
}: ResolveFilesPanelRootInput): FilesPanelRootResolution {
  const unavailable = Boolean(workspaceRootId && worktree?.state !== 'available');
  const followedRoot = workspaceRootId ? worktree?.path ?? '' : workspacePath;
  const selectedRoot = pinned ? pinnedRoot ?? followedRoot : followedRoot;

  return {
    selectedRoot,
    blocked: unavailable && !pinned,
    isPrimary: selectedRoot === workspacePath,
  };
}

export function getSessionWorktreeLabel(worktree?: WorktreeBinding | null): string | null {
  return worktree ? getWorktreeDisplayName(worktree) : null;
}
